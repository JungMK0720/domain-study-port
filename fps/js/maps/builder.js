/**
 * ⚓ Port Ops — 맵 빌더
 *
 *   const map = buildMap(data, scene);
 *   map.colliders / map.world (physics) / map.spawns / map.bounds / map.theme
 *   map.getGroundY(x, z[, fromY]) / map.raycastWorld(o, d, max) / map.traceShot(o, d, max, targets)
 *   map.update(dt, t)  // 장식 애니메이션(불꽃·부표·물결)
 *   map.dispose()
 *
 * 렌더: solids는 재질별로 한 메시에 합친다(드로우콜 ≈ 재질 수). 바닥(y=0)은 플레이 영역을 덮는 슬래브로 만들고,
 *       윗면이 y≤0.05인 '바닥 높이/가라앉은' box(물 웅덩이·구덩이)는 그 자리를 바닥에서 도려낸다.
 * 충돌: solids + 바닥 슬래브 + 보이지 않는 외곽 벽(noRay — 총알은 통과, 사람·수류탄은 막음).
 *
 * theme 확장(선택): ground: 바닥 mat 이름(기본 'asphalt', 'none'이면 바닥 없음) · waterLevel: 바다 높이(기본 -0.8)
 *                  sunIntensity: 태양 세기 배율
 */
import * as THREE from 'three';
import { createWorld, solidToCollider, makeBox, rectSubtract, getGroundY as physGroundY, findFloor, raycastWorld, traceShot, sphereSweep, lineOfSight } from '../engine/physics.js';
import { GeoBatch } from '../engine/geom.js';
import { getMaterial, getGroundMaterial, matScale, hasMat, setWaterColor, animateMaterials } from '../engine/materials.js';
import { buildDecor } from '../engine/decor.js';
import { toRad, LIMITS, TEAM_IDS } from '../core/consts.js';

const DEFAULT_THEME = Object.freeze({
  sky: '#a9cde8', skyTop: '#3f78b5', fog: [60, 240], sunDir: [-0.45, 0.8, -0.35],
  sunColor: '#fff1d8', ambient: 0.5, water: null
});

function hexOr(v, d) {
  return typeof v === 'string' && /^#?[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : d;
}

/** theme 정규화 (빠진 값은 기본값) */
export function normalizeTheme(t) {
  t = t && typeof t === 'object' ? t : {};
  const fog = Array.isArray(t.fog) ? t.fog : DEFAULT_THEME.fog;
  let near = Number(fog[0]), far = Number(fog[1]);
  if (!Number.isFinite(near)) near = DEFAULT_THEME.fog[0];
  if (!Number.isFinite(far) || far <= near) far = Math.max(near + 40, DEFAULT_THEME.fog[1]);
  const sd = Array.isArray(t.sunDir) && t.sunDir.length === 3 && t.sunDir.every(Number.isFinite) ? t.sunDir : DEFAULT_THEME.sunDir;
  const sl = Math.hypot(sd[0], sd[1], sd[2]) || 1;
  const ground = t.ground ?? t.floor;
  return {
    sky: hexOr(t.sky, DEFAULT_THEME.sky),
    skyTop: hexOr(t.skyTop, DEFAULT_THEME.skyTop),
    fog: [near, far],
    sunDir: [sd[0] / sl, sd[1] / sl, sd[2] / sl],
    sunColor: hexOr(t.sunColor, DEFAULT_THEME.sunColor),
    sunIntensity: Number.isFinite(+t.sunIntensity) && t.sunIntensity !== null ? +t.sunIntensity : 1,
    ambient: Number.isFinite(+t.ambient) ? Math.max(0, Math.min(2, +t.ambient)) : DEFAULT_THEME.ambient,
    water: t.water ? hexOr(t.water, null) : null,
    waterLevel: Number.isFinite(+t.waterLevel) && t.waterLevel !== null ? +t.waterLevel : null,
    ground: ground === 'none' ? 'none' : hasMat(ground) ? ground : 'asphalt'
  };
}

/**
 * 맵 데이터 검사. 치명적이면 errors, 고칠 수 있으면 warnings.
 * @returns {{ ok:boolean, errors:string[], warnings:string[] }}
 */
export function validateMap(data) {
  const errors = [], warnings = [];
  if (!data || typeof data !== 'object') return { ok: false, errors: ['map data is not an object'], warnings };
  if (!data.id) warnings.push('id missing');
  if (!Array.isArray(data.solids)) errors.push('solids must be an array');
  if (!data.size || !(+data.size.x > 0) || !(+data.size.z > 0)) warnings.push('size {x,z} missing → computed');
  if (Array.isArray(data.solids) && data.solids.length > LIMITS.SOLIDS) warnings.push(`solids ${data.solids.length} > ${LIMITS.SOLIDS}`);
  if (Array.isArray(data.decor) && data.decor.length > LIMITS.DECOR) warnings.push(`decor ${data.decor.length} > ${LIMITS.DECOR}`);
  for (const team of TEAM_IDS) {
    const sp = data.spawns && data.spawns[team];
    if (!Array.isArray(sp) || !sp.length) warnings.push(`spawns.${team} missing`);
    else if (sp.length < 4) warnings.push(`spawns.${team}: ${sp.length} < 4`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * @param {object} data 맵 데이터 (ARCHITECTURE 4절 형식)
 * @param {THREE.Scene|THREE.Object3D} scene 추가할 부모
 * @param {{ onWarn?: (msg:string)=>void }} [opts]
 */
export function buildMap(data, scene, opts = {}) {
  const check = validateMap(data);
  if (!check.ok) throw new Error('invalid map: ' + check.errors.join('; '));
  const warnings = check.warnings.slice();
  const warn = (m) => { warnings.push(m); if (opts.onWarn) opts.onWarn(m); };
  const id = String(data.id || 'map');
  const theme = normalizeTheme(data.theme);
  const solids = data.solids || [];

  // --- 충돌체 ---
  const colliders = [];
  const holes = [];
  const waterCols = [];
  let ext = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  solids.forEach((s, i) => {
    const c = solidToCollider(s, i);
    if (!c) { warn(`solids[${i}] invalid (${s && s.type})`); return; }
    // mat 'clip' = 보이지 않는 막이(충돌만, 총알·시야는 통과): 물가 난간 위 등 점프로 넘어가면 안 되는 곳
    if (c.mat === 'clip') { c.mat = 'invisible'; c.noRay = true; c.tag = 'clip'; colliders.push(c); return; }
    if (!hasMat(c.mat)) { warn(`solids[${i}] unknown mat "${c.mat}" → concrete`); c.mat = 'concrete'; }
    colliders.push(c);
    ext.minX = Math.min(ext.minX, c.minX); ext.maxX = Math.max(ext.maxX, c.maxX);
    ext.minZ = Math.min(ext.minZ, c.minZ); ext.maxZ = Math.max(ext.maxZ, c.maxZ);
    if (c.kind === 'box' && c.maxY <= 0.05 && c.minY < -0.001) holes.push(c);
    if (c.mat === 'water') waterCols.push(c);
  });
  const sx = +(data.size && data.size.x) > 0 ? +data.size.x : (Number.isFinite(ext.minX) ? Math.max(Math.abs(ext.minX), Math.abs(ext.maxX)) * 2 + 4 : 60);
  const sz = +(data.size && data.size.z) > 0 ? +data.size.z : (Number.isFinite(ext.minZ) ? Math.max(Math.abs(ext.minZ), Math.abs(ext.maxZ)) * 2 + 4 : 60);
  const bounds = { minX: -sx / 2, maxX: sx / 2, minZ: -sz / 2, maxZ: sz / 2 };

  let seaLevel = theme.waterLevel;
  if (seaLevel == null) {
    const tops = waterCols.filter((c) => c.maxY <= 0.05).map((c) => c.maxY);
    seaLevel = tops.length ? Math.max(...tops) : -0.8;
  }

  // --- 렌더: 재질별 배치 ---
  const group = new THREE.Group();
  group.name = 'map:' + id;
  const batches = new Map();
  const batch = (mat) => {
    if (!hasMat(mat)) mat = 'concrete';
    let b = batches.get(mat);
    if (!b) { b = new GeoBatch(); b.scale = matScale(mat); batches.set(mat, b); }
    return b;
  };
  for (const c of colliders) {
    if (c.mat === 'invisible') continue;   // clip 막이는 그리지 않는다
    const b = batch(c.mat);
    const skipBottom = c.minY <= 0.001;
    if (c.kind === 'box') b.addBox(c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ, b.scale, { skipBottom });
    else if (c.kind === 'ramp') b.addRamp(c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ, c.dir, b.scale, { skipBottom });
    else b.addCylinder(c.x, c.minY, c.z, c.r, c.maxY - c.minY, b.scale, { skipBottom });
  }

  // --- 바닥 슬래브 (플레이 영역 − 구멍) ---
  const groundDepth = theme.water ? Math.max(1.2, -seaLevel + 0.8) : 2.5;
  const disposables = [];
  if (theme.ground !== 'none') {
    let rects = [{ minX: bounds.minX, minZ: bounds.minZ, maxX: bounds.maxX, maxZ: bounds.maxZ }];
    for (const h of holes) {
      const next = [];
      for (const r of rects) next.push(...rectSubtract(r, h));
      rects = next;
    }
    const gb = new GeoBatch();
    const gs = matScale(theme.ground);
    for (const r of rects) {
      gb.addBox(r.minX, -groundDepth, r.minZ, r.maxX, 0, r.maxZ, gs, { skipBottom: true });
      colliders.push(makeBox(r.minX, -groundDepth, r.minZ, r.maxX, 0, r.maxZ, theme.ground, { tag: 'ground' }));
    }
    if (!gb.empty) {
      const geo = gb.build();
      const mesh = new THREE.Mesh(geo, getGroundMaterial(theme.ground));
      mesh.receiveShadow = true;
      mesh.name = 'ground';
      group.add(mesh);
      disposables.push(geo);
    }
  }

  // --- 바깥 경치: 바다 또는 연장 지면 (충돌 없음) ---
  {
    const FAR = 1200;
    if (theme.water) {
      setWaterColor(theme.water);
      const geo = new THREE.PlaneGeometry(FAR * 2, FAR * 2);
      geo.rotateX(-Math.PI / 2);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (FAR * 2) / matScale('water'), uv.getY(i) * (FAR * 2) / matScale('water'));
      const sea = new THREE.Mesh(geo, getMaterial('water'));
      sea.position.y = seaLevel;
      sea.receiveShadow = true;
      sea.name = 'sea';
      group.add(sea);
      disposables.push(geo);
    } else if (theme.ground !== 'none') {
      // 플레이 영역 둘레 4장(구멍 아래가 비치지 않게 가운데는 비움)
      const ob = new GeoBatch();
      const s = matScale(theme.ground), y = -0.04;
      const q = (x0, z0, x1, z1) => ob.quad([x0, y, z1, x0, -z1], [x1, y, z1, x1, -z1], [x1, y, z0, x1, -z0], [x0, y, z0, x0, -z0], [0, 1, 0], s);
      q(-FAR, -FAR, FAR, bounds.minZ); q(-FAR, bounds.maxZ, FAR, FAR);
      q(-FAR, bounds.minZ, bounds.minX, bounds.maxZ); q(bounds.maxX, bounds.minZ, FAR, bounds.maxZ);
      const geo = ob.build();
      const mesh = new THREE.Mesh(geo, getGroundMaterial(theme.ground));
      mesh.receiveShadow = true;
      mesh.name = 'outskirts';
      group.add(mesh);
      disposables.push(geo);
    }
  }

  // --- 보이지 않는 외곽 벽 ---
  const T = 2, Y0 = -20, Y1 = 80;
  colliders.push(
    makeBox(bounds.minX - T, Y0, bounds.minZ - T, bounds.maxX + T, Y1, bounds.minZ, 'invisible', { noRay: true, tag: 'bounds' }),
    makeBox(bounds.minX - T, Y0, bounds.maxZ, bounds.maxX + T, Y1, bounds.maxZ + T, 'invisible', { noRay: true, tag: 'bounds' }),
    makeBox(bounds.minX - T, Y0, bounds.minZ, bounds.minX, Y1, bounds.maxZ, 'invisible', { noRay: true, tag: 'bounds' }),
    makeBox(bounds.maxX, Y0, bounds.minZ, bounds.maxX + T, Y1, bounds.maxZ, 'invisible', { noRay: true, tag: 'bounds' })
  );

  const world = createWorld(colliders, { bounds, groundMat: theme.ground === 'none' ? 'concrete' : theme.ground, floorY: theme.ground === 'none' ? 0 : null });

  // --- 장식 ---
  const inRect = (c, x, z) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ;
  const waterY = (x, z) => {
    let best = -Infinity;
    for (const c of waterCols) if (inRect(c, x, z)) best = Math.max(best, c.maxY);
    if (best > -Infinity) return best;
    const outside = x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ;
    if (theme.water && (outside || holes.some((h) => inRect(h, x, z)))) return seaLevel;
    return physGroundY(world, x, z);
  };
  const decor = buildDecor(data.decor || [], { batch, material: getMaterial, group, waterY, warn });

  // --- 배치 → 메시 ---
  let triangles = 0, drawCalls = 0;
  for (const [mat, b] of batches) {
    if (b.empty) continue;
    const geo = b.build();
    const mesh = new THREE.Mesh(geo, getMaterial(mat));
    mesh.name = 'solids:' + mat;
    mesh.castShadow = mat !== 'glass' && mat !== 'water';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (mat === 'glass') mesh.renderOrder = 2;
    group.add(mesh);
    disposables.push(geo);
    triangles += geo.index.count / 3;
    drawCalls++;
  }

  // --- 스폰 ---
  const spawns = {};
  const cx = (v, a, b) => Math.min(b - 0.5, Math.max(a + 0.5, v));
  for (const team of TEAM_IDS) {
    let list = (data.spawns && Array.isArray(data.spawns[team]) ? data.spawns[team] : []).filter((p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.z));
    if (!list.length) {
      const other = data.spawns && data.spawns[team === 'owner' ? 'charterer' : 'owner'];
      list = Array.isArray(other) && other.length
        ? other.map((p) => ({ x: -p.x, z: -p.z, rotY: (toRad(p.rotY || 0) + Math.PI) }))
        : [0, 1, 2, 3].map((i) => ({ x: (team === 'owner' ? -1 : 1) * (sx / 2 - 4), z: (i - 1.5) * 3, rotY: team === 'owner' ? -Math.PI / 2 : Math.PI / 2 }));
    }
    spawns[team] = list.map((p) => {
      const x = cx(+p.x, bounds.minX, bounds.maxX), z = cx(+p.z, bounds.minZ, bounds.maxZ);
      return { x, y: findFloor(world, x, z), z, rotY: toRad(p.rotY || 0) };
    });
  }

  if (scene) scene.add(group);

  let disposed = false;
  return {
    id,
    data,
    name: data.name || id,
    theme,
    group,
    world,
    colliders: world.colliders,
    spawns,
    bounds,
    seaLevel,
    warnings,
    stats: { solids: solids.length, colliders: world.colliders.length, drawCalls: drawCalls + decor.lightCount, triangles: Math.round(triangles), decor: decor.counts, lights: decor.lightCount },
    getGroundY: (x, z, fromY) => physGroundY(world, x, z, fromY),
    findFloor: (x, z, o) => findFloor(world, x, z, o),
    raycastWorld: (o, d, max, op) => raycastWorld(world, o, d, max, op),
    traceShot: (o, d, max, targets, op) => traceShot(world, o, d, max, targets, op),
    sphereSweep: (body, dt, op) => sphereSweep(world, body, dt, op),
    lineOfSight: (a, b) => lineOfSight(world, a, b),
    update(dt, t) {
      animateMaterials(dt);
      if (decor.animated) decor.update(dt, t);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      for (const d of disposables) d.dispose();
      decor.dispose();
    }
  };
}
