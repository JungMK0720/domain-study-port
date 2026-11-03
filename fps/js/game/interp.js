/**
 * ⚓ Port Ops — 원격 플레이어 보간 버퍼 (순수 모듈: 엔진·three.js·DOM 없음, node 테스트 가능)
 *
 *   const ip = createInterp();
 *   ip.push({ seq, t, pos:[x,y,z], vel:[...], yaw, pitch, alive, onGround, ... }, arrivalLocalMs);
 *   const s = ip.sample(performance.now());   // { pos, vel, yaw, pitch, ..., mode, delay, senderT }
 *
 * 시간축
 *   - t는 보낸 쪽 시계(ms)다. 도착 오프셋 d = 도착(로컬) − t 를 최근 64개 모아
 *     base = min(d) (가장 빨리 온 패킷 기준), jitter = p95(d) − base 로 잡는다.
 *   - 재생 오프셋 P = base + delay. 렌더 시각(보낸 쪽 시계) R = now − P.
 *   - delay 목표 = 송신 간격(p90, 움직이는 스냅샷끼리) + jitter + 5ms, 70~180ms로 자른다(처음 8개까지는 100ms 고정).
 *     송신 간격이 125ms보다 길면(전송 예산으로 Hz가 낮아진 경우) 상한이 그만큼 늘어난다(180 + (간격−125), 최대 400ms).
 *   - P는 목표로 서서히 움직인다(늘릴 때 실시간의 10%, 줄일 때 2%) → 화면 시간이 거꾸로 가지 않는다.
 *     차이가 250ms를 넘으면 한 번에 맞춘다.
 *
 * 보간/외삽
 *   - 위치·속도·pitch 선형, yaw 최단 각도. 이산 필드(slot, hp, flags, alive …)는 앞쪽 스냅샷 값.
 *   - 두 스냅샷 사이 거리가 max(3m, 30m/s×간격)를 넘으면 순간이동으로 보고 보간하지 않는다(부활·라운드 시작).
 *   - 최신 스냅샷 이후는 마지막 속도로 최대 200ms 외삽(공중이면 중력 포함) 후 정지. 죽은 상태는 외삽하지 않는다.
 *
 * 순서·중복
 *   - seq로 정렬 삽입. 같은 seq → 'dup', 이미 버린 구간보다 오래된 seq → 'late'.
 *   - seq가 작은데 t가 더 크거나, t가 10초 이상 과거이거나, seq가 1000 이상 뒤면 보낸 쪽 재시작으로 보고 초기화.
 */
import { wrapAngle } from './protocol.js';

export const INTERP_DEFAULTS = Object.freeze({
  delay: 100,          // 초기(표본 부족 시) 지연 ms
  minDelay: 70,
  maxDelay: 180,
  maxDelayCap: 400,    // 송신 간격이 길 때 늘어날 수 있는 절대 상한
  stretchFrom: 125,    // 송신 간격이 이보다 길면 maxDelay를 (간격 − stretchFrom)만큼 늘린다
  warmup: 8,           // 이 개수 미만이면 delay 고정
  margin: 5,
  jitterPct: 0.95,
  window: 64,          // 도착 오프셋 표본 수
  intervalWindow: 32,  // 송신 간격 표본 수
  intervalPct: 0.9,
  defaultInterval: 100,
  maxExtrap: 200,
  slewUp: 0.10,
  slewDown: 0.02,
  fastPackets: 20,     // 처음 이만큼은 줄이는 쪽도 빠르게(10%)
  snapMs: 250,
  keepMs: 1500,
  maxSize: 64,
  teleportDist: 3,
  teleportSpeed: 30,
  gravity: -16,
  floorY: 0,           // 외삽 시 이 아래로 내려가지 않음 (null이면 끔)
  movingSpeed: 0.1     // 이 속도(m/s) 이상인 스냅샷만 송신 간격 추정에 쓴다(유휴 2Hz 제외)
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SKIP = new Set(['pos', 'vel', 'yaw', 'pitch', 'seq', 't']);

function percentile(src, n, p, tmp) {
  for (let i = 0; i < n; i++) tmp[i] = src[i];
  const view = tmp.subarray(0, n);
  view.sort();
  return { lo: view[0], at: view[Math.min(n - 1, Math.round(p * (n - 1)))] };
}

export function createInterp(options = {}) {
  const o = { ...INTERP_DEFAULTS, ...options };
  /** @type {object[]} seq 오름차순 */
  const buf = [];
  let maxSeq = -Infinity;
  let floorSeq = -Infinity;
  const offs = new Float64Array(o.window);
  const ints = new Float64Array(o.intervalWindow);
  const tmp = new Float64Array(Math.max(o.window, o.intervalWindow));
  let offN = 0, offI = 0, intN = 0, intI = 0;
  let base = 0, jitter = 0, interval = o.defaultInterval, target = o.delay;
  let P = null, Ptarget = null, lastNow = null, accepted = 0;
  const st = { pushed: 0, dup: 0, late: 0, reordered: 0, lost: 0, resets: 0, interp: 0, extrap: 0, hold: 0 };

  function reset() {
    buf.length = 0;
    maxSeq = -Infinity; floorSeq = -Infinity;
    offN = offI = intN = intI = 0;
    base = 0; jitter = 0; interval = o.defaultInterval; target = o.delay;
    P = null; Ptarget = null; lastNow = null; accepted = 0;
  }

  const speed = (s) => (s.vel ? Math.hypot(s.vel[0], s.vel[1], s.vel[2]) : 0);

  function addInterval(dt) {
    if (!(dt > 0 && dt < 1000)) return;
    ints[intI] = dt;
    intI = (intI + 1) % ints.length;
    if (intN < ints.length) intN++;
  }

  function recompute() {
    if (offN > 0) {
      const r = percentile(offs, offN, o.jitterPct, tmp);
      base = r.lo;
      jitter = r.at - r.lo;
    }
    if (intN >= 4) interval = percentile(ints, intN, o.intervalPct, tmp).at;
    if (offN < o.warmup) target = o.delay;
    else {
      const maxEff = clamp(o.maxDelay + Math.max(0, interval - o.stretchFrom), o.maxDelay, o.maxDelayCap);
      target = clamp(interval + jitter + o.margin, o.minDelay, maxEff);
    }
    Ptarget = base + target;
    if (P === null || Math.abs(Ptarget - P) > o.snapMs) P = Ptarget;
  }

  /**
   * @param {object} snap { seq, t, pos, vel, yaw, pitch, ... }
   * @param {number} arrival 도착 로컬 시각 ms
   * @returns {'ok'|'dup'|'late'|'bad'}
   */
  function push(snap, arrival) {
    if (!snap || !Number.isFinite(snap.seq) || !Number.isFinite(snap.t) || !Number.isFinite(arrival) || !snap.pos) return 'bad';
    const seq = snap.seq;
    if (buf.length && seq < maxSeq) {
      const newestT = buf[buf.length - 1].t;
      if (snap.t > newestT || snap.t < newestT - 10000 || seq < maxSeq - 1000) { reset(); st.resets++; }
    }
    if (seq <= floorSeq) { st.late++; if (st.lost > 0) st.lost--; return 'late'; }
    let lo = 0, hi = buf.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (buf[mid].seq < seq) lo = mid + 1; else hi = mid; }
    if (lo < buf.length && buf[lo].seq === seq) { st.dup++; return 'dup'; }
    buf.splice(lo, 0, snap);
    st.pushed++;
    accepted++;
    if (seq > maxSeq) {
      if (maxSeq !== -Infinity && seq > maxSeq + 1) st.lost += seq - maxSeq - 1;
      maxSeq = seq;
      // 송신 간격: 새 최신과 직전 스냅샷이 둘 다 움직이는 중일 때만(유휴 2Hz·멈춤 전환 제외).
      // seq 차이로 나눈다 → 손실·순서 뒤바뀜·merge로 생긴 틈이 간격을 부풀리지 않는다
      if (lo > 0 && speed(snap) >= o.movingSpeed && speed(buf[lo - 1]) >= o.movingSpeed) {
        addInterval((snap.t - buf[lo - 1].t) / Math.max(1, seq - buf[lo - 1].seq));
      }
    } else {
      st.reordered++;
      if (st.lost > 0) st.lost--;
    }
    offs[offI] = arrival - snap.t;
    offI = (offI + 1) % offs.length;
    if (offN < offs.length) offN++;
    const newest = buf[buf.length - 1].t;
    while (buf.length > 3 && (buf.length > o.maxSize || buf[0].t < newest - o.keepMs)) floorSeq = buf.shift().seq;
    recompute();
    return 'ok';
  }

  function copyDiscrete(src, out) {
    for (const k in src) if (!SKIP.has(k)) out[k] = src[k];
  }

  /** 보낸 쪽 시각 R의 상태 (지연 관리 없음 — 방장 검증·되감기용). count=true면 모드 통계 집계 */
  function sampleAt(R, out = {}, count = false) {
    const n = buf.length;
    if (!n) return null;
    let i = n - 1;
    while (i >= 0 && buf[i].t > R) i--;
    const pos = out.pos && out.pos.length === 3 ? out.pos : (out.pos = [0, 0, 0]);
    const vel = out.vel && out.vel.length === 3 ? out.vel : (out.vel = [0, 0, 0]);
    let a, mode;
    if (i < 0) {
      a = buf[0];
      mode = 'hold';
      pos[0] = a.pos[0]; pos[1] = a.pos[1]; pos[2] = a.pos[2];
      vel[0] = vel[1] = vel[2] = 0;
      out.yaw = a.yaw || 0; out.pitch = a.pitch || 0;
    } else if (i < n - 1) {
      a = buf[i];
      const b = buf[i + 1];
      const span = b.t - a.t;
      const dx = b.pos[0] - a.pos[0], dy = b.pos[1] - a.pos[1], dz = b.pos[2] - a.pos[2];
      const jump = Math.hypot(dx, dy, dz) > Math.max(o.teleportDist, o.teleportSpeed * span / 1000);
      const f = jump || span <= 0 ? 0 : clamp((R - a.t) / span, 0, 1);
      mode = 'interp';
      pos[0] = a.pos[0] + dx * f; pos[1] = a.pos[1] + dy * f; pos[2] = a.pos[2] + dz * f;
      const av = a.vel || [0, 0, 0], bv = b.vel || av;
      vel[0] = av[0] + (bv[0] - av[0]) * f; vel[1] = av[1] + (bv[1] - av[1]) * f; vel[2] = av[2] + (bv[2] - av[2]) * f;
      const ya = a.yaw || 0;
      out.yaw = wrapAngle(ya + wrapAngle((b.yaw || 0) - ya) * f);
      out.pitch = (a.pitch || 0) + ((b.pitch || 0) - (a.pitch || 0)) * f;
    } else {
      a = buf[n - 1];
      const e = R - a.t;
      const av = a.vel || [0, 0, 0];
      const ext = a.alive === false ? 0 : clamp(e, 0, o.maxExtrap) / 1000;
      const air = a.onGround === false;
      mode = e <= 0 ? 'interp' : e <= o.maxExtrap ? 'extrap' : 'hold';
      pos[0] = a.pos[0] + av[0] * ext;
      pos[2] = a.pos[2] + av[2] * ext;
      pos[1] = a.pos[1] + av[1] * ext + (air ? 0.5 * o.gravity * ext * ext : 0);
      if (o.floorY !== null && pos[1] < o.floorY && a.pos[1] >= o.floorY) pos[1] = o.floorY;
      vel[0] = av[0]; vel[2] = av[2]; vel[1] = av[1] + (air ? o.gravity * ext : 0);
      if (mode === 'hold') vel[0] = vel[1] = vel[2] = 0;
      out.yaw = a.yaw || 0; out.pitch = a.pitch || 0;
    }
    copyDiscrete(a, out);
    out.mode = mode;
    out.extrapolated = mode !== 'interp';
    out.senderT = R;
    out.age = R - buf[n - 1].t; // 최신 스냅샷 대비 렌더 시각 (음수 = 버퍼 안)
    if (count) st[mode]++;
    return out;
  }

  /** 로컬 시각 now의 렌더 상태 (적응형 지연 적용). 렌더 프레임마다 부르면 된다 */
  function sample(now, out = {}) {
    if (!buf.length || P === null) return null;
    if (lastNow !== null && now > lastNow && Ptarget !== P) {
      const diff = Ptarget - P;
      const rate = diff > 0 || accepted < o.fastPackets ? o.slewUp : o.slewDown;
      const step = rate * (now - lastNow);
      P += diff > 0 ? Math.min(diff, step) : Math.max(diff, -step);
    }
    if (lastNow === null || now > lastNow) lastNow = now;
    const res = sampleAt(now - P, out, true);
    res.delay = P - base;
    return res;
  }

  return {
    push,
    sample,
    sampleAt,
    clear: reset,
    /** 보낸 쪽 시각 → 이 아바타가 그 시각을 그리는 로컬 시각 (원격 이벤트를 아바타와 맞출 때) */
    toLocal: (senderT) => (P === null ? senderT : senderT + P),
    /** 로컬 시각 → 렌더 중인 보낸 쪽 시각 */
    toSender: (localT) => (P === null ? localT : localT - P),
    /** 가장 빨리 온 패킷 기준 도착 오프셋(로컬 − 보낸 쪽 시계). 방장 검증용 시각 변환에 쓴다 */
    base: () => base,
    latest: () => (buf.length ? buf[buf.length - 1] : null),
    get size() { return buf.length; },
    stats: () => ({
      ...st,
      size: buf.length,
      delay: P === null ? null : P - base,
      target,
      jitter,
      interval,
      base
    })
  };
}
