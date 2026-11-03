/**
 * ⚓ Port Ops — 장식(decor) 모형: 충돌 없음, 총알 통과.
 *   pipe · sign · light · loadingArm · flare · buoy
 *
 * 정적인 부품은 builder가 넘겨준 재질별 GeoBatch에 합쳐 드로우콜을 줄이고,
 * 움직이는 부품(불꽃·부표 흔들림)과 개별 텍스처(표지판)만 따로 메시로 만든다.
 */
import * as THREE from 'three';
import { pipeMatrix } from './geom.js';
import { toRad, LIMITS } from '../core/consts.js';

const FONT = "'Pretendard','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif";

/* ---------------- 공용 리소스 ---------------- */

let unitCyl = null, unitSphere = null, glowTex = null, flameTex = null;
function getUnitCyl() {
  if (!unitCyl) { unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false); unitCyl.translate(0, 0.5, 0); }
  return unitCyl;
}
function getUnitSphere() {
  if (!unitSphere) unitSphere = new THREE.SphereGeometry(1, 12, 8);
  return unitSphere;
}
function radialTex(stops, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function getGlowTex() {
  if (!glowTex) glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
  return glowTex;
}
function getFlameTex() {
  if (!flameTex) {
    const W = 64, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    // 아래가 넓고 위로 갈수록 가늘어지는 불꽃
    for (let i = 0; i < 3; i++) {
      const gr = g.createRadialGradient(W / 2, H * 0.78, 2, W / 2, H * 0.6, H * 0.55);
      const col = ['255,240,190', '255,170,60', '255,90,20'][i];
      gr.addColorStop(0, `rgba(${col},${0.9 - i * 0.2})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(W / 2, 4 + i * 6);
      g.bezierCurveTo(W * (0.95 - i * 0.05), H * 0.45, W * 0.9, H * 0.95, W / 2, H - 2);
      g.bezierCurveTo(W * 0.1, H * 0.95, W * (0.05 + i * 0.05), H * 0.45, W / 2, 4 + i * 6);
      g.fill();
    }
    flameTex = new THREE.CanvasTexture(c);
    flameTex.colorSpace = THREE.SRGBColorSpace;
  }
  return flameTex;
}

/* ---------------- 표지판 텍스처 ---------------- */

/** 표지판 캔버스 텍스처 (한글·영문, 여러 줄 '\n' 지원) */
export function makeSignTexture(text, w, h, bg = '#0b2545', fg = '#ffffff') {
  const ppm = 128; // px per m
  let cw = Math.max(64, Math.round(w * ppm)), ch = Math.max(32, Math.round(h * ppm));
  const k = Math.min(1, 1024 / cw, 512 / ch);
  cw = Math.round(cw * k); ch = Math.round(ch * k);
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, cw, ch);
  const border = Math.max(2, Math.round(Math.min(cw, ch) * 0.05));
  g.strokeStyle = fg;
  g.globalAlpha = 0.85;
  g.lineWidth = border * 0.6;
  g.strokeRect(border, border, cw - border * 2, ch - border * 2);
  g.globalAlpha = 1;
  const lines = String(text == null ? '' : text).split('\n').map((s) => s.trim()).filter((s, i, a) => s || a.length === 1);
  const pad = border * 2.2;
  let size = Math.floor((ch - pad * 2) / (lines.length * 1.18));
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fit = () => {
    g.font = `800 ${size}px ${FONT}`;
    return Math.max(...lines.map((l) => g.measureText(l).width));
  };
  while (size > 8 && fit() > cw - pad * 2) size -= 2;
  const lh = size * 1.18;
  const y0 = ch / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => g.fillText(l, cw / 2, y0 + i * lh + size * 0.04));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------- 장식 빌드 ---------------- */

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

/**
 * @param {object[]} list map.decor
 * @param {object} env { batch(mat) → GeoBatch, group: THREE.Group, waterY(x,z) → number, warn(msg) }
 * @returns {{ update(dt:number, t:number):void, dispose():void, counts:object }}
 */
export function buildDecor(list, env) {
  const disposables = [];
  const animators = [];
  const counts = { pipe: 0, sign: 0, light: 0, loadingArm: 0, flare: 0, buoy: 0, skipped: 0 };
  const pipes = new Map(); // mat → [matrix]
  const bulbs = [];        // { pos, color, intensity, dist }
  const buoys = [];
  const flames = [];
  const unitCylG = getUnitCyl();

  const addPipe = (mat, from, to, r) => {
    if (!pipes.has(mat)) pipes.set(mat, []);
    pipes.get(mat).push(pipeMatrix(from, to, r));
  };
  /** 로컬 좌표(rotY 회전 + 원점 이동) 파이프 */
  const localPipe = (mat, T, a, b, r) => addPipe(mat, T(a), T(b), r);
  const localBox = (mat, T, rot, cx, cy, cz, w, h, d) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const p = T([cx, cy, cz]);
    tmpM.compose(tmpP.set(p[0], p[1], p[2]), tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), tmpS.set(1, 1, 1));
    env.batch(mat).addGeometry(geo, tmpM);
    geo.dispose();
  };
  const localCylY = (mat, T, cx, y0, cz, r, h) => {
    const p = T([cx, y0, cz]);
    const b = env.batch(mat);
    b.addCylinder(p[0], p[1], p[2], r, h, b.scale || 1, { segments: 14 });
  };
  const makeT = (x, y, z, rot) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    // three rotation.y: x' = x c + z s, z' = -x s + z c
    return (p) => [x + p[0] * c + p[2] * s, y + p[1], z - p[0] * s + p[2] * c];
  };

  for (const d of Array.isArray(list) ? list : []) {
    if (!d || typeof d !== 'object') { counts.skipped++; continue; }
    try {
      switch (d.type) {
        case 'pipe': {
          if (!Array.isArray(d.from) || !Array.isArray(d.to)) throw new Error('pipe needs from/to');
          const r = +d.r > 0 ? +d.r : 0.2;
          addPipe(d.mat || 'pipe', d.from.map(Number), d.to.map(Number), r);
          counts.pipe++;
          break;
        }
        case 'sign': {
          const w = +d.w > 0 ? +d.w : 3, h = +d.h > 0 ? +d.h : 0.8;
          const tex = makeSignTexture(d.text, w, h, d.bg || '#0b2545', d.fg || '#ffffff');
          const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
          const geo = new THREE.PlaneGeometry(w, h);
          const mesh = new THREE.Mesh(geo, mat);
          // 규약: sign.rotY는 three.js rotation.y에 그대로(라디안). rotY=0이면 앞면이 +z(남)를 향함
          const rot = Number(d.rotY) || 0;
          const cx = +d.x || 0, cy = Number.isFinite(+d.y) ? +d.y : 2, cz = +d.z || 0;
          mesh.position.set(cx, cy, cz);
          mesh.rotation.y = rot;
          // 앞면을 테두리 판보다 살짝 앞으로
          mesh.translateZ(0.031);
          mesh.name = 'sign';
          env.group.add(mesh);
          disposables.push(geo, mat, tex);
          // 뒤판(두께 6 cm, steel)
          const T = makeT(cx, cy, cz, rot);
          localBox('steel', T, rot, 0, 0, 0, w + 0.08, h + 0.08, 0.06);
          counts.sign++;
          break;
        }
        case 'light': {
          const color = new THREE.Color(d.color || '#ffe8b0');
          bulbs.push({ x: +d.x || 0, y: +d.y || 3, z: +d.z || 0, color, intensity: +d.intensity > 0 ? +d.intensity : 1, dist: +d.dist > 0 ? +d.dist : 12 });
          // 등기구 갓
          const sb = env.batch('steel');
          sb.addBox((+d.x || 0) - 0.2, (+d.y || 3) + 0.1, (+d.z || 0) - 0.2, (+d.x || 0) + 0.2, (+d.y || 3) + 0.22, (+d.z || 0) + 0.2, sb.scale || 2);
          counts.light++;
          break;
        }
        case 'loadingArm': {
          const rot = toRad(d.rotY || 0);
          const T = makeT(+d.x || 0, +d.y || 0, +d.z || 0, rot);
          // 받침 + 라이저(세로 기둥)
          localBox('steel', T, rot, 0, 0.15, 0, 1.5, 0.3, 1.5);
          localCylY('white', T, 0, 0.3, 0, 0.36, 5.4);
          // 상부 트러니언(가로 축)
          localPipe('steel', T, [-0.6, 5.85, 0], [0.6, 5.85, 0], 0.42);
          // 평형추 + 연결 빔
          localPipe('steel', T, [0, 5.85, 0], [0, 5.55, -1.3], 0.16);
          localBox('steel', T, rot, 0, 5.15, -1.5, 1.1, 0.9, 0.7);
          // 내측 팔(위·바깥으로) + 정점 스위블
          localPipe('yellow', T, [0, 5.85, 0], [0, 9.7, 2.3], 0.26);
          localPipe('steel', T, [-0.4, 9.7, 2.3], [0.4, 9.7, 2.3], 0.34);
          // 외측 팔(아래·바깥으로)
          localPipe('yellow', T, [0, 9.7, 2.3], [0, 3.3, 4.9], 0.23);
          // 유압 실린더
          localPipe('steel', T, [0.3, 4.6, 0.25], [0.3, 7.4, 1.15], 0.07);
          // 끝단 스위블·커플러(선박 매니폴드 연결부)
          localPipe('steel', T, [0, 3.3, 4.9], [0, 2.2, 4.9], 0.2);
          localPipe('steel', T, [0, 2.2, 4.9], [0, 2.2, 5.5], 0.2);
          localPipe('rust', T, [0, 2.2, 5.5], [0, 2.2, 5.62], 0.34);
          counts.loadingArm++;
          break;
        }
        case 'flare': {
          const H = +d.h > 4 ? +d.h : 14;
          const x = +d.x || 0, y = +d.y || 0, z = +d.z || 0;
          const T = makeT(x, y, z, 0);
          // 탑(흰색 + 상단 빨간 띠) · 받침 다리 3개 · 작업대 · 팁
          localCylY('white', T, 0, 0, 0, 0.34, H - 2.2);
          localCylY('container_red', T, 0, H - 2.2, 0, 0.35, 0.9);
          localCylY('white', T, 0, H - 1.3, 0, 0.34, 0.8);
          localCylY('container_red', T, 0, H - 0.5, 0, 0.36, 0.5);
          localCylY('rust', T, 0, H, 0, 0.44, 0.45);
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2;
            localPipe('steel', T, [Math.cos(a) * 1.7, 0, Math.sin(a) * 1.7], [Math.cos(a) * 0.36, H * 0.55, Math.sin(a) * 0.36], 0.08);
          }
          localCylY('steel', T, 0, H * 0.7, 0, 0.95, 0.1);
          // 불꽃(애니메이션)
          const fmat = new THREE.SpriteMaterial({ map: getFlameTex(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true });
          const s1 = new THREE.Sprite(fmat), s2 = new THREE.Sprite(fmat);
          s1.center.set(0.5, 0.02); s2.center.set(0.5, 0.02);
          s1.position.set(x, y + H + 0.4, z); s2.position.set(x + 0.15, y + H + 0.4, z - 0.1);
          const gmat = new THREE.SpriteMaterial({ map: getGlowTex(), color: 0xff8a30, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: true });
          const glow = new THREE.Sprite(gmat);
          glow.position.set(x, y + H + 1.6, z);
          glow.scale.set(7, 7, 1);
          env.group.add(s1, s2, glow);
          disposables.push(fmat, gmat);
          flames.push({ s1, s2, glow, seed: Math.random() * 100 });
          bulbs.push({ x, y: y + H + 1.5, z, color: new THREE.Color('#ff9a40'), intensity: 2.2, dist: 30, flare: flames[flames.length - 1], hidden: true });
          counts.flare++;
          break;
        }
        case 'buoy': {
          const r = +d.r > 0 ? +d.r : 0.6;
          const x = +d.x || 0, z = +d.z || 0;
          buoys.push({ x, z, r, y: Number.isFinite(+d.y) ? +d.y : env.waterY(x, z), color: d.color || null, phase: Math.random() * Math.PI * 2 });
          counts.buoy++;
          break;
        }
        default:
          counts.skipped++;
          env.warn && env.warn('unknown decor type: ' + d.type);
      }
    } catch (err) {
      counts.skipped++;
      env.warn && env.warn('decor skipped (' + d.type + '): ' + err.message);
    }
  }

  // 파이프: 재질별 InstancedMesh
  for (const [mat, mats] of pipes) {
    const im = new THREE.InstancedMesh(unitCylG, env.material(mat), mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'pipes:' + mat;
    env.group.add(im);
    disposables.push(im);
  }

  // 전구: InstancedMesh(발광) + 빛무리 스프라이트 + 실제 조명은 상위 N개만
  const visibleBulbs = bulbs.filter((b) => !b.hidden);
  if (visibleBulbs.length) {
    const bmat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const im = new THREE.InstancedMesh(getUnitSphere(), bmat, visibleBulbs.length);
    visibleBulbs.forEach((b, i) => {
      tmpM.compose(tmpP.set(b.x, b.y, b.z), tmpQ.identity(), tmpS.set(0.13, 0.1, 0.13));
      im.setMatrixAt(i, tmpM);
      im.setColorAt(i, b.color.clone().multiplyScalar(1.4));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    env.group.add(im);
    disposables.push(im, bmat);
    for (const b of visibleBulbs) {
      const gm = new THREE.SpriteMaterial({ map: getGlowTex(), color: b.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5, fog: true });
      const sp = new THREE.Sprite(gm);
      sp.position.set(b.x, b.y - 0.05, b.z);
      const s = 0.9 + Math.min(2, b.intensity) * 0.5;
      sp.scale.set(s, s, 1);
      env.group.add(sp);
      disposables.push(gm);
    }
  }
  // 규약: 실제 PointLight는 상한(LIMITS.REAL_LIGHTS) 안에서 decor 배열 앞쪽 light부터. 나머지는 발광 메시+빛무리(가짜 조명).
  //       light가 상한보다 적으면 남는 자리를 flare 불꽃이 (배열 순서대로) 쓴다.
  const realLights = [];
  const chosen = bulbs.filter((b) => !b.flare).slice(0, LIMITS.REAL_LIGHTS);
  chosen.push(...bulbs.filter((b) => b.flare).slice(0, Math.max(0, LIMITS.REAL_LIGHTS - chosen.length)));
  chosen.forEach((b) => {
    const L = new THREE.PointLight(b.color, b.intensity * 6, b.dist * 1.3, 1.6);
    L.position.set(b.x, b.y - 0.15, b.z);
    L.castShadow = false;
    env.group.add(L);
    realLights.push({ light: L, base: L.intensity, flare: b.flare || null });
  });

  // 부표: 한 지오메트리(정점색) × InstancedMesh(인스턴스 색)
  let buoyMesh = null;
  if (buoys.length) {
    const parts = [];
    const add = (g, color, y) => { g.translate(0, y, 0); const n = g.attributes.position.count; const c = new THREE.Color(color); const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); parts.push(g); };
    add(new THREE.CylinderGeometry(1, 0.85, 0.9, 16), 0xffffff, 0.15);       // 몸통 (y -0.3 ~ 0.6)
    add(new THREE.CylinderGeometry(1.03, 1.03, 0.14, 16), 0xf2f2f2, 0.45);    // 흰 띠
    add(new THREE.CylinderGeometry(0.5, 0.95, 0.4, 16), 0xffffff, 0.8);       // 원뿔대
    add(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6), 0x333333, 1.65);      // 마스트
    add(new THREE.SphereGeometry(0.2, 10, 8), 0xffffff, 2.35);                // 두표
    const merged = mergeSimple(parts);
    parts.forEach((g) => g.dispose());
    const bm = new THREE.MeshLambertMaterial({ vertexColors: true });
    buoyMesh = new THREE.InstancedMesh(merged, bm, buoys.length);
    const palette = [0xc8302a, 0x2e8b45, 0xe8b417];
    buoys.forEach((b, i) => buoyMesh.setColorAt(i, new THREE.Color(b.color || palette[i % 3])));
    if (buoyMesh.instanceColor) buoyMesh.instanceColor.needsUpdate = true;
    buoyMesh.castShadow = true;
    env.group.add(buoyMesh);
    disposables.push(buoyMesh, merged, bm);
  }

  const e = new THREE.Euler();
  function update(dt, t) {
    for (const f of flames) {
      const k = 1 + 0.18 * Math.sin(t * 13 + f.seed) + 0.1 * Math.sin(t * 29 + f.seed * 2);
      f.s1.scale.set(1.5 * k, 3.4 * k, 1);
      f.s2.scale.set(1.1 * (2 - k), 2.6 * (2 - k * 0.8), 1);
      f.s1.material.rotation = 0.06 * Math.sin(t * 2 + f.seed);
      f.glow.material.opacity = 0.42 + 0.12 * k;
    }
    for (const L of realLights) if (L.flare) L.light.intensity = L.base * (0.8 + 0.25 * Math.sin(t * 17 + L.flare.seed));
    if (buoyMesh) {
      buoys.forEach((b, i) => {
        const bob = Math.sin(t * 1.3 + b.phase) * 0.07 * b.r;
        e.set(Math.sin(t * 0.9 + b.phase) * 0.06, 0, Math.cos(t * 1.1 + b.phase) * 0.06);
        tmpQ.setFromEuler(e);
        tmpM.compose(tmpP.set(b.x, b.y + bob, b.z), tmpQ, tmpS.set(b.r, b.r, b.r));
        buoyMesh.setMatrixAt(i, tmpM);
      });
      buoyMesh.instanceMatrix.needsUpdate = true;
      if (!buoyMesh.boundingSphere) buoyMesh.computeBoundingSphere();
    }
  }
  if (buoyMesh) { update(0, 0); buoyMesh.computeBoundingSphere(); }

  function dispose() {
    for (const d of disposables) if (d && d.dispose) d.dispose();
    disposables.length = 0;
    for (const L of realLights) L.light.dispose && L.light.dispose();
  }

  return { update, dispose, counts, lightCount: realLights.length, animated: flames.length + buoys.length > 0 };
}

/** 같은 속성 구성(position/normal/uv/color, index)의 지오메트리 합치기 */
function mergeSimple(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) { vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), col = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.attributes.color) col.set(g.attributes.color.array, vo * 3);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo; }
    else { for (let i = 0; i < n; i++) idx[io++] = vo + i; }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
