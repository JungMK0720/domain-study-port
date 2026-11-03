// ⚓ Port Ops — FX/audio.js : WebAudio 합성 효과음 (외부 사운드 파일 없음, 전부 오리지널 합성)
// createAudio() → { unlock, setVolume, setListener, play, stopAll, setQuality, getStats, dispose }
// 그래프: [보이스 풀: Gain → LowPass → Panner(HRTF)] → mix → Compressor → makeup → Limiter → SoftClip → Volume → out
//                                          └→ reverb send → Convolver(합성 IR) → mix

/* ───────────── 작은 DSP 도구 (Float32Array 위에서 동작, 동기 렌더) ───────────── */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// TPT 상태변수 필터(무조건 안정). fc: Hz 또는 (u∈[0,1]) => Hz. band 출력은 피크 이득 1로 정규화.
function svf(buf, sr, mode, fc, q = 0.707) {
  const k = 1 / q, n = buf.length, dyn = typeof fc === 'function';
  const m = mode === 'low' ? 0 : mode === 'band' ? 1 : 2;
  let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0;
  const coef = (f) => {
    const g = Math.tan(Math.PI * Math.min(Math.max(f, 20), sr * 0.45) / sr);
    a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
  };
  if (!dyn) coef(fc);
  for (let i = 0; i < n; i++) {
    if (dyn && (i & 15) === 0) coef(fc(i / n));
    const v0 = buf[i], v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    buf[i] = m === 0 ? v2 : m === 1 ? k * v1 : v0 - k * v1 - v2;
  }
  return buf;
}

// 엔벌로프: exp(기본) | bell(sin²) | hold(어택→유지→지수 릴리스)
function envAt(x, o) {
  if (o.env === 'bell') return Math.sin(Math.PI * Math.min(1, x / o.dur)) ** 2;
  const a = o.a ?? 0.001;
  if (x < a) return x / a;
  const y = x - a;
  if (o.env === 'hold') { const h = o.h ?? 0; return y < h ? 1 : Math.exp(-(y - h) / o.d); }
  return Math.exp(-y / o.d);
}

// 한 소리를 레이어 단위로 쌓는 합성기. 메서드는 체이닝 가능.
function synth(sr, dur, seed) {
  const n = Math.max(1, Math.ceil(sr * dur));
  const out = new Float32Array(n);
  const rnd = mulberry32(seed);
  const fadeN = Math.floor(sr * 0.005);
  const span = (t, d) => {
    const i0 = Math.max(0, Math.floor(t * sr));
    return [i0, Math.max(0, Math.min(n - i0, Math.ceil(d * sr)))];
  };
  const tailFade = (i, len) => (i > len - fadeN ? (len - i) / fadeN : 1);
  const S = {
    sr, out, rnd,
    r: (a, b) => a + (b - a) * rnd(),
    // 노이즈 레이어: { t, dur, g, a, d, env, h, lp, hp, bp, q, brown }
    noise(o) {
      const d = o.dur ?? 0.1, [i0, len] = span(o.t ?? 0, d);
      if (!len) return S;
      const e = { env: o.env, a: o.a, h: o.h, d: o.d ?? d / 4, dur: d };
      const tmp = new Float32Array(len);
      let b = 0;
      for (let i = 0; i < len; i++) {
        let w = rnd() * 2 - 1;
        if (o.brown) { b = (b + 0.04 * w) / 1.04; w = b * 4; }
        tmp[i] = w * envAt(i / sr, e) * tailFade(i, len);
      }
      if (o.bp) svf(tmp, sr, 'band', o.bp, o.q ?? 1);
      if (o.lp) svf(tmp, sr, 'low', o.lp, 0.707);
      if (o.hp) svf(tmp, sr, 'high', o.hp, 0.707);
      const g = o.g ?? 1;
      for (let i = 0; i < len; i++) out[i0 + i] += tmp[i] * g;
      return S;
    },
    // 음정 레이어: { t, dur, f, f1, glide, g, a, d, env, h, tri, harm, tilt, vib, vibF }
    tone(o) {
      const d = o.dur ?? 0.3, [i0, len] = span(o.t ?? 0, d);
      if (!len) return S;
      const e = { env: o.env, a: o.a, h: o.h, d: o.d ?? d / 3, dur: d };
      const f0 = o.f, f1 = o.f1 ?? o.f, gl = o.glide ?? 0.05, g = o.g ?? 1;
      const vib = o.vib ?? 0, vf = o.vibF ?? 5;
      let table = null;
      if ((o.harm ?? 1) > 1) {             // 대역 제한 배음 웨이브테이블 (가산 합성보다 훨씬 빠름)
        const N = 2048, fmax = Math.max(f0, f1), tilt = o.tilt ?? 1;
        table = new Float32Array(N + 1);
        for (let h = 1; h <= o.harm && fmax * h < sr * 0.45; h++) {
          const amp = 1 / h ** tilt;
          for (let j = 0; j <= N; j++) table[j] += Math.sin((2 * Math.PI * h * j) / N) * amp;
        }
      }
      let ph = rnd();                       // 위상(0..1 사이클)
      for (let i = 0; i < len; i++) {
        const x = i / sr;
        let f = f1 + (f0 - f1) * Math.exp(-x / gl);
        if (vib) f *= 1 + vib * Math.sin(2 * Math.PI * vf * x);
        ph += f / sr; ph -= Math.floor(ph);
        let s;
        if (table) { const p = ph * 2048, j = p | 0; s = table[j] + (table[j + 1] - table[j]) * (p - j); }
        else if (o.tri) s = 1 - 4 * Math.abs(ph - 0.5);
        else s = Math.sin(2 * Math.PI * ph);
        out[i0 + i] += s * g * envAt(x, e) * tailFade(i, len);
      }
      return S;
    },
    // 비조화 금속 울림: { t, f:[Hz], amp:[], dec:[s], g }
    ring(o) {
      const g = o.g ?? 1, fs = o.f, am = o.amp || [], dc = o.dec;
      const [i0, len] = span(o.t ?? 0, Math.max(...dc) * 6);
      if (!len) return S;
      for (let p = 0; p < fs.length; p++) {
        const w = (2 * Math.PI * fs[p]) / sr, ph = rnd() * 6.283;
        const kk = Math.exp(-1 / ((dc[p] ?? dc[0]) * sr));
        let env = (am[p] ?? 1) * g;
        for (let i = 0; i < len && env > 1e-5; i++) {
          out[i0 + i] += Math.sin(ph + w * i) * env * Math.min(1, i / 24) * tailFade(i, len);
          env *= kk;
        }
      }
      return S;
    },
    click(t, g = 0.5, hp = 2500) { return S.noise({ t, dur: 0.006, a: 0.0002, d: 0.0008, g, hp }); },
    // 지연 탭 메아리(굽기): [{ t, g, lp }]
    echo(taps) {
      const dry = out.slice();
      for (const tp of taps) {
        const off = Math.floor(tp.t * sr);
        if (off >= n) continue;
        const w = svf(dry.slice(0, n - off), sr, 'low', tp.lp ?? 2000);
        for (let i = 0; i < w.length; i++) out[off + i] += w[i] * tp.g;
      }
      return S;
    },
    sat(drive = 1.5) {                      // 정규화 후 tanh 포화(펀치감)
      let pk = 1e-9;
      for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
      const k = Math.tanh(drive);
      for (let i = 0; i < n; i++) out[i] = Math.tanh((out[i] / pk) * drive) / k;
      return S;
    },
    filter(mode, fc, q) { svf(out, sr, mode, fc, q); return S; },
    done(peak = 0.9) {
      svf(out, sr, 'high', 25);             // DC 제거
      const fo = Math.min(n, Math.floor(sr * 0.012));
      for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
      let pk = 1e-9;
      for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
      const s = peak / pk;
      for (let i = 0; i < n; i++) out[i] *= s;
      return out;
    }
  };
  return S;
}

/* ───────────── 소리 정의 ─────────────
   prio: 우선순위(높을수록 중요) · level: 기본 이득 · ref/roll/maxDist: 거리 감쇠(m)
   muffle: 멀수록 강한 저역 통과 · send: 잔향 양 · max: 같은 소리 동시 상한 · vars: 변형 수
   jit: 재생 속도 랜덤 폭 · ui: 항상 2D(비위치) */
const DEFS = {
  rifle: { dur: 0.6, prio: 6, level: 0.8, ref: 8, maxDist: 260, muffle: 1, send: 0.2, max: 6, vars: 3, jit: 0.035,
    r: (S) => S.noise({ dur: 0.03, a: 0.0003, d: 0.005, hp: 1800, g: 1 })
      .noise({ dur: 0.25, d: S.r(0.035, 0.05), lp: 3800, g: 0.9 })
      .tone({ f: S.r(150, 175), f1: 48, glide: 0.03, d: 0.06, dur: 0.3, g: 0.9 })
      .noise({ t: 0.015, dur: 0.55, a: 0.01, d: 0.13, lp: 900, brown: 1, g: 0.6 })
      .click(0.045, 0.12).sat(1.6) },
  sniper: { dur: 2.8, prio: 7, level: 0.95, ref: 10, maxDist: 420, muffle: 1, send: 0.32, max: 3, vars: 2, jit: 0.02,
    r: (S) => S.noise({ dur: 0.02, a: 0.0002, d: 0.004, hp: 2600, g: 1.3 })
      .noise({ dur: 0.06, d: 0.012, bp: 4200, q: 1.2, g: 0.7 })
      .tone({ f: 125, f1: 34, glide: 0.06, d: 0.22, dur: 0.9, g: 1.1 })
      .noise({ dur: 0.5, d: 0.08, lp: 2400, g: 0.8 })
      .noise({ t: 0.01, dur: 1.4, a: 0.02, d: 0.35, lp: 420, brown: 1, g: 0.7 })
      .sat(1.8)
      .echo([{ t: 0.21, g: 0.34, lp: 2600 }, { t: 0.47, g: 0.24, lp: 1600 }, { t: 0.83, g: 0.16, lp: 1100 },
        { t: 1.28, g: 0.1, lp: 800 }, { t: 1.82, g: 0.06, lp: 600 }]) },
  pistol: { dur: 0.45, prio: 6, level: 0.7, ref: 6, maxDist: 190, muffle: 1, send: 0.16, max: 4, vars: 3, jit: 0.03,
    r: (S) => S.noise({ dur: 0.02, a: 0.0003, d: 0.004, hp: 2200, g: 0.9 })
      .noise({ dur: 0.12, d: 0.024, bp: S.r(1500, 1900), q: 1, g: 0.85 })
      .tone({ f: 215, f1: 72, glide: 0.02, d: 0.035, dur: 0.2, g: 0.7 })
      .noise({ t: 0.01, dur: 0.42, a: 0.006, d: 0.085, lp: 1100, brown: 1, g: 0.4 }).sat(1.4) },
  knife_slash: { dur: 0.32, prio: 5, level: 0.55, ref: 2.5, maxDist: 30, send: 0.04, max: 3, vars: 2, jit: 0.06,
    r: (S) => {
      const top = S.r(2300, 2900);
      S.noise({ dur: 0.26, env: 'bell', bp: (u) => 600 + top * Math.sin(Math.PI * Math.min(1, u * 1.1)), q: 1.6, g: 1 })
        .noise({ t: 0.05, dur: 0.16, env: 'bell', hp: 3200, g: 0.18 });
    } },
  knife_hit: { dur: 0.3, prio: 5, level: 0.6, ref: 3, maxDist: 40, send: 0.05, max: 3, vars: 2, jit: 0.05,
    r: (S) => S.noise({ dur: 0.09, d: 0.02, lp: 650, g: 1 })
      .tone({ f: 195, f1: 118, glide: 0.03, d: 0.05, dur: 0.25, g: 0.6 })
      .click(0.001, 0.3).ring({ f: [1250, 1870], amp: [1, 0.6], dec: [0.03, 0.02], g: 0.12 }) },
  grenade_pin: { dur: 0.6, prio: 5, level: 0.5, ref: 2, maxDist: 25, send: 0.05, max: 2,
    r: (S) => S.click(0, 0.5)
      .ring({ t: 0.004, f: [2960, 4310, 5620, 7150], amp: [1, 0.6, 0.4, 0.2], dec: [0.2, 0.14, 0.09, 0.05], g: 0.5 })
      .noise({ t: 0.18, dur: 0.05, d: 0.01, bp: 3000, q: 2, g: 0.35 })
      .ring({ t: 0.19, f: [1800, 2650], amp: [1, 0.6], dec: [0.06, 0.04], g: 0.2 }) },
  grenade_bounce: { dur: 0.45, prio: 5, level: 0.6, ref: 3, maxDist: 55, send: 0.08, max: 3, vars: 3, jit: 0.08,
    r: (S) => S.noise({ dur: 0.06, d: 0.012, lp: 900, g: 0.9 })
      .tone({ f: 160, f1: 110, glide: 0.02, d: 0.03, dur: 0.15, g: 0.4 })
      .ring({ f: [820, 1370, 2240, 3310].map((x) => x * S.r(0.93, 1.07)), amp: [1, 0.7, 0.45, 0.25],
        dec: [0.09, 0.07, 0.05, 0.035], g: 0.6 }) },
  explosion: { dur: 3.6, prio: 8, level: 1, ref: 12, maxDist: 420, muffle: 1, send: 0.5, max: 3, vars: 2, jit: 0.04,
    r: (S) => {
      S.noise({ dur: 0.06, a: 0.0003, d: 0.012, hp: 1200, g: 1 })
        .tone({ f: 95, f1: 26, glide: 0.18, a: 0.004, d: 0.6, dur: 2.4, g: 1.3 })
        .tone({ f: 55, f1: 30, glide: 0.3, a: 0.01, d: 0.9, dur: 3, g: 0.6 })
        .noise({ dur: 1.4, a: 0.003, d: 0.25, lp: (u) => 150 + 3200 * (1 - u) ** 2, g: 1 })
        .noise({ t: 0.02, dur: 3.5, a: 0.05, d: 0.9, lp: 300, brown: 1, g: 0.9 });
      for (let i = 0; i < 26; i++) S.click(0.12 + S.rnd() ** 1.6 * 1.4, S.r(0.02, 0.12), 2500); // 파편 후드득
      S.sat(2).echo([{ t: 0.35, g: 0.25, lp: 700 }, { t: 0.8, g: 0.15, lp: 500 }, { t: 1.4, g: 0.08, lp: 400 }]);
    } },
  reload_mag_out: { dur: 0.35, prio: 4, level: 0.5, ref: 2, maxDist: 20, send: 0.03, max: 2,
    r: (S) => S.click(0, 0.6).noise({ t: 0.02, dur: 0.09, env: 'bell', bp: 2400, q: 1.4, g: 0.35 })
      .ring({ t: 0.09, f: [1650, 2480], amp: [1, 0.6], dec: [0.03, 0.02], g: 0.25 })
      .tone({ t: 0.1, f: 300, f1: 180, glide: 0.02, d: 0.02, dur: 0.12, g: 0.25 }) },
  reload_mag_in: { dur: 0.4, prio: 4, level: 0.55, ref: 2, maxDist: 20, send: 0.03, max: 2,
    r: (S) => S.noise({ dur: 0.1, env: 'bell', bp: 2000, q: 1.3, g: 0.3 }).click(0.11, 0.8)
      .ring({ t: 0.11, f: [1450, 2300, 3700], amp: [1, 0.6, 0.3], dec: [0.04, 0.03, 0.02], g: 0.35 })
      .tone({ t: 0.11, f: 240, f1: 140, glide: 0.02, d: 0.03, dur: 0.15, g: 0.45 }).click(0.16, 0.35) },
  bolt: { dur: 0.7, prio: 4, level: 0.6, ref: 2, maxDist: 25, send: 0.03, max: 2,
    r: (S) => S.click(0, 0.5).ring({ f: [2100, 3300], amp: [1, 0.5], dec: [0.03, 0.02], g: 0.2 })
      .noise({ t: 0.04, dur: 0.12, env: 'bell', bp: (u) => 1600 + 1200 * u, q: 1.2, g: 0.4 }).click(0.16, 0.6)
      .noise({ t: 0.3, dur: 0.1, env: 'bell', bp: (u) => 2600 - 1000 * u, q: 1.2, g: 0.4 })
      .click(0.41, 0.9).ring({ t: 0.41, f: [1300, 2050, 3150], amp: [1, 0.6, 0.3], dec: [0.05, 0.035, 0.02], g: 0.4 })
      .tone({ t: 0.41, f: 220, f1: 150, glide: 0.02, d: 0.025, dur: 0.12, g: 0.35 }).click(0.5, 0.5) },
  dry_fire: { dur: 0.12, prio: 4, level: 0.45, ref: 1.5, maxDist: 15, max: 2,
    r: (S) => S.click(0, 0.8).ring({ f: [3200, 4700], amp: [1, 0.5], dec: [0.015, 0.01], g: 0.3 })
      .tone({ f: 900, f1: 700, glide: 0.01, d: 0.01, dur: 0.05, g: 0.1 }) },
  switch: { dur: 0.3, prio: 4, level: 0.45, ref: 1.5, maxDist: 15, max: 2,
    r: (S) => S.noise({ dur: 0.14, env: 'bell', lp: 1800, g: 0.35 }).click(0.12, 0.5)
      .ring({ t: 0.12, f: [1900, 2900], amp: [1, 0.5], dec: [0.025, 0.015], g: 0.2 }) },
  footstep_concrete: { dur: 0.2, prio: 3, level: 0.45, ref: 2, roll: 1.4, maxDist: 32, send: 0.04, max: 6, vars: 4, jit: 0.06,
    r: (S) => S.noise({ dur: 0.07, a: 0.0008, d: 0.011, lp: S.r(1100, 1600), hp: 120, g: 1 })
      .noise({ t: 0.006, dur: 0.05, d: 0.009, bp: S.r(2200, 3200), q: 0.8, g: 0.3 })
      .tone({ f: 105, f1: 70, glide: 0.02, d: 0.018, dur: 0.1, g: 0.45 })
      .noise({ t: S.r(0.038, 0.055), dur: 0.05, d: 0.008, lp: 1000, g: 0.4 }) },
  footstep_steel: { dur: 0.8, prio: 3, level: 0.5, ref: 2.5, roll: 1.3, maxDist: 45, send: 0.08, max: 6, vars: 4, jit: 0.05,
    r: (S) => S.tone({ f: S.r(80, 90), f1: 60, glide: 0.05, d: 0.11, dur: 0.6, g: 1 })
      .tone({ f: 128, d: 0.06, dur: 0.3, g: 0.35 })
      .ring({ f: [287, 461, 733, 1109, 1620].map((x) => x * S.r(0.95, 1.05)), amp: [1, 0.8, 0.55, 0.35, 0.2],
        dec: [0.22, 0.16, 0.12, 0.08, 0.05], g: 0.28 })
      .noise({ dur: 0.05, d: 0.008, lp: 1700, g: 0.65 }) },
  hit_marker: { ui: 1, dur: 0.1, prio: 8, level: 0.5, max: 3, jit: 0.015,
    r: (S) => S.tone({ f: 2350, a: 0.0004, d: 0.016, dur: 0.08, tri: 1, g: 0.8 })
      .tone({ f: 1650, d: 0.01, dur: 0.05, g: 0.3 }).click(0, 0.35, 4000) },
  headshot: { ui: 1, dur: 0.5, prio: 9, level: 0.6, max: 2,
    r: (S) => S.click(0, 0.4, 4000).tone({ f: 2350, a: 0.0004, d: 0.016, dur: 0.08, tri: 1, g: 0.6 })
      .ring({ t: 0.004, f: [1760, 2640, 3553], amp: [1, 0.7, 0.3], dec: [0.16, 0.12, 0.06], g: 0.6 })
      .tone({ t: 0.05, f: 3150, d: 0.08, dur: 0.3, g: 0.22 }) },
  kill: { ui: 1, dur: 0.7, prio: 9, level: 0.55, max: 2,
    r: (S) => S.tone({ f: 987.8, d: 0.11, dur: 0.3, tri: 1, g: 0.5 }).tone({ f: 1975.5, d: 0.08, dur: 0.25, g: 0.12 })
      .tone({ t: 0.085, f: 1318.5, d: 0.2, dur: 0.55, tri: 1, g: 0.55 }).tone({ t: 0.085, f: 2637, d: 0.12, dur: 0.4, g: 0.1 }) },
  round_start: { ui: 1, dur: 3.2, prio: 10, level: 0.75, max: 1, send: 0.45,   // 선박 기적(낮은 혼, 맥놀이)
    r: (S) => S.tone({ f: 89, f1: 92, glide: 0.1, harm: 16, tilt: 0.8, env: 'hold', a: 0.16, h: 1.75, d: 0.28, dur: 3.1,
      vib: 0.002, vibF: 4.3, g: 0.8 })
      .tone({ f: 89.6, f1: 92.7, glide: 0.1, harm: 12, tilt: 0.9, env: 'hold', a: 0.2, h: 1.7, d: 0.3, dur: 3.1, g: 0.55 })
      .noise({ dur: 2.4, env: 'hold', a: 0.2, h: 1.6, d: 0.25, bp: 520, q: 0.6, g: 0.05 })
      .filter('low', 1500, 0.7) },
  round_win: { ui: 1, dur: 1.8, prio: 10, level: 0.6, max: 1, send: 0.25,
    r: (S) => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const t = [0, 0.11, 0.22, 0.36][i], d = i === 3 ? 0.55 : 0.22;
        S.tone({ t, f, d, dur: d * 5, tri: 1, g: 0.5 }).tone({ t, f: f * 2, d: d * 0.6, dur: d * 3, g: 0.12 });
      });
      S.ring({ t: 0.36, f: [2093, 3136], amp: [1, 0.6], dec: [0.4, 0.3], g: 0.08 });
    } },
  round_lose: { ui: 1, dur: 1.9, prio: 10, level: 0.6, max: 1, send: 0.25,
    r: (S) => {
      [[0, 440], [0.2, 349.23], [0.42, 293.66]].forEach(([t, f], i) => {
        const d = i === 2 ? 0.6 : 0.26;
        S.tone({ t, f, f1: i === 2 ? 277.2 : f, glide: 0.5, harm: 4, tilt: 1.6, a: 0.01, d, dur: d * 4.5, g: 0.6 });
      });
      S.filter('low', 1800);
    } },
  low_hp_heartbeat: { ui: 1, dur: 0.75, prio: 7, level: 0.7, max: 1,
    r: (S) => S.tone({ f: 64, f1: 42, glide: 0.05, a: 0.006, d: 0.07, dur: 0.35, g: 1 })
      .noise({ dur: 0.12, d: 0.035, lp: 160, g: 0.35 })
      .tone({ t: 0.24, f: 56, f1: 38, glide: 0.05, a: 0.006, d: 0.06, dur: 0.35, g: 0.7 })
      .noise({ t: 0.24, dur: 0.1, d: 0.03, lp: 140, g: 0.25 }) }
};

export const SOUND_NAMES = Object.freeze(Object.keys(DEFS));

/* ───────────── 엔진 ───────────── */

function softClipCurve() {                 // |x|≤0.75 선형, 그 위는 tanh로 0.99 미만에 수렴 → 하드 클리핑 없음
  const n = 2048, c = new Float32Array(n), T = 0.75, R = 0.24;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= T ? a : T + R * Math.tanh((a - T) / R));
  }
  return c;
}

function setComp(c, th, knee, ratio, atk, rel) {
  c.threshold.value = th; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = atk; c.release.value = rel;
}

function setAt(param, value, now, at) {     // 지난 이벤트를 비워 타임라인이 쌓이지 않게
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, at);
}

const tmpPos = { x: 0, y: 0, z: 0 };
function readPos(p) {                      // {x,y,z} | THREE.Vector3 | [x,y,z]
  if (!p) return null;
  if (Array.isArray(p)) { tmpPos.x = +p[0] || 0; tmpPos.y = +p[1] || 0; tmpPos.z = +p[2] || 0; }
  else { tmpPos.x = +p.x || 0; tmpPos.y = +p.y || 0; tmpPos.z = +p.z || 0; }
  return tmpPos;
}

export function createAudio(opts = {}) {
  const MAX3 = opts.maxVoices3d ?? 20;     // 3D 보이스(HRTF) 상한
  const MAX2 = opts.maxVoices2d ?? 8;      // 2D 보이스(UI·자기 무기) 상한
  let ctx = null, mix = null, outVol = null, verb = null, chainNodes = [];
  let volume = Math.min(1, Math.max(0, opts.volume ?? 0.8));
  let quality = opts.quality === 'low' ? 'low' : 'high';
  let disposed = false, prewarmTimer = 0, seq = 0;
  const L = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
  const cache = new Map();                 // name → AudioBuffer[] (합성 결과 재사용)
  const lastVar = new Map();
  const pool3 = [], pool2 = [];

  function build() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    ctx = new AC({ latencyHint: 'interactive' });
    mix = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); setComp(comp, -20, 10, 3.5, 0.004, 0.2);
    const makeup = ctx.createGain(); makeup.gain.value = 1.25;
    const limiter = ctx.createDynamicsCompressor(); setComp(limiter, -3, 0, 20, 0.001, 0.08);
    const clip = ctx.createWaveShaper(); clip.curve = softClipCurve(); clip.oversample = 'none';
    outVol = ctx.createGain(); outVol.gain.value = volume;
    mix.connect(comp); comp.connect(makeup); makeup.connect(limiter); limiter.connect(clip);
    clip.connect(outVol); outVol.connect(ctx.destination);
    verb = ctx.createConvolver(); verb.buffer = makeIR();
    const verbRet = ctx.createGain(); verbRet.gain.value = 0.55;
    verb.connect(verbRet); verbRet.connect(mix);
    chainNodes = [mix, comp, makeup, limiter, clip, outVol, verb, verbRet];
    for (let i = 0; i < MAX3; i++) pool3.push(makeVoice(true));
    for (let i = 0; i < MAX2; i++) pool2.push(makeVoice(false));
    applyListener();
    return true;
  }

  // 항만 잔향: 프리딜레이 + 컨테이너·탱크 벽 초기 반사 + 점점 어두워지는 꼬리 (합성 IR)
  function makeIR() {
    const sr = ctx.sampleRate, len = Math.floor(sr * 1.8), b = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c), rnd = mulberry32(99 + c * 31);
      let lp = 0;
      for (let i = Math.floor(sr * 0.012); i < len; i++) {
        const t = i / sr, fc = 400 + 7000 * Math.exp(-t / 0.35);
        lp += (1 - Math.exp((-2 * Math.PI * fc) / sr)) * (rnd() * 2 - 1 - lp);
        d[i] = lp * Math.exp(-t / 0.42);
      }
      for (const [t, g] of [[0.023, 0.5], [0.041, -0.35], [0.067, 0.28], [0.103, -0.2]]) {
        d[Math.floor((t + c * 0.003) * sr)] += g;
      }
    }
    return b;
  }

  function makeVoice(is3d) {
    const g = ctx.createGain(); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 20000; f.Q.value = 0.5;
    const send = ctx.createGain(); send.gain.value = 0;
    let out = f, p = null;
    g.connect(f);
    if (is3d) {
      p = ctx.createPanner();
      p.panningModel = quality === 'low' ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 420; p.rolloffFactor = 1;
      f.connect(p); out = p;
    }
    out.connect(mix); out.connect(send); send.connect(verb);
    return { is3d, g, f, p, send, src: null, name: '', score: 0, t0: 0, t1: 0, id: 0 };
  }

  // 변형 하나를 합성해 캐시에 추가 (캐시 배열은 변형 수만큼 점진적으로 채워진다)
  function renderVariant(name) {
    const def = DEFS[name], sr = ctx.sampleRate;
    let arr = cache.get(name);
    if (!arr) { arr = []; cache.set(name, arr); }
    if (arr.length >= (def.vars || 1)) return arr;
    const S = synth(sr, def.dur, hashStr(name) + arr.length * 7919);
    def.r(S, arr.length);
    const data = S.done();
    const b = ctx.createBuffer(1, data.length, sr);
    b.copyToChannel(data, 0);
    arr.push(b);
    return arr;
  }

  function getBuffer(name) {
    let arr = cache.get(name);
    if (!arr || !arr.length) arr = renderVariant(name);
    if (arr.length === 1) return arr[0];
    const last = lastVar.get(name) ?? -1;   // 같은 변형 연속 재생 방지
    let i = (Math.random() * arr.length) | 0;
    if (i === last) i = (i + 1) % arr.length;
    lastVar.set(name, i);
    return arr[i];
  }

  function schedulePrewarm() {             // 첫 재생 지연을 없애려고 유휴 시간에 변형 하나씩 미리 합성
    if (prewarmTimer || !ctx) return;
    const todo = [];
    for (const n of SOUND_NAMES) for (let v = 0; v < (DEFS[n].vars || 1); v++) todo.push(n);
    const step = () => {
      prewarmTimer = 0;
      if (disposed || !ctx) return;
      const n = todo.shift();
      if (!n) return;
      renderVariant(n);
      prewarmTimer = setTimeout(step, 16);
    };
    prewarmTimer = setTimeout(step, 30);
  }

  function isLive(v, now) {
    if (v.src && now > v.t1 + 0.1) release(v);   // ended 이벤트 누락 대비
    return !!v.src;
  }

  function release(v) {
    const s = v.src;
    v.src = null; v.name = '';
    if (s) { s.onended = null; try { s.disconnect(); } catch { /* 이미 해제 */ } }
  }

  // 빈 보이스 → 없으면 같은 소리 상한 초과분/가장 덜 중요한 보이스를 훔친다. 새 소리가 더 약하면 null.
  function acquire(pool, lim, name, def, score, now) {
    let free = null, same = 0, oldestSame = null, worst = null;
    for (let i = 0; i < lim; i++) {
      const v = pool[i];
      if (!isLive(v, now)) { if (!free) free = v; continue; }
      if (v.name === name) { same++; if (!oldestSame || v.t0 < oldestSame.t0) oldestSame = v; }
      if (!worst || v.score < worst.score || (v.score === worst.score && v.t0 < worst.t0)) worst = v;
    }
    if (same >= (def.max ?? 4)) return oldestSame;
    if (free) return free;
    if (worst && worst.score <= score) return worst;
    return null;
  }

  function fadeOutVoice(v, now, sec = 0.01) {
    const gp = v.g.gain;
    gp.cancelScheduledValues(now);
    gp.setValueAtTime(gp.value, now);
    gp.linearRampToValueAtTime(0, now + sec);
    const s = v.src;
    if (s) { try { s.stop(now + sec + 0.002); } catch { /* 이미 정지 */ } }
  }

  function play(name, o = {}) {
    if (!ctx || disposed || ctx.state === 'closed') return null;
    const def = DEFS[name];
    if (!def) return null;
    const now = ctx.currentTime;
    const p = def.ui ? null : readPos(o.pos);
    const is3d = !!p;
    let dist = 0;
    if (is3d) {
      dist = Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z);
      if (dist > def.maxDist) return null;               // 들리지 않을 거리면 보이스를 쓰지 않는다
    }
    const score = def.prio - (is3d ? Math.min(3, dist / 40) : 0);
    const pool = is3d ? pool3 : pool2;
    const lim = is3d && quality === 'low' ? Math.min(12, pool.length) : pool.length;
    const v = acquire(pool, lim, name, def, score, now);
    if (!v) return null;

    const stolen = !!v.src;
    if (stolen) {                                        // 이전 음원은 10ms 페이드 후 스스로 정지·해제 (클릭 방지)
      const old = v.src;
      fadeOutVoice(v, now);
      old.onended = () => { try { old.disconnect(); } catch { /* 이미 해제 */ } };
      v.src = null; v.name = '';
    }
    const at = stolen ? now + 0.012 : now;
    const buf = getBuffer(name);
    const src = ctx.createBufferSource();                // BufferSource는 스펙상 일회용(가벼움). 나머지 체인은 재사용.
    src.buffer = buf;
    const rate = Math.max(0.25, Math.min(4, (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (def.jit ?? 0.02))));
    src.playbackRate.value = rate;

    const gain = def.level * Math.max(0, o.gain ?? 1);
    const gp = v.g.gain;
    if (!stolen) gp.cancelScheduledValues(now);
    gp.setValueAtTime(gain, at);

    if (is3d) {
      const pn = v.p;
      pn.refDistance = def.ref ?? 4; pn.rolloffFactor = def.roll ?? 1; pn.maxDistance = def.maxDist;
      if (pn.positionX) { pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z; }
      else pn.setPosition(p.x, p.y, p.z);
      const half = def.muffle ? 24 : 50;                  // 멀수록 먹먹하게(저역 통과)
      const fc = Math.max(def.muffle ? 500 : 1400, 18000 * Math.pow(0.5, dist / half));
      setAt(v.f.frequency, fc, now, at);
    } else {
      setAt(v.f.frequency, 20000, now, at);
    }
    const sendAmt = (def.send ?? 0) * (is3d ? 0.6 + Math.min(0.8, dist / 60) : 0.5);
    setAt(v.send.gain, quality === 'low' ? sendAmt * 0.5 : sendAmt, now, at);

    src.connect(v.g);
    src.start(at);
    v.src = src; v.name = name; v.score = score; v.t0 = at; v.t1 = at + buf.duration / rate; v.id = ++seq;
    src.onended = () => { if (v.src === src) release(v); };
    const id = v.id;
    return {
      id,
      stop(fade = 0.05) { if (ctx && v.id === id && v.src) { fadeOutVoice(v, ctx.currentTime, fade); } }
    };
  }

  function stopAll(fade = 0.05) {
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const v of pool3.concat(pool2)) if (v.src) fadeOutVoice(v, now, fade);
  }

  function applyListener() {
    if (!ctx) return;
    const l = ctx.listener;
    const cp = Math.cos(L.pitch), sp = Math.sin(L.pitch), cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
    // three.js 카메라 관례(Euler 'YXZ', -Z가 정면): forward/up 벡터
    const fx = -sy * cp, fy = sp, fz = -cy * cp, ux = sy * sp, uy = cp, uz = cy * sp;
    if (l.positionX) {
      l.positionX.value = L.x; l.positionY.value = L.y; l.positionZ.value = L.z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
    } else {
      l.setPosition(L.x, L.y, L.z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  return {
    names: SOUND_NAMES,
    /** 첫 사용자 입력(click/keydown/pointerdown) 핸들러 안에서 호출. 여러 번 불러도 안전. */
    unlock() {
      if (disposed) return Promise.resolve(false);
      if (!ctx && !build()) return Promise.resolve(false);
      try {                                              // iOS Safari 언락용 무음 1샘플
        const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination); s.start(); s.onended = () => s.disconnect();
      } catch { /* 무시 */ }
      schedulePrewarm();
      if (ctx.state === 'suspended') return ctx.resume().then(() => ctx?.state === 'running', () => false);
      return Promise.resolve(ctx.state === 'running');
    },
    /** 0..1 마스터 볼륨(리미터 뒤 → 볼륨을 올려도 클리핑 없음) */
    setVolume(v) {
      volume = Math.min(1, Math.max(0, +v || 0));
      if (ctx) outVol.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
    },
    /** pos: {x,y,z}|Vector3|[x,y,z] (눈 위치), yaw/pitch: 라디안 (camera.rotation.y / .x, order 'YXZ') */
    setListener(pos, yaw = 0, pitch = 0) {
      const p = readPos(pos);
      if (p) { L.x = p.x; L.y = p.y; L.z = p.z; }
      L.yaw = +yaw || 0; L.pitch = +pitch || 0;
      applyListener();
    },
    /** name: SOUND_NAMES 중 하나. pos가 있으면 3D, 없으면 2D. 반환: { id, stop(fade) } | null(생략됨) */
    play,
    stopAll,
    /** 'low': HRTF→equalpower, 3D 보이스 12개, 잔향 절반 */
    setQuality(q) {
      quality = q === 'low' ? 'low' : 'high';
      for (const v of pool3) v.p.panningModel = quality === 'low' ? 'equalpower' : 'HRTF';
    },
    getStats() {
      const now = ctx ? ctx.currentTime : 0;
      const count = (pool) => pool.reduce((n, v) => n + (isLive(v, now) ? 1 : 0), 0);
      return {
        state: ctx ? ctx.state : 'locked', sampleRate: ctx ? ctx.sampleRate : 0, quality,
        voices3d: count(pool3), voices2d: count(pool2), pool3d: pool3.length, pool2d: pool2.length, cached: cache.size
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(prewarmTimer); prewarmTimer = 0;
      for (const v of pool3.concat(pool2)) {
        if (v.src) { try { v.src.stop(); } catch { /* 무시 */ } release(v); }
        for (const n of [v.g, v.f, v.p, v.send]) if (n) { try { n.disconnect(); } catch { /* 무시 */ } }
      }
      for (const n of chainNodes) { try { n.disconnect(); } catch { /* 무시 */ } }
      pool3.length = 0; pool2.length = 0; chainNodes = [];
      cache.clear(); lastVar.clear();
      if (ctx) { const c = ctx; ctx = null; c.close().catch(() => {}); }
    }
  };
}
