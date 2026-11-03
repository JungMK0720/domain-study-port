/**
 * ⚓ 항만 작전(Port Ops) — 1인칭 무기 모형(뷰모델) (weapons 담당)
 *
 *   const vm = createViewmodel(R.viewCamera, { lookCamera: R.camera });   // core 렌더러의 뷰모델 씬
 *   vm.play(ev)                        // arsenal.update()가 돌려준 이벤트를 그대로
 *   vm.update(dt, arsenal.getViewState())
 *   vm.dispose()
 *
 * 도형(Box·Cylinder·Torus·Extrude)과 캔버스 글자만으로 만든 오리지널 모형이다. 외부 파일 없음.
 * 무기 표기(NOR-1 등)와 도장은 팀 도메인(탱커 터미널) 소재: 안전 황색, 선체 방청 적색, 연료 드럼.
 *
 * 붙이는 위치
 *  - camera.parent가 Scene이면(core의 viewScene·viewCamera 포함) 그 씬에 넣고 매 프레임 카메라를 따라간다.
 *  - 아니면 camera의 자식으로 붙인다.
 *  - 메시는 전용 레이어(VIEWMODEL_LAYER)에만 두고 그 카메라에서만 켠다 → 월드 레이캐스트·다른 카메라에 안 걸린다.
 *  - 월드와 같은 패스에서 그려져도 벽에 파묻히지 않게, 그리기 직전에 깊이를 한 번 지운다(clearDepth 옵션).
 * 저격 스코프: 줌 진행도 > 0.9면 모형을 숨긴다(오버레이는 UI 담당).
 */
import * as THREE from 'three';
import { WEAPONS } from './defs.js';

export const VIEWMODEL_LAYER = 30;
const RO = 10000;                 // renderOrder 기준(월드의 투명 물체보다 뒤에 그려지도록 크게)
const DEG = Math.PI / 180;

const COLOR = {
  gunmetal: 0x2c3138, black: 0x16181c, navy: 0x1f3557, hazard: 0xf2c230, oxide: 0x8e3322, oxideDark: 0x5c2216,
  gray: 0x59606a, steel: 0xc3cad3, rope: 0xc29d63, ropeDark: 0x7a5a33, drum: 0xe2b52a, drumDark: 0x9a7612,
  glove: 0x34383f, cuff: 0xff7a1a, sleeve: 0x3a4a5c, lens: 0x3d8fe0, lensDark: 0x0d1a2a, dot: 0xff5a1f, tritium: 0x9dff6a,
};
/** 팀별 소매 색(core TEAMS 색과 맞춤) */
const TEAM_SLEEVE = { owner: 0x22407a, charterer: 0xe8731c };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const approach = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);

function spring(k = 260, damp = 0.85) { return { x: 0, v: 0, k, c: 2 * Math.sqrt(k) * damp }; }
function stepSpring(s, dt, target = 0) {
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / n;
  for (let i = 0; i < n; i++) { s.v += (-s.k * (s.x - target) - s.c * s.v) * h; s.x += s.v * h; }
}

/**
 * @param {THREE.Camera} camera  모형을 그리는 카메라(core: R.viewCamera, 또는 월드 카메라)
 * @param {object} [opts]
 * @param {THREE.Object3D} [opts.lookCamera]  시점 흔들림(sway)·총구 월드 좌표 계산에 쓸 월드 카메라(기본 camera)
 * @param {THREE.Scene} [opts.scene]          강제로 이 씬에 붙인다
 * @param {boolean} [opts.clearDepth=true]    그리기 직전 깊이 지우기(월드와 같은 패스일 때 필요)
 * @param {boolean} [opts.muzzleFlash=true]   내장 총구 섬광(FX 쪽에서 1인칭 섬광을 그리면 false)
 * @param {number}  [opts.scale=1]            전체 크기 배율
 * @param {'owner'|'charterer'|null} [opts.team]
 */
export function createViewmodel(camera, opts = {}) {
  if (!camera || !camera.isCamera) throw new Error('createViewmodel(camera): three.js 카메라가 필요합니다');
  const hasDOM = typeof document !== 'undefined' && typeof document.createElement === 'function';
  const lookCam = opts.lookCamera && opts.lookCamera.isObject3D ? opts.lookCamera : camera;
  const S = num(opts.scale, 1) > 0 ? num(opts.scale, 1) : 1;
  const useFlash = opts.muzzleFlash !== false;
  const owned = { geos: new Set(), mats: new Set(), texs: new Set() };

  // ── 붙이기 ──────────────────────────────────────────────────
  const root = new THREE.Group();
  root.name = 'weapons-viewmodel';
  const pose = new THREE.Group();
  root.add(pose);
  let mountScene = null;
  if (opts.scene && opts.scene.isScene) mountScene = opts.scene;
  else if (camera.parent && camera.parent.isScene) mountScene = camera.parent;
  let followCamera = false;
  if (mountScene) {
    mountScene.add(root);
    let p = camera.parent;
    while (p) { if (p === mountScene) { followCamera = true; break; } p = p.parent; }
  } else {
    camera.add(root);
  }
  camera.layers.enable(VIEWMODEL_LAYER);

  // ── 재질 ────────────────────────────────────────────────────
  // 모두 transparent(불투명도 1): 월드 패스에서도 투명 물체 뒤에 그려지고, 깊이 지우기 뒤에 순서대로 그려진다.
  function std(color, { rough = 0.62, metal = 0.25, glow = 0.1 } = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, transparent: true, depthWrite: true, fog: false });
    m.emissive = new THREE.Color(color).multiplyScalar(glow);
    owned.mats.add(m);
    return m;
  }
  const M = {
    gunmetal: std(COLOR.gunmetal, { rough: 0.45, metal: 0.5 }),
    black: std(COLOR.black, { rough: 0.7, metal: 0.2, glow: 0.12 }),
    navy: std(COLOR.navy, { rough: 0.55, metal: 0.15 }),
    hazard: std(COLOR.hazard, { rough: 0.5, metal: 0.05, glow: 0.12 }),
    oxide: std(COLOR.oxide, { rough: 0.7, metal: 0.1 }),
    oxideDark: std(COLOR.oxideDark, { rough: 0.75, metal: 0.1 }),
    gray: std(COLOR.gray, { rough: 0.4, metal: 0.55 }),
    steel: std(COLOR.steel, { rough: 0.28, metal: 0.75, glow: 0.05 }),
    rope: std(COLOR.rope, { rough: 0.95, metal: 0, glow: 0.08 }),
    ropeDark: std(COLOR.ropeDark, { rough: 0.95, metal: 0 }),
    drum: std(COLOR.drum, { rough: 0.5, metal: 0.2, glow: 0.1 }),
    drumDark: std(COLOR.drumDark, { rough: 0.6, metal: 0.3 }),
    glove: std(COLOR.glove, { rough: 0.9, metal: 0, glow: 0.12 }),
    cuff: std(COLOR.cuff, { rough: 0.8, metal: 0, glow: 0.15 }),
    sleeve: std(COLOR.sleeve, { rough: 0.95, metal: 0, glow: 0.12 }),
    lens: std(COLOR.lens, { rough: 0.1, metal: 0.6, glow: 0.45 }),
    lensDark: std(COLOR.lensDark, { rough: 0.1, metal: 0.4, glow: 0.05 }),
  };
  M.dot = new THREE.MeshBasicMaterial({ color: COLOR.dot, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  M.tritium = new THREE.MeshBasicMaterial({ color: COLOR.tritium, transparent: true, fog: false, toneMapped: false });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x88c4ff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.16, depthWrite: false, fog: false });
  owned.mats.add(M.dot); owned.mats.add(M.tritium); owned.mats.add(M.glass);

  // ── 도형 도우미 ─────────────────────────────────────────────
  function add(geo, mat, parent, x = 0, y = 0, z = 0, order = 0) {
    owned.geos.add(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.userData.vmOrder = order;
    parent.add(m);
    return m;
  }
  const box = (w, h, d, mat, parent, x, y, z) => add(new THREE.BoxGeometry(w, h, d), mat, parent, x, y, z);
  function cyl(rTop, rBot, l, mat, parent, axis, x, y, z, seg = 14) {
    const g = new THREE.CylinderGeometry(rTop, rBot, l, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2);      // 위(rTop) → +z(뒤쪽)
    else if (axis === 'x') g.rotateZ(-Math.PI / 2); // 위(rTop) → +x(오른쪽)
    return add(g, mat, parent, x, y, z);
  }
  const sphere = (r, mat, parent, x, y, z) => add(new THREE.SphereGeometry(r, 12, 8), mat, parent, x, y, z);
  const torus = (r, tube, mat, parent, x, y, z) => add(new THREE.TorusGeometry(r, tube, 6, 18), mat, parent, x, y, z);

  function canvasTexture(w, h, draw) {
    if (!hasDOM) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    owned.texs.add(t);
    return t;
  }
  function textDraw(lines) {
    return (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const L of lines) {
        g.font = `${L.weight || 900} ${Math.round(L.size * h)}px "Arial Black", "Segoe UI", Arial, sans-serif`;
        if (L.stroke) { g.lineWidth = Math.max(2, h * 0.05); g.strokeStyle = L.stroke; g.strokeText(L.text, w / 2, L.y * h); }
        g.fillStyle = L.color;
        g.fillText(L.text, w / 2, L.y * h, w * 0.96);
      }
    };
  }
  /** 평면 데칼(글자·표식). rotY=-π/2면 왼쪽 면(-x)에 붙는다. */
  function decal(parent, w, h, x, y, z, rotY, draw, px = 512) {
    const tex = canvasTexture(px, Math.max(16, Math.round((px * h) / w)), draw);
    if (!tex) return null;
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18 });
    owned.mats.add(mat);
    const m = add(new THREE.PlaneGeometry(w, h), mat, parent, x, y, z, 1);
    m.rotation.y = rotY;
    return m;
  }
  const label = (parent, text, w, h, x, y, z, color, stroke = 'rgba(0,0,0,0.55)') =>
    decal(parent, w, h, x, y, z, -Math.PI / 2, textDraw([{ text, size: 0.78, y: 0.54, color, stroke }]));

  // ── 손·장갑·소매 ────────────────────────────────────────────
  const Z = new THREE.Vector3(0, 0, 1);
  function makeArm(side, x, y, z, dir) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    box(0.05, 0.072, 0.074, M.glove, g, 0, 0, 0);                               // 주먹(작업 장갑)
    box(0.052, 0.018, 0.05, M.black, g, 0, -0.03, -0.012);                       // 손바닥 코팅
    box(0.017, 0.018, 0.048, M.glove, g, side === 'R' ? -0.03 : 0.03, 0.024, -0.014); // 엄지
    const fore = new THREE.Group();
    fore.quaternion.setFromUnitVectors(Z, new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
    g.add(fore);
    cyl(0.031, 0.033, 0.05, M.cuff, fore, 'z', 0, 0, 0.06);                      // 형광 주황 손목 띠
    cyl(0.034, 0.04, 0.3, M.sleeve, fore, 'z', 0, 0, 0.235);                      // 작업복 소매
    g.userData.base = g.position.clone();
    return g;
  }

  // ── 무기 모형 5종 ───────────────────────────────────────────
  function buildNor1() {
    const g = new THREE.Group();
    const parts = {};
    box(0.046, 0.056, 0.27, M.navy, g, 0, 0.004, -0.05);                 // 리시버
    box(0.03, 0.012, 0.2, M.black, g, 0, 0.038, -0.06);                   // 상부 레일
    box(0.05, 0.05, 0.3, M.navy, g, 0, -0.004, -0.33);                    // 포엔드
    box(0.052, 0.052, 0.028, M.hazard, g, 0, -0.004, -0.455);             // 안전 황색 띠
    cyl(0.0105, 0.0105, 0.55, M.gunmetal, g, 'z', 0, 0.008, -0.62);       // 총열
    cyl(0.017, 0.017, 0.06, M.black, g, 'z', 0, 0.008, -0.92);            // 소염기(머즐 브레이크)
    box(0.038, 0.008, 0.012, M.black, g, 0, 0.008, -0.905);
    box(0.042, 0.072, 0.21, M.navy, g, 0, -0.018, 0.17);                  // 개머리
    box(0.03, 0.02, 0.12, M.hazard, g, 0, 0.026, 0.16);                   // 뺨받침(황색)
    box(0.044, 0.084, 0.02, M.black, g, 0, -0.02, 0.285);                 // 개머리판
    box(0.03, 0.085, 0.042, M.black, g, 0, -0.062, 0.04).rotation.x = 0.3;  // 손잡이
    box(0.008, 0.006, 0.055, M.black, g, 0, -0.036, -0.005);              // 방아쇠울
    box(0.008, 0.026, 0.006, M.black, g, 0, -0.024, -0.032);
    box(0.004, 0.016, 0.005, M.steel, g, 0, -0.024, -0.008);              // 방아쇠
    parts.mag = box(0.034, 0.05, 0.075, M.gunmetal, g, 0, -0.048, -0.09);  // 탄창
    const scope = new THREE.Group();
    scope.position.set(0, 0.072, -0.07);
    g.add(scope);
    cyl(0.017, 0.017, 0.26, M.black, scope, 'z', 0, 0, 0);
    cyl(0.018, 0.027, 0.07, M.black, scope, 'z', 0, 0, -0.165);           // 대물렌즈 쪽(앞이 넓음)
    cyl(0.022, 0.02, 0.05, M.black, scope, 'z', 0, 0, 0.15);              // 접안부
    cyl(0.0178, 0.0178, 0.012, M.hazard, scope, 'z', 0, 0, -0.1);
    cyl(0.011, 0.011, 0.028, M.gunmetal, scope, 'y', 0, 0.028, -0.01);    // 터렛
    cyl(0.011, 0.011, 0.028, M.gunmetal, scope, 'x', 0.028, 0, -0.01);
    cyl(0.025, 0.025, 0.002, M.lens, scope, 'z', 0, 0, -0.2015);          // 렌즈
    cyl(0.019, 0.019, 0.002, M.lensDark, scope, 'z', 0, 0, 0.1755);
    box(0.022, 0.03, 0.02, M.gunmetal, g, 0, 0.05, -0.14);                // 마운트
    box(0.022, 0.03, 0.02, M.gunmetal, g, 0, 0.05, 0.0);
    const bolt = new THREE.Group();                                        // 볼트 손잡이(오른쪽)
    bolt.position.set(0.024, 0.014, 0.035);
    g.add(bolt);
    cyl(0.005, 0.005, 0.05, M.steel, bolt, 'x', 0.025, 0, 0);
    sphere(0.0095, M.black, bolt, 0.052, 0, 0);
    parts.bolt = bolt;
    cyl(0.004, 0.004, 0.16, M.gunmetal, g, 'z', 0.014, -0.036, -0.38);    // 접힌 양각대
    cyl(0.004, 0.004, 0.16, M.gunmetal, g, 'z', -0.014, -0.036, -0.38);
    label(g, 'NOR-1', 0.11, 0.028, -0.0215, -0.012, 0.17, '#f2c230');
    label(g, 'NOTICE OF READINESS', 0.2, 0.016, -0.0255, -0.004, -0.31, '#d6deea');
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.008, -0.955);
    g.add(muzzle);
    return {
      g, parts, muzzle,
      arms: { R: makeArm('R', 0, -0.072, 0.052, [0.35, -0.45, 1]), L: makeArm('L', 0, -0.05, -0.32, [-0.55, -0.5, 0.75]) },
      hip: [0.15, -0.165, -0.36], hipRot: [0, 0.03, 0],
      ads: [0, -0.072, -0.3],               // 스코프 접안부가 눈앞으로(0.9 넘으면 숨김)
      kick: { z: 0.075, pitch: 0.17, roll: 0.03 }, flash: 1.5,
    };
  }

  function buildDwt47() {
    const g = new THREE.Group();
    const parts = {};
    box(0.048, 0.05, 0.28, M.black, g, 0, 0.012, -0.06);                  // 상부 리시버
    box(0.042, 0.035, 0.17, M.oxideDark, g, 0, -0.03, -0.04);             // 하부 리시버
    box(0.056, 0.058, 0.23, M.oxide, g, 0, 0.006, -0.31);                 // 총열덮개(선체 방청 적색)
    for (let i = 0; i < 3; i++) box(0.002, 0.014, 0.024, M.black, g, -0.0285, 0.008, -0.26 - i * 0.042);  // 통풍구
    box(0.022, 0.008, 0.5, M.black, g, 0, 0.041, -0.18);                  // 상부 레일
    cyl(0.0095, 0.0095, 0.17, M.gunmetal, g, 'z', 0, 0.01, -0.5);         // 총열
    cyl(0.015, 0.015, 0.05, M.black, g, 'z', 0, 0.01, -0.6);              // 소염기
    box(0.04, 0.066, 0.2, M.oxide, g, 0, -0.012, 0.17);                   // 개머리
    box(0.044, 0.076, 0.02, M.black, g, 0, -0.014, 0.275);
    box(0.03, 0.085, 0.042, M.black, g, 0, -0.065, 0.045).rotation.x = 0.32;
    box(0.008, 0.006, 0.055, M.black, g, 0, -0.05, 0.0);
    box(0.008, 0.024, 0.006, M.black, g, 0, -0.04, -0.026);
    box(0.004, 0.016, 0.005, M.steel, g, 0, -0.04, -0.004);
    box(0.02, 0.008, 0.02, M.gunmetal, g, 0, 0.04, 0.07);                 // 장전 손잡이
    const mag = new THREE.Group();                                         // 굽은 탄창
    mag.position.set(0, -0.05, -0.095);
    g.add(mag);
    box(0.03, 0.085, 0.056, M.oxide, mag, 0, -0.037, 0).rotation.x = 0.1;
    box(0.03, 0.05, 0.056, M.oxide, mag, 0, -0.095, 0.012).rotation.x = 0.28;
    box(0.034, 0.008, 0.06, M.black, mag, 0, -0.122, 0.02).rotation.x = 0.28;
    // 만재흘수선 표(Load Line mark): 원 + 가로선 + 계단 눈금(단순화)
    decal(mag, 0.042, 0.042, -0.0155, -0.045, 0, -Math.PI / 2, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = '#f4efe2'; c.fillStyle = '#f4efe2'; c.lineWidth = w * 0.045;
      c.beginPath(); c.arc(w * 0.36, h * 0.5, w * 0.22, 0, Math.PI * 2); c.stroke();
      c.fillRect(w * 0.08, h * 0.475, w * 0.56, h * 0.05);
      c.fillRect(w * 0.72, h * 0.22, w * 0.04, h * 0.56);
      for (let i = 0; i < 4; i++) c.fillRect(w * 0.76, h * (0.24 + i * 0.16), w * 0.16, h * 0.04);
    }, 128);
    parts.mag = mag;
    const sight = new THREE.Group();                                       // 홀로 조준경
    sight.position.set(0, 0.058, -0.1);
    g.add(sight);
    box(0.036, 0.012, 0.06, M.black, sight, 0, 0, 0);
    box(0.004, 0.034, 0.008, M.black, sight, 0.0175, 0.023, -0.022);
    box(0.004, 0.034, 0.008, M.black, sight, -0.0175, 0.023, -0.022);
    box(0.039, 0.004, 0.008, M.black, sight, 0, 0.042, -0.022);
    add(new THREE.PlaneGeometry(0.031, 0.03), M.glass, sight, 0, 0.023, -0.022, 2);
    add(new THREE.CircleGeometry(0.0017, 12), M.dot, sight, 0, 0.023, -0.0235, 3);
    label(g, 'DWT-47', 0.1, 0.024, -0.0245, 0.012, -0.04, '#ece4cf');
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.01, -0.63);
    g.add(muzzle);
    return {
      g, parts, muzzle,
      arms: { R: makeArm('R', 0, -0.074, 0.058, [0.35, -0.45, 1]), L: makeArm('L', 0, -0.046, -0.3, [-0.6, -0.5, 0.7]) },
      hip: [0.14, -0.155, -0.31], hipRot: [0, 0.03, 0],
      ads: [0, -0.081, -0.2],               // 조준점이 화면 가운데(약 0.32m 앞)에 오도록
      kick: { z: 0.022, pitch: 0.035, roll: 0.012 }, flash: 1.0,
    };
  }

  function buildSof9() {
    const g = new THREE.Group();
    const parts = {};
    const slide = new THREE.Group();
    slide.position.set(0, 0.032, -0.07);
    g.add(slide);
    box(0.03, 0.032, 0.19, M.gray, slide, 0, 0, 0);
    for (let i = 0; i < 4; i++) box(0.002, 0.022, 0.004, M.black, slide, -0.0155, 0, 0.062 + i * 0.009);
    box(0.022, 0.009, 0.008, M.black, slide, 0, 0.02, 0.085);
    box(0.005, 0.009, 0.006, M.black, slide, 0, 0.02, -0.088);
    box(0.003, 0.003, 0.002, M.tritium, slide, 0, 0.022, -0.0915);
    box(0.003, 0.003, 0.002, M.tritium, slide, -0.007, 0.022, 0.0895);
    box(0.003, 0.003, 0.002, M.tritium, slide, 0.007, 0.022, 0.0895);
    cyl(0.0065, 0.0065, 0.012, M.black, slide, 'z', 0, 0.002, -0.098);
    label(slide, 'SOF-9', 0.07, 0.016, -0.0155, 0.002, -0.02, '#f2f4f7');
    parts.slide = slide;
    box(0.028, 0.022, 0.16, M.black, g, 0, 0.007, -0.06);                  // 프레임
    box(0.02, 0.008, 0.05, M.black, g, 0, -0.008, -0.11);
    box(0.03, 0.095, 0.046, M.black, g, 0, -0.045, 0.005).rotation.x = 0.25;
    box(0.031, 0.06, 0.034, M.navy, g, 0, -0.045, 0.007).rotation.x = 0.25; // 손잡이 패널
    box(0.006, 0.006, 0.045, M.black, g, 0, -0.012, -0.045);
    box(0.006, 0.02, 0.006, M.black, g, 0, -0.002, -0.068);
    box(0.004, 0.016, 0.005, M.steel, g, 0, -0.002, -0.036);
    const mag = new THREE.Group();
    g.add(mag);
    box(0.022, 0.08, 0.034, M.gunmetal, mag, 0, -0.05, 0.006).rotation.x = 0.25;
    box(0.027, 0.009, 0.042, M.gray, mag, 0, -0.096, 0.017).rotation.x = 0.25;
    parts.mag = mag;
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.034, -0.172);
    g.add(muzzle);
    return {
      g, parts, muzzle,
      arms: { R: makeArm('R', 0, -0.052, 0.018, [0.3, -0.5, 1]), L: makeArm('L', -0.014, -0.066, 0.004, [-0.45, -0.55, 0.9]) },
      hip: [0.1, -0.112, -0.26], hipRot: [0.02, 0.15, -0.05],    // 슬라이드 왼쪽 면(SOF-9 표기)이 보이게
      ads: null,
      kick: { z: 0.035, pitch: 0.12, roll: 0.02 }, flash: 0.75,
    };
  }

  function buildHawser() {
    const g = new THREE.Group();
    const parts = {};
    cyl(0.0155, 0.017, 0.11, M.ropeDark, g, 'z', 0, 0, 0.035);             // 손잡이
    for (let i = 0; i < 6; i++) torus(0.0168, 0.0032, M.rope, g, 0, 0, -0.01 + i * 0.018);   // 밧줄 감기
    box(0.014, 0.054, 0.012, M.black, g, 0, -0.004, -0.024);               // 날밑
    cyl(0.0175, 0.014, 0.016, M.black, g, 'z', 0, 0, 0.098);               // 손잡이 끝
    torus(0.009, 0.0022, M.cuff, g, 0, -0.012, 0.11).rotation.y = Math.PI / 2;   // 끈 고리
    // 갈고리형(hawkbill) 날 + 톱니: 밧줄을 끊는 칼날 모양
    const s = new THREE.Shape();
    s.moveTo(0, 0.011);
    s.lineTo(0.115, 0.011);
    s.quadraticCurveTo(0.156, 0.009, 0.168, -0.018);
    s.lineTo(0.162, -0.021);
    s.quadraticCurveTo(0.142, -0.004, 0.11, -0.006);
    for (let u = 0.11; u > 0.03; u -= 0.012) { s.lineTo(u - 0.006, -0.013); s.lineTo(u - 0.012, -0.007); }
    s.lineTo(0, -0.012);
    s.lineTo(0, 0.011);
    const bg = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.001, bevelSegments: 1, curveSegments: 8 });
    bg.translate(0, 0, -0.002);
    bg.rotateY(Math.PI / 2);                                               // 길이 → -z, 두께 → x
    parts.blade = add(bg, M.steel, g, 0, 0, -0.03);
    decal(g, 0.05, 0.009, -0.0037, 0.002, -0.095, -Math.PI / 2, textDraw([{ text: 'HAWSER', size: 0.8, y: 0.55, color: '#2a2f36' }]), 256);
    return {
      g, parts, muzzle: null,
      arms: { R: makeArm('R', 0, 0, 0.035, [0.3, -0.5, 1]), L: null },
      hip: [0.13, -0.128, -0.29], hipRot: [0.25, 0.45, -1.05],   // 날의 넓은 면이 보이게 시계 방향으로 눕힘
      ads: null,
      kick: { z: 0, pitch: 0, roll: 0 }, flash: 0,
    };
  }

  function buildBunker() {
    const g = new THREE.Group();
    const parts = {};
    const nade = new THREE.Group();                                         // 작은 연료 드럼
    g.add(nade);
    cyl(0.032, 0.032, 0.078, M.drum, nade, 'y', 0, 0, 0, 20);
    cyl(0.0326, 0.0326, 0.01, M.black, nade, 'y', 0, 0.027, 0, 20);
    cyl(0.0326, 0.0326, 0.01, M.black, nade, 'y', 0, -0.027, 0, 20);
    torus(0.0332, 0.0026, M.drumDark, nade, 0, 0.012, 0).rotation.x = Math.PI / 2;   // 굴림테
    torus(0.0332, 0.0026, M.drumDark, nade, 0, -0.012, 0).rotation.x = Math.PI / 2;
    cyl(0.0305, 0.032, 0.006, M.drum, nade, 'y', 0, 0.042, 0, 20);
    cyl(0.01, 0.012, 0.02, M.gunmetal, nade, 'y', 0, 0.055, 0);            // 신관
    cyl(0.006, 0.006, 0.006, M.black, nade, 'y', 0.016, 0.046, 0.008);      // 주입구 마개
    box(0.012, 0.07, 0.005, M.steel, nade, -0.034, 0.024, 0).rotation.z = -0.08;  // 안전 손잡이
    box(0.026, 0.005, 0.012, M.steel, nade, -0.023, 0.062, 0);
    const pin = new THREE.Group();
    pin.position.set(0.012, 0.058, 0);
    nade.add(pin);
    torus(0.011, 0.0018, M.steel, pin, 0.012, 0, 0).rotation.y = Math.PI / 2;
    cyl(0.0015, 0.0015, 0.026, M.steel, pin, 'x', 0, 0, 0);
    parts.pin = pin;
    parts.nade = nade;
    // 둥근 몸통 라벨(곡면): BUNKER / VLSFO 0.5%S(국제 규제 저유황 연료유 표기)
    const tex = canvasTexture(512, 160, textDraw([
      { text: 'BUNKER', size: 0.5, y: 0.38, color: '#15171a' },
      { text: 'VLSFO · 0.5%S', size: 0.24, y: 0.78, color: '#15171a', weight: 700 },
    ]));
    if (tex) {
      const lm = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
      owned.mats.add(lm);
      // 라벨 중심 θ=-0.1 → 손에 든 각도(hipRot y -0.35)에서 카메라 쪽(-0.45rad)을 본다
      add(new THREE.CylinderGeometry(0.0328, 0.0328, 0.034, 20, 1, true, -0.1 - 0.95, 1.9), lm, nade, 0, 0, 0, 1);
    }
    const L = makeArm('L', -0.09, -0.13, 0.06, [-0.4, -0.5, 0.8]);
    L.userData.hiddenIdle = true;
    return {
      g, parts, muzzle: null,
      arms: { R: makeArm('R', 0.004, -0.05, 0.012, [0.3, -0.5, 1]), L },
      hip: [0.115, -0.085, -0.27], hipRot: [0.15, -0.35, 0.05],
      ads: null,
      kick: { z: 0, pitch: 0, roll: 0 }, flash: 0,
    };
  }

  const BUILDERS = { nor1: buildNor1, dwt47: buildDwt47, sof9: buildSof9, hawser: buildHawser, bunker: buildBunker };
  const models = Object.create(null);

  function finalize(model) {
    for (const a of [model.arms.R, model.arms.L]) if (a) model.g.add(a);
    model.g.traverse((o) => {
      o.layers.set(VIEWMODEL_LAYER);
      if (o.isMesh) {
        o.renderOrder = RO + (o.userData.vmOrder || 0);
        o.frustumCulled = false;
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    for (const k of Object.keys(model.parts)) {
      const p = model.parts[k];
      p.userData.base = { pos: p.position.clone(), rot: p.rotation.clone() };
    }
    model.g.visible = false;
    pose.add(model.g);
    return model;
  }

  function ensureModel(id) {
    if (!models[id]) {
      const m = BUILDERS[id]();
      m.id = id;
      m.def = WEAPONS[id];
      models[id] = finalize(m);
    }
    return models[id];
  }

  function resetParts(m) {
    if (!m) return;
    for (const k of Object.keys(m.parts)) {
      const p = m.parts[k];
      const b = p.userData.base;
      if (b) { p.position.copy(b.pos); p.rotation.copy(b.rot); }
      p.visible = true;
    }
    for (const a of [m.arms.R, m.arms.L]) {
      if (!a) continue;
      a.position.copy(a.userData.base);
      a.visible = !a.userData.hiddenIdle;
    }
  }

  // ── 깊이 지우기 센티넬 ─────────────────────────────────────
  // 투명 목록에서 가장 먼저 그려져 깊이를 지운다 → 뒤이어 그려지는 무기 모형은 벽에 파묻히지 않는다.
  const sentinelMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true });
  owned.mats.add(sentinelMat);
  const sentinel = add(new THREE.PlaneGeometry(1e-4, 1e-4), sentinelMat, root, 0, 0, -0.5);
  sentinel.renderOrder = RO - 1;
  sentinel.frustumCulled = false;
  sentinel.layers.set(VIEWMODEL_LAYER);
  let clearDepth = opts.clearDepth !== false;
  sentinel.onBeforeRender = (renderer, scene, cam) => {
    if (!clearDepth || cam !== camera || !renderer) return;
    if (renderer.state && renderer.state.buffers) renderer.state.buffers.depth.setMask(true);
    renderer.clearDepth();
  };

  // ── 총구 섬광(내장) ───────────────────────────────────────
  let flash = null;
  if (useFlash) {
    const tex = canvasTexture(128, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.translate(w / 2, h / 2);
      const gr = c.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      gr.addColorStop(0, 'rgba(255,252,230,1)');
      gr.addColorStop(0.3, 'rgba(255,205,100,0.9)');
      gr.addColorStop(1, 'rgba(255,120,20,0)');
      c.fillStyle = gr;
      c.beginPath();
      for (let i = 0; i < 14; i++) {
        const r = i % 2 ? w * 0.16 : w * 0.5;
        const a = (i / 14) * Math.PI * 2;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
    });
    const fm = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0xffc060, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: false, side: THREE.DoubleSide, opacity: tex ? 1 : 0.6 });
    owned.mats.add(fm);
    const fg = new THREE.Group();
    const front = add(new THREE.PlaneGeometry(0.11, 0.11), fm, fg, 0, 0, -0.01, 5);
    const sideA = add(new THREE.PlaneGeometry(0.07, 0.2), fm, fg, 0, 0, -0.09, 5);
    sideA.rotation.set(-Math.PI / 2, 0, 0);
    const sideB = add(new THREE.PlaneGeometry(0.07, 0.2), fm, fg, 0, 0, -0.09, 5);
    sideB.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
    fg.traverse((o) => { o.layers.set(VIEWMODEL_LAYER); if (o.isMesh) { o.renderOrder = RO + 5; o.frustumCulled = false; } });
    fg.visible = false;
    flash = { g: fg, front, t: 0 };
  }

  // ── 애니메이션 상태 ────────────────────────────────────────
  let curId = null, cur = null;
  let visible = true;
  let time = 0;
  let drawT = 1, drawDur = 0.5;
  let reloadT = -1, reloadDur = 2, reloadEmpty = false;
  let act = null;               // { type: 'slash'|'stab'|'bolt'|'prime'|'throw', t, dur, index, kind }
  let slideT = 1;
  let adsBlend = 0, bobPhase = 0, bobAmt = 0, airTime = 0, wasOnGround = true;
  let refFov = camera.fov || 60;
  const kz = spring(240, 0.8), kp = spring(240, 0.75), kr = spring(200, 0.8), land = spring(120, 0.7);
  const swayX = spring(90, 0.9), swayY = spring(90, 0.9);
  const qPrev = new THREE.Quaternion(), qNow = new THREE.Quaternion(), qDelta = new THREE.Quaternion();
  const eDelta = new THREE.Euler(0, 0, 0, 'YXZ');
  let qInit = false;
  const tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpW = new THREE.Vector3();
  let warnedMount = false;

  function setWeapon(id) {
    if (!BUILDERS[id]) return false;
    if (id === curId && cur) return true;
    const m = ensureModel(id);
    for (const k of Object.keys(models)) models[k].g.visible = k === id;
    curId = id;
    cur = m;
    resetParts(m);
    act = null;
    reloadT = -1;
    slideT = 1;
    adsBlend = 0;
    drawT = 0;
    drawDur = Math.max(0.05, num(WEAPONS[id].drawTime, 0.5));
    if (flash) {
      (m.muzzle || pose).add(flash.g);
      flash.g.visible = false;
      flash.t = 0;
    }
    return true;
  }

  function kick() {
    if (!cur) return;
    const k = cur.kick;
    const ads = 1 - 0.55 * adsBlend;
    kz.x = clamp(kz.x + k.z * ads, -0.2, 0.2);
    kp.x = clamp(kp.x + k.pitch * ads, -0.5, 0.5);
    kr.x = clamp(kr.x + (Math.random() - 0.5) * 2 * k.roll, -0.2, 0.2);
    if (cur.parts.slide) slideT = 0;
    if (flash && cur.muzzle && cur.flash > 0) {
      flash.t = 0.05;
      flash.g.visible = true;
      flash.g.rotation.z = Math.random() * Math.PI;
      const s = cur.flash * (0.85 + Math.random() * 0.3);
      flash.g.scale.set(s, s, s);
    }
  }

  /** arsenal 이벤트를 그대로 넘긴다. */
  function play(ev) {
    if (!ev || typeof ev !== 'object') return;
    switch (ev.type) {
      case 'switch':
        if (ev.to && BUILDERS[ev.to]) {
          if (ev.to !== curId) setWeapon(ev.to);
          else resetParts(cur);
          act = null;
          reloadT = -1;
          drawDur = num(ev.drawTime, 0) > 0 ? ev.drawTime : 0.0001;
          drawT = num(ev.drawTime, 0) > 0 ? 0 : 1;
        }
        break;
      case 'fire': kick(); break;
      case 'dryFire': kp.v -= 0.6; break;
      case 'reloadStart':
        reloadT = 0;
        reloadDur = Math.max(0.1, num(ev.duration, 2));
        reloadEmpty = !!ev.empty;
        break;
      case 'reloadEnd':
      case 'reloadCancel':
        reloadT = -1;
        resetParts(cur);
        break;
      case 'boltCycle': act = { type: 'bolt', t: 0, dur: Math.max(0.2, num(ev.duration, 1.2)) }; break;
      case 'swing':
        act = ev.kind === 'stab' ? { type: 'stab', t: 0, dur: 0.75 } : { type: 'slash', t: 0, dur: 0.36, index: ev.index | 0 };
        break;
      case 'swingCancel': if (act && (act.type === 'slash' || act.type === 'stab')) act = null; break;
      case 'prime': act = { type: 'prime', t: 0, dur: Infinity, kind: ev.kind }; break;
      case 'primeCancel': act = null; resetParts(cur); break;
      case 'throw': act = { type: 'throw', t: 0, dur: 0.36, kind: ev.kind }; break;
      default: break;
    }
  }

  // ── 동작별 오프셋(o: 위치 px/py/pz, 회전 rx/ry/rz 누적) ──────────────
  function reloadAnim(m, u, o) {
    // 총을 시계 방향으로 눕히고(탄창 구멍이 왼손 쪽) 총구를 안쪽·위로 → 화면을 가로지르는 자세
    const down = smooth(0, 0.16, u) * (1 - smooth(0.84, 1, u));
    o.py -= 0.03 * down; o.px -= 0.01 * down; o.pz += 0.05 * down;
    o.rx += 0.12 * down; o.ry += 0.35 * down; o.rz -= 0.45 * down;
    const mag = m.parts.mag;
    if (mag) {
      const b = mag.userData.base.pos;
      const off = smooth(0.18, 0.36, u) * (1 - smooth(0.52, 0.74, u));
      mag.position.set(b.x, b.y - 0.16 * off, b.z + 0.03 * off);
      mag.visible = !(u > 0.37 && u < 0.51);
      const L = m.arms.L;
      if (L) {
        const lb = L.userData.base;
        const grab = smooth(0.06, 0.2, u) * (1 - smooth(0.78, 0.94, u));
        L.position.set(lerp(lb.x, b.x - 0.01, grab), lerp(lb.y, b.y - 0.07 - 0.16 * off, grab), lerp(lb.z, b.z + 0.02 + 0.03 * off, grab));
      }
    }
    if (m.parts.bolt && reloadEmpty) boltParts(m, smooth(0.8, 0.97, u) * 0.999, o, false);
    if (m.parts.slide) {
      const s = m.parts.slide, b = s.userData.base.pos;
      const locked = reloadEmpty && u < 0.82;
      s.position.z = b.z + (locked ? 0.026 : 0.026 * (reloadEmpty ? 1 - smooth(0.82, 0.88, u) : 0));
    }
  }

  function boltParts(m, u, o, tiltGun = true) {
    const bolt = m.parts.bolt;
    if (!bolt) return;
    if (tiltGun) {
      const tilt = smooth(0.04, 0.18, u) * (1 - smooth(0.78, 0.96, u));
      o.rz -= 0.22 * tilt; o.py -= 0.012 * tilt; o.rx += 0.05 * tilt; o.px -= 0.01 * tilt;
    }
    const b = bolt.userData.base.pos;
    const lift = smooth(0.18, 0.3, u) - smooth(0.62, 0.74, u);
    const pull = smooth(0.3, 0.44, u) - smooth(0.48, 0.62, u);
    bolt.rotation.z = 1.1 * lift;
    bolt.position.z = b.z + 0.055 * pull;
    const R = m.arms.R;
    if (R) {
      const rb = R.userData.base;
      const reach = smooth(0.08, 0.2, u) * (1 - smooth(0.72, 0.86, u));
      R.position.set(lerp(rb.x, b.x + 0.06, reach), lerp(rb.y, b.y + 0.01 + 0.03 * lift, reach), lerp(rb.z, b.z + 0.03 + 0.055 * pull, reach));
    }
  }

  function slashAnim(u, index, o) {
    const wind = smooth(0, 0.2, u) * (1 - smooth(0.2, 0.32, u));
    const s = smooth(0.18, 0.48, u) * (1 - smooth(0.55, 1, u));
    if (index % 2 === 0) {        // 오른쪽 위 → 왼쪽 아래
      o.px += 0.05 * wind - 0.22 * s; o.py += 0.05 * wind - 0.05 * s; o.pz -= 0.08 * s;
      o.ry += -0.35 * wind + 1.1 * s; o.rz += -0.6 * wind + 1.0 * s; o.rx -= 0.25 * s;
    } else {                      // 오른쪽 아래 → 왼쪽 위(올려 베기)
      o.px += 0.03 * wind - 0.2 * s; o.py += -0.05 * wind + 0.07 * s; o.pz -= 0.07 * s;
      o.ry += -0.25 * wind + 0.9 * s; o.rz += 0.5 * wind - 0.9 * s; o.rx += 0.2 * s;
    }
  }

  function stabAnim(u, o) {
    const pull = smooth(0, 0.3, u) * (1 - smooth(0.3, 0.4, u));
    const th = smooth(0.29, 0.4, u) * (1 - smooth(0.62, 1, u));
    o.pz += 0.08 * pull - 0.26 * th; o.px -= 0.08 * th; o.py += 0.02 * pull + 0.03 * th;
    o.rx += 0.2 * pull - 0.45 * th; o.ry -= 0.25 * th; o.rz += 0.3 * th;
  }

  function primeAnim(m, u, kind, o) {
    const k = smooth(0, 1, u);
    if (kind === 'underhand') { o.py -= 0.04 * k; o.pz += 0.05 * k; o.rx -= 0.3 * k; }
    else { o.py += 0.03 * k; o.pz += 0.04 * k; o.rx += 0.45 * k; o.px += 0.015 * k; }
    const pin = m.parts.pin, L = m.arms.L;
    const reach = smooth(0, 0.45, u), pull = smooth(0.5, 0.9, u);
    if (L) {
      const lb = L.userData.base;
      L.visible = true;
      L.position.set(lerp(lb.x, 0.0, reach) - 0.09 * pull, lerp(lb.y, 0.05, reach) - 0.03 * pull, lerp(lb.z, 0.03, reach) + 0.03 * pull);
    }
    if (pin) {
      const pb = pin.userData.base.pos;
      pin.position.set(pb.x - 0.09 * pull, pb.y - 0.03 * pull, pb.z + 0.03 * pull);
      pin.visible = u < 0.95;
    }
  }

  function throwAnim(m, u, kind, o) {
    const sw = smooth(0, 0.35, u), drop = smooth(0.35, 1, u);
    if (kind === 'underhand') {
      o.py += -0.04 + 0.07 * sw - 0.3 * drop; o.pz += 0.05 - 0.3 * sw; o.rx += -0.3 + 0.5 * sw;
    } else {
      o.py += 0.03 - 0.01 * sw - 0.3 * drop; o.pz += 0.04 - 0.32 * sw; o.rx += 0.45 - 1.3 * sw; o.px += 0.015 - 0.05 * sw;
    }
    if (m.parts.nade) m.parts.nade.visible = u < 0.22;
    if (m.parts.pin) m.parts.pin.visible = false;
    if (m.arms.L) m.arms.L.visible = u < 0.3;
  }

  const o = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };

  /**
   * @param {number} dt
   * @param {object} [s] arsenal.getViewState() — { weaponId, phase, phaseT, zoom, overlay, hideViewmodel, speed, onGround, mag, ... }
   */
  function update(dt, s = {}) {
    dt = clamp(num(dt, 0), 0, 0.1);
    s = s || {};
    if (s.weaponId && s.weaponId !== curId) setWeapon(s.weaponId);
    if (!cur && !curId) setWeapon('dwt47');
    const m = cur;
    time += dt;
    if (!warnedMount && !mountScene && !camera.parent) {
      warnedMount = true;
      if (typeof console !== 'undefined') console.warn('[weapons/viewmodel] camera가 씬에 없어 무기 모형이 보이지 않습니다. scene.add(camera) 또는 opts.scene을 쓰세요.');
    }

    // 카메라 따라가기(씬에 붙인 경우)
    if (followCamera) {
      camera.updateWorldMatrix(true, false);
      camera.matrixWorld.decompose(root.position, root.quaternion, tmpS);
    }

    // 보이기/숨기기(스코프)
    const zoom = clamp(num(s.zoom, 0), 0, 1);
    const overlay = s.overlay !== undefined ? s.overlay : m.def.zoom ? m.def.zoom.overlay : null;
    const hide = s.hideViewmodel !== undefined ? !!s.hideViewmodel : !!overlay && zoom > 0.9;
    root.visible = visible && !hide;

    // 카메라 FOV가 줌으로 좁아져도 모형 크기는 그대로(월드 카메라에 붙인 경우)
    if (!(zoom > 0)) refFov = camera.fov || refFov;
    const kf = camera.fov > 0 ? Math.max(1, Math.tan((refFov * DEG) / 2) / Math.tan((camera.fov * DEG) / 2)) : 1;
    root.scale.set(S / kf, S / kf, S);

    // 타이머
    if (drawT < 1) drawT = Math.min(1, drawT + dt / drawDur);
    if (reloadT >= 0) { reloadT += dt / reloadDur; if (reloadT >= 1 && s.phase !== 'reload') { reloadT = -1; resetParts(m); } }
    if (act) { act.t += dt; if (act.t >= act.dur) { if (act.type === 'bolt') resetParts(m); act = null; } }
    if (s.phase === 'bolt' && (!act || act.type !== 'bolt')) act = { type: 'bolt', t: num(s.phaseT, 0) * 1.2, dur: 1.2 };
    if (s.phase === 'prime' && (!act || act.type !== 'prime')) act = { type: 'prime', t: 0.3, dur: Infinity, kind: s.primeKind };
    slideT = Math.min(1, slideT + dt / 0.075);
    if (flash && flash.t > 0) { flash.t -= dt; if (flash.t <= 0) flash.g.visible = false; }

    o.px = o.py = o.pz = o.rx = o.ry = o.rz = 0;

    // 꺼내기(교체 올리기)
    // 상태(s.phase)가 오면 그것을 따르고, 없으면 이벤트로 시작한 내부 타이머를 쓴다
    const hasPhase = typeof s.phase === 'string';
    let drawK = 0;
    if (s.phase === 'draw') drawK = 1 - easeOutCubic(num(s.phaseT, 1));
    else if (!hasPhase && drawT < 1) drawK = 1 - easeOutCubic(drawT);
    o.py -= 0.24 * drawK; o.pz += 0.05 * drawK; o.rx -= 0.9 * drawK; o.rz += 0.25 * drawK;

    // 재장전(내리기 + 탄창)
    const rT = hasPhase ? (s.phase === 'reload' ? clamp(num(s.phaseT, 0), 0, 1) : -1)
      : reloadT >= 0 ? clamp(reloadT, 0, 1) : -1;
    if (s.reloadEmpty !== undefined && s.phase === 'reload') reloadEmpty = !!s.reloadEmpty;
    if (rT >= 0) reloadAnim(m, rT, o);
    else if (hasPhase && reloadT >= 0) { reloadT = -1; resetParts(m); }

    // 동작
    if (act) {
      const u = Number.isFinite(act.dur) ? clamp(act.t / act.dur, 0, 1) : act.t;
      if (act.type === 'bolt') boltParts(m, u, o, true);
      else if (act.type === 'slash') slashAnim(u, act.index || 0, o);
      else if (act.type === 'stab') stabAnim(u, o);
      else if (act.type === 'prime') primeAnim(m, clamp(act.t / 0.3, 0, 1), act.kind, o);
      else if (act.type === 'throw') throwAnim(m, u, act.kind, o);
    }

    // 권총 슬라이드: 쏠 때 뒤로, 탄이 0이면 젖혀진 채로
    if (m.parts.slide && rT < 0) {
      const b = m.parts.slide.userData.base.pos;
      const u = slideT;
      let back = u < 1 ? 0.026 * (u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65) : 0;
      if (s.mag === 0) back = 0.026;
      m.parts.slide.position.z = b.z + back;
    }

    // 조준(ADS): 소총은 조준경을 화면 가운데로, 저격은 스코프 쪽으로 당기다가 0.9에서 숨김
    const zoomDef = m.def.zoom;
    const adsTarget = m.ads && zoomDef ? (zoomDef.overlay ? Math.min(1, zoom / 0.9) * 0.9 : zoom) : 0;
    adsBlend = approach(adsBlend, adsTarget, 28, dt);

    // 걷기 흔들림 + 숨쉬기
    const speed = Math.max(0, num(s.speed, 0));
    const onGround = s.onGround !== false;
    bobAmt = approach(bobAmt, clamp(speed / 5.2, 0, 1.3) * (onGround ? 1 : 0.15), 8, dt);
    bobPhase += dt * (4 + speed * 1.15);
    const amp = bobAmt * (1 - 0.8 * adsBlend);
    const breathe = 1 - 0.85 * adsBlend;
    o.px += Math.sin(bobPhase) * 0.011 * amp + Math.cos(time * 0.9) * 0.0012 * breathe;
    o.py += (-Math.abs(Math.cos(bobPhase)) + 0.5) * 0.012 * amp + Math.sin(time * 1.7) * 0.0016 * breathe;
    o.rz += Math.sin(bobPhase) * 0.02 * amp;

    // 착지 출렁임
    if (!onGround) airTime += dt;
    if (onGround && !wasOnGround) land.v -= 0.5 * clamp(airTime / 0.6, 0.3, 1.2);
    if (!onGround && wasOnGround) land.v += 0.15;
    if (onGround) airTime = 0;
    wasOnGround = onGround;
    stepSpring(land, dt);
    o.py += land.x * 0.06;
    o.rx += land.x * 0.15;

    // 시점 회전에 끌려오는 흔들림(sway)
    lookCam.getWorldQuaternion(qNow);
    if (qInit && dt > 0) {
      qDelta.copy(qPrev).invert().multiply(qNow);
      eDelta.setFromQuaternion(qDelta, 'YXZ');
      const yawRate = clamp(eDelta.y / dt, -12, 12), pitchRate = clamp(eDelta.x / dt, -12, 12);
      const f = 1 - 0.75 * adsBlend;
      stepSpring(swayX, dt, clamp(yawRate * 0.0035, -0.024, 0.024) * f);
      stepSpring(swayY, dt, clamp(-pitchRate * 0.0035, -0.02, 0.02) * f);
    }
    qPrev.copy(qNow);
    qInit = true;
    o.px += swayX.x; o.py += swayY.x; o.rz -= swayX.x * 2.5; o.rx -= swayY.x * 1.5;

    // 반동 킥(스프링)
    stepSpring(kz, dt); stepSpring(kp, dt); stepSpring(kr, dt);
    o.pz += kz.x; o.rx += kp.x; o.rz += kr.x; o.py += kp.x * 0.04;

    // 합성
    const hip = m.hip, ads = m.ads || m.hip, hr = m.hipRot;
    pose.position.set(lerp(hip[0], ads[0], adsBlend) + o.px, lerp(hip[1], ads[1], adsBlend) + o.py, lerp(hip[2], ads[2], adsBlend) + o.pz);
    pose.rotation.set(hr[0] * (1 - adsBlend) + o.rx, hr[1] * (1 - adsBlend) + o.ry, hr[2] * (1 - adsBlend) + o.rz, 'XYZ');
  }

  /**
   * 총구 위치(월드 좌표). FX의 섬광·예광탄 시작점용.
   * 뷰모델 전용 카메라를 쓰는 경우, 화면에서 같은 자리에 보이도록 worldCamera의 시선 위로 옮겨 준다.
   * @param {THREE.Vector3} [out]
   * @param {THREE.Camera} [worldCamera=opts.lookCamera]
   * @returns {THREE.Vector3|null} 칼·수류탄이면 null
   */
  function getMuzzleWorld(out = new THREE.Vector3(), worldCamera = lookCam) {
    if (!cur || !cur.muzzle) return null;
    root.updateWorldMatrix(true, true);
    cur.muzzle.getWorldPosition(out);
    if (!worldCamera || worldCamera === camera || !worldCamera.isCamera) return out;
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(tmpV);
    const d = out.distanceTo(tmpV);
    out.project(camera);
    out.z = 0.5;
    worldCamera.updateWorldMatrix(true, false);
    out.unproject(worldCamera);
    worldCamera.getWorldPosition(tmpW);
    return out.sub(tmpW).normalize().multiplyScalar(d).add(tmpW);
  }

  function setTeam(team) {
    const c = TEAM_SLEEVE[team] ?? COLOR.sleeve;
    M.sleeve.color.setHex(c);
    M.sleeve.emissive.setHex(c).multiplyScalar(0.12);
  }
  if (opts.team) setTeam(opts.team);

  function dispose() {
    root.removeFromParent();
    camera.layers.disable(VIEWMODEL_LAYER);
    for (const g of owned.geos) g.dispose();
    for (const mm of owned.mats) mm.dispose();
    for (const t of owned.texs) t.dispose();
    owned.geos.clear(); owned.mats.clear(); owned.texs.clear();
    for (const k of Object.keys(models)) delete models[k];
    cur = null; curId = null;
  }

  return {
    /** 최상위 그룹(디버그용) */
    group: root,
    setWeapon,
    play,
    update,
    setTeam,
    getMuzzleWorld,
    /** 사망·관전 때 숨기기 */
    setVisible: (v) => { visible = !!v; root.visible = visible; },
    setClearDepth: (v) => { clearDepth = !!v; },
    getWeaponId: () => curId,
    /** 미리 만들어 두기(첫 교체 때 끊김 방지) */
    preload: (ids = Object.keys(BUILDERS)) => { for (const id of ids) if (BUILDERS[id]) ensureModel(id); },
    dispose,
  };
}
