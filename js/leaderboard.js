/*
 * Leaderboard + 이름 계정
 *  - local    : localStorage (기기/브라우저별, 계정 없이 이름만 — 이름별 최고 기록 유지)
 *  - supabase : 팀 공유 랭킹. 쓰기는 모두 DB 함수(RPC)로만 (supabase/accounts.sql)
 *      · 이름 중복 불가, 처음 쓰는 이름은 비밀번호와 함께 계정 생성
 *      · 이름·모드별 최고 기록 1개만 유지 (더 좋은 기록일 때만 갱신)
 *      · 로그인 유지: 세션 토큰(localStorage). 비밀번호는 저장하지 않음
 *      · 관리자: Supabase Auth 로그인 + public.admins 등록 계정
 *
 * 정렬 기준: 점수↓ → 정답률↓ → 시간(오래 버텨라·게임은 오래 버틴 순, 학습 모드는 빨리 푼 순) → 등록시각↑
 */
(function () {
  'use strict';

  var MODES = {
    survival: '오래 버텨라',
    ox: 'OX 퀴즈',
    mc: '객관식',
    short: '주관식',
    mixed: '종합 모의고사',
    runner: '항로 질주',
    shooter: '슈팅해운',
    sniper: '스나이퍼해운'
  };
  // 점수제 게임 모드: score = 획득 점수, total = 시도 수, 정답률 = correct / total
  var POINT_MODES = { runner: true, shooter: true, sniper: true };
  var LS_KEY = 'portquiz.leaderboard.v1';
  var NAME_KEY = 'portquiz.lastName';
  var SESSION_KEY = 'portquiz.session';
  var ADMIN_KEY = 'portquiz.admin';
  var MAX_LOCAL_PER_MODE = 100;
  var NAME_MAX = 12;

  var cfg = (window.APP_CONFIG && window.APP_CONFIG.leaderboard) || {};
  var sb = cfg.supabase || {};
  var remoteEnabled = cfg.provider === 'supabase' && !!sb.url && !!sb.anonKey;
  var TABLE = sb.table || 'scores';
  var BASE = String(sb.url || '').replace(/\/+$/, '');

  var MESSAGES = {
    WRONG_PASSWORD: '비밀번호가 맞지 않아요. 이미 다른 사람이 쓰고 있는 이름일 수 있어요.',
    LOCKED: '비밀번호를 5번 틀려 5분 동안 잠겼어요. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.',
    NAME_INVALID: '이름은 1~12자로 입력해 주세요.',
    PASSWORD_INVALID: '비밀번호는 4~32자로 입력해 주세요.',
    SESSION_EXPIRED: '로그인이 만료됐어요. 이름과 비밀번호로 다시 로그인해 주세요.',
    LOGIN_REQUIRED: '이름과 비밀번호를 입력해 주세요.',
    NOT_FOUND: '등록되지 않은 이름이에요. 랭킹에 처음 기록을 등록하면 계정이 만들어져요.',
    NAME_TAKEN: '이미 있는 이름이에요.',
    FORBIDDEN: '관리자 권한이 없는 계정이에요.',
    NETWORK: '랭킹 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.',
    MODE_INVALID: '알 수 없는 모드예요.',
    ADMIN_LOGIN_FAILED: '관리자 이메일 또는 비밀번호가 맞지 않아요.',
    ADMIN_SESSION_EXPIRED: '관리자 로그인이 만료됐어요. 다시 로그인해 주세요.'
  };

  function fail(code, fallback) {
    var e = new Error(MESSAGES[code] || fallback || '알 수 없는 오류가 발생했어요.');
    e.code = MESSAGES[code] ? code : (code || 'UNKNOWN');
    return e;
  }

  function cleanName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  }
  function nameKey(name) { return cleanName(name).toLowerCase(); }

  // 오래 버텨라·게임 모드는 동점이면 더 오래 버틴 쪽이 위, 학습 모드는 더 빨리 푼 쪽이 위
  function timeDir(mode) { return (mode === 'survival' || POINT_MODES[mode]) ? -1 : 1; }

  function compare(a, b) {
    return (b.score - a.score) ||
      (b.accuracy - a.accuracy) ||
      timeDir(a.mode) * (a.timeMs - b.timeMs) ||
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  }

  function makeEntry(input, requireName) {
    input = input || {};
    if (!Object.prototype.hasOwnProperty.call(MODES, input.mode)) throw fail('MODE_INVALID');
    var name = cleanName(input.name);
    if (requireName && (!name || name.length > NAME_MAX)) throw fail('NAME_INVALID');
    var points = !!POINT_MODES[input.mode];
    var score = Math.max(0, Math.floor(Number(input.score) || 0));
    var total = Math.max(0, Math.floor(Number(input.total) || 0));
    var correct;
    if (points) {
      correct = Math.min(total, Math.max(0, Math.floor(Number(input.correct) || 0)));
    } else {
      total = Math.max(score, total);
      correct = score;
    }
    var timeMs = Math.max(0, Math.round(Number(input.timeMs) || 0));
    return {
      mode: input.mode,
      name: name,
      score: score,
      total: total,
      correct: correct,
      accuracy: total ? correct / total : 0,
      timeMs: timeMs,
      createdAt: new Date().toISOString()
    };
  }

  function bestOf(e) {
    return { score: e.score, total: e.total, accuracy: e.accuracy, timeMs: e.timeMs, createdAt: e.createdAt };
  }

  /* ---------- 저장소 헬퍼 ---------- */
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* ignore */ } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
  function ssGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function ssSet(key, v) { try { sessionStorage.setItem(key, v); } catch (e) { /* ignore */ } }
  function ssDel(key) { try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ } }

  function readSession() {
    if (!remoteEnabled) return null;
    try {
      var s = JSON.parse(lsGet(SESSION_KEY) || 'null');
      return s && typeof s.token === 'string' && s.token && typeof s.name === 'string' ? s : null;
    } catch (e) { return null; }
  }
  function writeSession(token, name) { lsSet(SESSION_KEY, JSON.stringify({ token: token, name: name })); }
  function clearSession() { lsDel(SESSION_KEY); }

  /* ---------- localStorage 랭킹 (계정 없음) ---------- */
  function readAll() {
    try {
      var data = JSON.parse(lsGet(LS_KEY) || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  var local = {
    submit: function (entry) {
      var all = readAll();
      var list = Array.isArray(all[entry.mode]) ? all[entry.mode] : [];
      var key = nameKey(entry.name);
      var old = null;
      for (var i = 0; i < list.length; i++) {
        if (nameKey(list[i].name) === key) { old = list[i]; break; }
      }
      var improved = !old || compare(entry, old) < 0;
      var kept = old;
      if (improved) {
        entry.id = old ? old.id : 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        list = list.filter(function (x) { return x !== old; });
        list.push(entry);
        kept = entry;
      }
      list.sort(compare);
      var rank = list.indexOf(kept) + 1;
      all[entry.mode] = list.slice(0, MAX_LOCAL_PER_MODE);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(all));
      } catch (e) {
        throw new Error('이 브라우저에서는 기록을 저장할 수 없습니다 (localStorage 사용 불가).');
      }
      return { id: kept.id, rank: rank || null, improved: improved, name: kept.name, best: bestOf(kept) };
    },
    getTop: function (mode, limit) {
      var list = readAll()[mode];
      list = Array.isArray(list) ? list.slice() : [];
      list.sort(compare);
      return list.slice(0, limit);
    }
  };

  /* ---------- Supabase 통신 ---------- */
  function orderFor(mode) {
    return 'order=score.desc,accuracy.desc,time_ms.' + (timeDir(mode) < 0 ? 'desc' : 'asc') + ',created_at.asc';
  }

  function request(path, opts) {
    opts = opts || {};
    var headers = { apikey: sb.anonKey, 'Content-Type': 'application/json' };
    headers.Authorization = 'Bearer ' + (opts.bearer || sb.anonKey);
    return fetch(BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        return { res: res, body: body };
      });
    }, function () {
      throw fail('NETWORK');
    });
  }

  // RPC 호출: { ok:false, error } 응답과 HTTP 오류를 코드가 있는 Error로 바꾼다
  function rpc(fn, args, bearer) {
    return request('/rest/v1/rpc/' + fn, { method: 'POST', body: args || {}, bearer: bearer }).then(function (r) {
      var body = r.body;
      if (!r.res.ok) {
        var msg = (body && (body.message || body.hint)) || '';
        if (body && (body.code === 'PGRST301' || /jwt/i.test(msg))) throw fail('ADMIN_SESSION_EXPIRED');
        if (r.res.status === 401 || r.res.status === 403 || (body && body.code === '42501') || /FORBIDDEN/.test(msg)) {
          throw fail('FORBIDDEN');
        }
        throw fail('NETWORK', '랭킹 서버 오류 (' + r.res.status + ')');
      }
      if (body && body.ok === false) throw fail(body.error);
      return body;
    });
  }

  function fromRow(r) {
    return {
      id: r.id,
      mode: r.mode,
      name: r.name,
      score: r.score,
      total: r.total,
      accuracy: Number(r.accuracy) || 0,
      timeMs: r.time_ms,
      createdAt: r.created_at
    };
  }

  function mapBest(b) {
    b = b || {};
    return {
      score: b.score, total: b.total, accuracy: Number(b.accuracy) || 0,
      timeMs: b.timeMs, createdAt: b.createdAt
    };
  }

  var remote = {
    submit: function (entry, input) {
      var args = {
        p_mode: entry.mode, p_score: entry.score, p_total: entry.total,
        p_correct: entry.correct, p_time_ms: entry.timeMs
      };
      var hasName = cleanName(input && input.name) !== '';
      var hasPassword = input && input.password != null && String(input.password) !== '';
      var usedToken = false;
      if (hasName || hasPassword) {
        if (!hasName) throw fail('NAME_INVALID');
        if (!hasPassword) throw fail('PASSWORD_INVALID');
        args.p_name = cleanName(input.name);
        args.p_password = String(input.password);
      } else {
        var s = readSession();
        if (!s) throw fail('LOGIN_REQUIRED');
        args.p_token = s.token;
        usedToken = true;
      }
      return rpc('submit_score', args).then(function (r) {
        if (r.token) writeSession(r.token, r.name);
        else if (usedToken) { var cur = readSession(); if (cur && cur.name !== r.name) writeSession(cur.token, r.name); }
        lsSet(NAME_KEY, r.name || '');
        return { id: r.id, rank: r.rank == null ? null : r.rank, improved: !!r.improved, name: r.name, best: mapBest(r.best) };
      }, function (e) {
        if (e.code === 'SESSION_EXPIRED') clearSession();
        throw e;
      });
    },
    getTop: function (mode, limit) {
      var q = '/rest/v1/' + TABLE + '?select=id,mode,name,score,total,accuracy,time_ms,created_at&mode=eq.' +
        encodeURIComponent(mode) + '&' + orderFor(mode) + '&limit=' + limit;
      return request(q).then(function (r) {
        if (!r.res.ok) throw fail('NETWORK', '랭킹 서버 오류 (' + r.res.status + ')');
        return (r.body || []).map(fromRow);
      });
    }
  };

  /* ---------- 관리자 (Supabase Auth) ---------- */
  function readAdmin() {
    try {
      var a = JSON.parse(ssGet(ADMIN_KEY) || 'null');
      return a && a.accessToken ? a : null;
    } catch (e) { return null; }
  }
  function saveAdmin(tok, email) {
    var a = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: Date.now() + Math.max(60, Number(tok.expires_in) || 3600) * 1000,
      email: (tok.user && tok.user.email) || email || ''
    };
    ssSet(ADMIN_KEY, JSON.stringify(a));
    return a;
  }
  function authToken(params, body) {
    return fetch(BASE + '/auth/v1/token?grant_type=' + params, {
      method: 'POST',
      headers: { apikey: sb.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (j) { return { ok: res.ok, body: j }; });
    }, function () { throw fail('NETWORK'); });
  }
  function adminToken() {
    var a = readAdmin();
    if (!a) return Promise.reject(fail('ADMIN_SESSION_EXPIRED'));
    if (a.expiresAt - Date.now() > 60000) return Promise.resolve(a.accessToken);
    return authToken('refresh_token', { refresh_token: a.refreshToken }).then(function (r) {
      if (!r.ok || !r.body || !r.body.access_token) { ssDel(ADMIN_KEY); throw fail('ADMIN_SESSION_EXPIRED'); }
      return saveAdmin(r.body, a.email).accessToken;
    });
  }
  function adminRpc(fn, args) {
    if (!remoteEnabled) return Promise.reject(fail('NETWORK', '공유 랭킹(Supabase)이 설정되지 않았어요.'));
    return adminToken().then(function (t) {
      return rpc(fn, args, t);
    }).catch(function (e) {
      if (e.code === 'ADMIN_SESSION_EXPIRED') ssDel(ADMIN_KEY);
      throw e;
    });
  }

  var admin = {
    login: function (email, password) {
      if (!remoteEnabled) return Promise.reject(fail('NETWORK', '공유 랭킹(Supabase)이 설정되지 않았어요.'));
      return authToken('password', { email: String(email || '').trim(), password: String(password || '') }).then(function (r) {
        if (!r.ok || !r.body || !r.body.access_token) throw fail('ADMIN_LOGIN_FAILED');
        return { email: saveAdmin(r.body, email).email };
      });
    },
    logout: function () {
      var a = readAdmin();
      ssDel(ADMIN_KEY);
      if (!a || !remoteEnabled) return Promise.resolve();
      return fetch(BASE + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: sb.anonKey, Authorization: 'Bearer ' + a.accessToken }
      }).then(function () {}, function () {});
    },
    isLoggedIn: function () { return !!readAdmin(); },
    email: function () { var a = readAdmin(); return a ? a.email : null; },
    listPlayers: function () {
      return adminRpc('admin_list_players', {}).then(function (rows) {
        return (rows || []).map(function (p) {
          return {
            id: p.id, name: p.name, hasPassword: !!p.hasPassword,
            failedCount: p.failedCount || 0, lockedUntil: p.lockedUntil || null, createdAt: p.createdAt,
            records: (p.records || []).map(function (s) {
              return {
                id: s.id, mode: s.mode, score: s.score, total: s.total,
                accuracy: Number(s.accuracy) || 0, timeMs: s.timeMs, createdAt: s.createdAt
              };
            })
          };
        });
      });
    },
    setPassword: function (playerId, newPassword) {
      return adminRpc('admin_set_password', { p_player_id: playerId, p_new: String(newPassword || '') }).then(function () {});
    },
    createPlayer: function (name, password) {
      return adminRpc('admin_create_player', { p_name: cleanName(name), p_password: String(password || '') })
        .then(function (r) { return { id: r.id, name: r.name }; });
    },
    renamePlayer: function (playerId, newName) {
      return adminRpc('admin_rename_player', { p_player_id: playerId, p_new_name: cleanName(newName) }).then(function () {});
    },
    unlock: function (playerId) {
      return adminRpc('admin_unlock', { p_player_id: playerId }).then(function () {});
    },
    deletePlayer: function (playerId) {
      return adminRpc('admin_delete_player', { p_player_id: playerId }).then(function () {});
    },
    deleteScore: function (scoreId) {
      return adminRpc('admin_delete_score', { p_score_id: scoreId }).then(function () {});
    }
  };

  /* ---------- 공개 API ---------- */
  window.Leaderboard = {
    MODES: MODES,
    isShared: function () { return remoteEnabled; },
    supportsAccounts: function () { return remoteEnabled; },
    getSession: function () {
      var s = readSession();
      return s ? { name: s.name } : null;
    },
    login: function (name, password) {
      return Promise.resolve().then(function () {
        if (!remoteEnabled) throw fail('NETWORK', '공유 랭킹(Supabase)이 설정되지 않았어요.');
        var n = cleanName(name);
        if (!n || n.length > NAME_MAX) throw fail('NAME_INVALID');
        if (password == null || String(password).length < 4) throw fail('PASSWORD_INVALID');
        return rpc('player_login', { p_name: n, p_password: String(password) }).then(function (r) {
          writeSession(r.token, r.name);
          lsSet(NAME_KEY, r.name || '');
          return { name: r.name };
        });
      });
    },
    logout: function () {
      var s = readSession();
      clearSession();
      if (!s) return Promise.resolve();
      return rpc('player_logout', { p_token: s.token }).then(function () {}, function () {});
    },
    submit: function (input) {
      return Promise.resolve().then(function () {
        if (remoteEnabled) {
          var entry = makeEntry(input, false);
          return remote.submit(entry, input);
        }
        return local.submit(makeEntry(input, true));
      });
    },
    myRecords: function () {
      return Promise.resolve().then(function () {
        var s = readSession();
        if (!s) throw fail('LOGIN_REQUIRED');
        return rpc('player_records', { p_token: s.token }).then(function (r) {
          if (r.name && r.name !== s.name) writeSession(s.token, r.name);
          return {
            name: r.name,
            records: (r.records || []).map(function (x) {
              return {
                mode: x.mode, score: x.score, total: x.total, accuracy: Number(x.accuracy) || 0,
                timeMs: x.timeMs, createdAt: x.createdAt, rank: x.rank == null ? null : x.rank
              };
            })
          };
        }, function (e) {
          if (e.code === 'SESSION_EXPIRED') clearSession();
          throw e;
        });
      });
    },
    changePassword: function (oldPassword, newPassword) {
      return Promise.resolve().then(function () {
        var s = readSession();
        if (!s) throw fail('LOGIN_REQUIRED');
        if (newPassword == null || String(newPassword).length < 4 || String(newPassword).length > 32) throw fail('PASSWORD_INVALID');
        return rpc('player_change_password', {
          p_token: s.token, p_old: String(oldPassword || ''), p_new: String(newPassword)
        }).then(function () {}, function (e) {
          if (e.code === 'SESSION_EXPIRED') clearSession();
          throw e;
        });
      });
    },
    getTop: function (mode, limit) {
      return Promise.resolve().then(function () {
        var n = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 10));
        return remoteEnabled ? remote.getTop(mode, n) : local.getTop(mode, n);
      });
    },
    getLastName: function () { return lsGet(NAME_KEY) || ''; },
    setLastName: function (name) { lsSet(NAME_KEY, cleanName(name).slice(0, NAME_MAX)); },
    admin: admin
  };
})();
