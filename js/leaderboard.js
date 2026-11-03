/*
 * Leaderboard storage
 *  - local    : localStorage (기본, 기기/브라우저별 기록)
 *  - supabase : Supabase REST(PostgREST) — 팀 공유 랭킹 (js/config.js 에서 설정)
 *
 * 정렬 기준: 점수↓ → 정답률↓ → 소요시간↑ → 등록시각↑
 */
(function () {
  'use strict';

  var MODES = {
    survival: '오래 버텨라',
    ox: 'OX 퀴즈',
    mc: '객관식',
    short: '주관식',
    mixed: '종합 모의고사'
  };
  var LS_KEY = 'portquiz.leaderboard.v1';
  var NAME_KEY = 'portquiz.lastName';
  var MAX_LOCAL_PER_MODE = 100;
  var NAME_MAX = 12;

  var cfg = (window.APP_CONFIG && window.APP_CONFIG.leaderboard) || {};
  var sb = cfg.supabase || {};
  var remoteEnabled = cfg.provider === 'supabase' && !!sb.url && !!sb.anonKey;
  var TABLE = sb.table || 'scores';

  function cleanName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  }

  // 오래 버텨라(survival)는 동점이면 더 오래 버틴 쪽이 위, 나머지 모드는 더 빨리 푼 쪽이 위
  function timeDir(mode) { return mode === 'survival' ? -1 : 1; }

  function compare(a, b) {
    return (b.score - a.score) ||
      (b.accuracy - a.accuracy) ||
      timeDir(a.mode) * (a.timeMs - b.timeMs) ||
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  }

  function makeEntry(input) {
    input = input || {};
    if (!Object.prototype.hasOwnProperty.call(MODES, input.mode)) throw new Error('알 수 없는 모드입니다: ' + input.mode);
    var name = cleanName(input.name);
    if (!name) throw new Error('이름을 입력해 주세요.');
    var score = Math.max(0, Math.floor(Number(input.score) || 0));
    var total = Math.max(score, Math.floor(Number(input.total) || 0));
    var timeMs = Math.max(0, Math.round(Number(input.timeMs) || 0));
    return {
      mode: input.mode,
      name: name,
      score: score,
      total: total,
      accuracy: total ? score / total : 0,
      timeMs: timeMs,
      createdAt: new Date().toISOString()
    };
  }

  /* ---------- localStorage ---------- */
  function readAll() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var data = raw ? JSON.parse(raw) : {};
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  var local = {
    submit: function (entry) {
      var all = readAll();
      var list = Array.isArray(all[entry.mode]) ? all[entry.mode] : [];
      entry.id = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      list.push(entry);
      list.sort(compare);
      var rank = list.indexOf(entry) + 1;
      all[entry.mode] = list.slice(0, MAX_LOCAL_PER_MODE);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(all));
      } catch (e) {
        throw new Error('이 브라우저에서는 기록을 저장할 수 없습니다 (localStorage 사용 불가).');
      }
      return { id: entry.id, rank: rank };
    },
    getTop: function (mode, limit) {
      var list = readAll()[mode];
      list = Array.isArray(list) ? list.slice() : [];
      list.sort(compare);
      return list.slice(0, limit);
    }
  };

  /* ---------- Supabase (PostgREST) ---------- */
  function orderFor(mode) {
    return 'order=score.desc,accuracy.desc,time_ms.' + (timeDir(mode) < 0 ? 'desc' : 'asc') + ',created_at.asc';
  }

  function sbRequest(path, method, body, prefer) {
    var headers = {
      apikey: sb.anonKey,
      Authorization: 'Bearer ' + sb.anonKey,
      'Content-Type': 'application/json'
    };
    if (prefer) headers.Prefer = prefer;
    return fetch(String(sb.url).replace(/\/+$/, '') + '/rest/v1/' + path, {
      method: method || 'GET',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('랭킹 서버 오류 (' + res.status + ')');
      return res.status === 204 ? null : res.json();
    }, function () {
      throw new Error('랭킹 서버에 연결할 수 없습니다.');
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

  var remote = {
    submit: function (entry) {
      return sbRequest(TABLE, 'POST', {
        mode: entry.mode,
        name: entry.name,
        score: entry.score,
        total: entry.total,
        accuracy: entry.accuracy,
        time_ms: entry.timeMs
      }, 'return=representation').then(function (rows) {
        var saved = rows && rows[0];
        if (!saved) throw new Error('랭킹 등록 결과를 확인할 수 없습니다.');
        var q = TABLE + '?select=id&mode=eq.' + encodeURIComponent(entry.mode) + '&' + orderFor(entry.mode) + '&limit=500';
        return sbRequest(q).then(function (ids) {
          var idx = -1;
          for (var i = 0; i < ids.length; i++) {
            if (String(ids[i].id) === String(saved.id)) { idx = i; break; }
          }
          return { id: saved.id, rank: idx >= 0 ? idx + 1 : null };
        }, function () {
          return { id: saved.id, rank: null };
        });
      });
    },
    getTop: function (mode, limit) {
      var q = TABLE + '?select=*&mode=eq.' + encodeURIComponent(mode) + '&' + orderFor(mode) + '&limit=' + limit;
      return sbRequest(q).then(function (rows) { return (rows || []).map(fromRow); });
    }
  };

  window.Leaderboard = {
    MODES: MODES,
    isShared: function () { return remoteEnabled; },
    submit: function (input) {
      return Promise.resolve().then(function () {
        var entry = makeEntry(input);
        return remoteEnabled ? remote.submit(entry) : local.submit(entry);
      });
    },
    getTop: function (mode, limit) {
      return Promise.resolve().then(function () {
        var n = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 10));
        return remoteEnabled ? remote.getTop(mode, n) : local.getTop(mode, n);
      });
    },
    getLastName: function () {
      try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
    },
    setLastName: function (name) {
      try { localStorage.setItem(NAME_KEY, cleanName(name)); } catch (e) { /* ignore */ }
    }
  };
})();
