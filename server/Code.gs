/**
 * 구직 플래너 서버 — 구글 로그인 + 노션식 공유 권한 (시험판)
 * - 로그인: 앱이 구글 로그인 확인증(ID 토큰)을 보내면 서버가 구글에 진짜인지 확인 → 30일짜리 서버 출입증(세션) 발급
 * - 플래너: 사람마다 하나 (처음 로그인하면 자동 생성). 데이터는 플래너마다 구글 시트 하나
 * - 권한: 주인 / 전체 허용(편집·댓글·공유) / 편집 허용 / 댓글 허용 / 읽기 허용. 모든 요청에서 서버가 권한을 확인
 * - 플래너 목록·공유 목록 = "구직 플래너(로그인) 관리" 시트 (민석님이 직접 열어 고칠 수도 있음)
 *
 * 스크립트 속성 (자동 생성)
 *   REG_SHEET          관리 시트 id
 *   SESSION_SECRET     세션 서명용 비밀 값
 *   ANTHROPIC_API_KEY  Claude API 키 (민석님이 직접 입력)
 *   DAILY_LIMIT        공고 정리 하루 한도 (기본 30)
 */

const CLIENT_ID = '405546328317-siu1ah5girrbl1o2us9rtls4eafpn8eh.apps.googleusercontent.com'; // 공개 값 (구글 로그인 이름표)
const MODEL_DEFAULT = 'claude-haiku-5-5';
const RANK = { read: 1, comment: 2, edit: 3, full: 4, owner: 5 };
const SHARE_ROLES = ['full', 'edit', 'comment', 'read'];
const SESSION_DAYS = 30;

const SCHEMA = {
  posts: { tab: '공고', cols: [['id','id'],['co','회사'],['job','지원 직무'],['role','상세 직무명'],['type','유형'],['ind','업권'],['loc','근무지'],
    ['link','공고 링크'],['relLink','관련 자료'],['applyStart','접수 시작'],['dueKind','마감 종류'],['due','마감'],['recheck','재확인일'],
    ['stage','단계'],['result','결과'],['failAt','탈락 단계'],['submitted','제출일'],['steps','전형 절차'],['cur','현재 전형'],
    ['memo','비고'],['src','등록 경로'],['created','생성일'],['updated','수정일'],['short','달력 표시 이름'],['rev','수정번호']] },
  qs: { tab: '문항', cols: [['id','id'],['pid','공고 id'],['i','순번'],['t','문항'],['n','글자 수'],['a','답변'],['st','상태'],['lock','잠금'],['ver','버전']] },
  events: { tab: '일정', cols: [['id','id'],['pid','공고 id'],['d','날짜'],['k','종류'],['t','내용']] },
  tasks: { tab: '할 일', cols: [['id','id'],['pid','공고 id'],['t','내용'],['due','기한'],['done','완료'],['doneAt','완료일'],['auto','자동']] },
  comments: { tab: '댓글', cols: [['id','id'],['pid','공고 id'],['qi','문항 번호'],['quote','고른 문장'],['text','내용'],['by','작성자'],['at','작성일'],
    ['replies','답글'],['resolved','해결'],['read','읽음'],['ver','버전']] },
  hist: { tab: '이력', cols: [['id','id'],['pid','공고 id'],['d','날짜'],['t','내용']] },
  settings: { tab: '설정', cols: [['k','항목'],['v','값']] }
};
/* 관리 시트: 플래너 목록 · 공유 목록 */
const REG = {
  planners: { tab: '플래너', cols: [['id','플래너 id'],['name','이름'],['owner','주인 이메일'],['sheet','데이터 시트 id'],['created','만든 날']] },
  shares: { tab: '공유', cols: [['pid','플래너 id'],['email','이메일'],['role','권한'],['by','공유한 사람'],['at','공유한 날']] }
};

/* ---------- 진입점 ---------- */
function doGet() {
  const r = ensureInit_();
  return out_({ ok: true, app: 'job-planner-login', msg: '구직 플래너(로그인 시험판) 서버가 동작 중이에요.', init: r });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  try {
    ensureInit_();
    if (req.action === 'login') return out_(login_(req.idToken));
    const email = checkSession_(req.sess);
    if (!email) return out_({ ok: false, error: 'auth' });
    switch (req.action) {
      case 'loadAll': return out_(loadFor_(email));
      case 'batch': return out_(batchFor_(email, String(req.pid || ''), req.ops || []));
      case 'share': return out_(share_(email, String(req.pid || ''), req.emails || [], String(req.role || '')));
      case 'setRole': return out_(setRole_(email, String(req.pid || ''), String(req.email || ''), String(req.role || '')));
      case 'extract': return out_(extract_(req.input || {}));
      case 'fetchImg': return out_(fetchImg_(req.url));
      default: return out_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    console.error(err && err.stack || err);
    return out_({ ok: false, error: 'server_error', detail: String(err && err.message || err) });
  }
}

/* ---------- 공통 ---------- */
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function props_() { return PropertiesService.getScriptProperties(); }
function today_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }
function normEmail_(s) { return String(s || '').trim().toLowerCase(); }
function isEmail_(s) { return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s); }

/* ---------- 처음 한 번: 관리 시트 + (있으면) 기존 데이터 복사 ---------- */
function ensureInit_() {
  const p = props_();
  if (p.getProperty('INIT_DONE')) return 'ready';
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (p.getProperty('INIT_DONE')) return 'ready';
    if (!p.getProperty('SESSION_SECRET')) p.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid());
    if (!p.getProperty('DAILY_LIMIT')) p.setProperty('DAILY_LIMIT', '30');
    const admin = normEmail_(Session.getEffectiveUser().getEmail());
    const reg = { planners: [], shares: [] };
    // 기존 앱 데이터 복사 (server/Local.gs 의 IMPORT_FROM. GitHub엔 올리지 않음). 기존 시트는 읽기만 함
    if (typeof IMPORT_FROM !== 'undefined' && IMPORT_FROM) {
      [['me', '민석', admin], ['gh', '건희', '']].forEach(([id, name, owner]) => {
        if (!IMPORT_FROM[id]) return;
        const b = newBook_(name);
        const old = SpreadsheetApp.openById(IMPORT_FROM[id]);
        Object.keys(SCHEMA).forEach(t => writeTable_(b, t, readOld_(old, t)));
        reg.planners.push({ id: id, name: name, owner: owner, sheet: b.getId(), created: today_() });
      });
      // 건희 플래너는 주인이 정해질 때까지 민석님이 전체 허용으로 관리 (관리 시트 '주인 이메일' 칸에 건희 이메일을 넣으면 건희 것이 됨)
      if (reg.planners.some(x => x.id === 'gh')) reg.shares.push({ pid: 'gh', email: admin, role: 'full', by: admin, at: today_() });
    }
    saveReg_(reg);
    p.setProperty('INIT_DONE', '1');
    return 'created';
  } finally { lock.releaseLock(); }
}

/** 기존 시트에서 머리글 이름으로 읽기 (기존 시트는 절대 고치지 않음) */
function readOld_(b, table) {
  const def = SCHEMA[table], sh = b.getSheetByName(def.tab);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const head = vals[0];
  const idx = def.cols.map(c => head.indexOf(c[1]));
  return vals.slice(1).filter(r => r.some(v => v !== '')).map(r => { const o = {}; def.cols.forEach((c, i) => o[c[0]] = idx[i] >= 0 ? r[idx[i]] : ''); return o; });
}

/* ---------- 관리 시트 (플래너·공유 목록) ---------- */
function regBook_() {
  const p = props_(), id = p.getProperty('REG_SHEET');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* 지워졌으면 새로 */ } }
  const b = SpreadsheetApp.create('구직 플래너(로그인) 관리');
  p.setProperty('REG_SHEET', b.getId());
  Object.keys(REG).forEach(t => tab_(b, REG[t]));
  const first = b.getSheets().find(s => !Object.keys(REG).some(t => REG[t].tab === s.getName()));
  if (first && b.getSheets().length > 1) b.deleteSheet(first);
  return b;
}
function reg_() {
  const c = CacheService.getScriptCache().get('reg');
  if (c) return JSON.parse(c);
  const b = regBook_(), r = {};
  Object.keys(REG).forEach(t => r[t] = readDef_(b, REG[t]));
  r.planners.forEach(x => x.owner = normEmail_(x.owner));
  r.shares.forEach(x => x.email = normEmail_(x.email));
  CacheService.getScriptCache().put('reg', JSON.stringify(r), 120);
  return r;
}
function saveReg_(r) {
  const b = regBook_();
  Object.keys(REG).forEach(t => writeDef_(b, REG[t], r[t]));
  CacheService.getScriptCache().put('reg', JSON.stringify(r), 120);
}

/* 이 사람이 이 플래너에 가진 권한 ('' = 없음) */
function roleOf_(reg, email, pid) {
  const pl = reg.planners.find(x => x.id === pid);
  if (!pl) return '';
  if (pl.owner && pl.owner === email) return 'owner';
  const s = reg.shares.find(x => x.pid === pid && x.email === email);
  return s && RANK[s.role] ? s.role : '';
}

/* ---------- 로그인 · 세션 ---------- */
function login_(idToken) {
  if (!idToken) return { ok: false, error: 'login_failed' };
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'login_failed' };
  const info = JSON.parse(res.getContentText());
  const okIss = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  if (info.aud !== CLIENT_ID || !okIss || String(info.email_verified) !== 'true' || Number(info.exp) * 1000 < Date.now()) return { ok: false, error: 'login_failed' };
  const email = normEmail_(info.email);
  ensurePlanner_(email, info.name || email.split('@')[0]);
  return { ok: true, sess: makeSession_(email), email: email, name: info.name || '', picture: info.picture || '' };
}
function secret_() { return props_().getProperty('SESSION_SECRET'); }
function b64_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function makeSession_(email) {
  const body = b64_(Utilities.newBlob(JSON.stringify({ e: email, x: Date.now() + SESSION_DAYS * 864e5 })).getBytes());
  return body + '.' + b64_(Utilities.computeHmacSha256Signature(body, secret_()));
}
function checkSession_(tok) {
  tok = String(tok || '');
  const i = tok.indexOf('.');
  if (i < 1) return '';
  const body = tok.slice(0, i), sig = tok.slice(i + 1);
  if (b64_(Utilities.computeHmacSha256Signature(body, secret_())) !== sig) return '';
  try {
    const pad = body + '==='.slice((body.length + 3) % 4);
    const o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
    if (!o.e || Date.now() > o.x) return '';
    return normEmail_(o.e);
  } catch (e) { return ''; }
}

/* 처음 로그인한 사람에겐 빈 플래너를 하나 만들어 줌 */
function ensurePlanner_(email, name) {
  let reg = reg_();
  if (reg.planners.some(x => x.owner === email)) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    CacheService.getScriptCache().remove('reg');
    reg = reg_();
    if (reg.planners.some(x => x.owner === email)) return;
    const b = newBook_(name);
    reg.planners.push({ id: Utilities.getUuid().slice(0, 8), name: String(name).slice(0, 30), owner: email, sheet: b.getId(), created: today_() });
    saveReg_(reg);
  } finally { lock.releaseLock(); }
}

/* ---------- 불러오기 ---------- */
function loadFor_(email) {
  const reg = reg_();
  const acc = reg.planners.map(pl => ({ pl: pl, role: roleOf_(reg, email, pl.id) })).filter(x => x.role);
  const mine = acc.find(x => x.role === 'owner');
  const data = {}, sheets = {};
  acc.forEach(x => {
    data[x.pl.id] = loadAll_(x.pl);
    if (x.role === 'owner') sheets[x.pl.id] = 'https://docs.google.com/spreadsheets/d/' + x.pl.sheet + '/edit';
  });
  // 댓글 쓴 사람 이름을 보여 주려고: 내가 볼 수 있는 플래너에 관련된 사람들의 플래너 이름만
  const people = {};
  acc.forEach(x => { if (x.pl.owner) people[x.pl.owner] = 1; reg.shares.filter(s => s.pid === x.pl.id).forEach(s => people[s.email] = 1); });
  people[email] = 1;
  const names = {};
  reg.planners.forEach(pl => { if (people[pl.owner] || acc.some(x => x.pl.id === pl.id)) names[pl.id] = pl.name; });
  const meta = {
    email: email, me: mine ? mine.pl.id : '', names: names,
    planners: acc.map(x => plannerMeta_(reg, x.pl, x.role))
  };
  return { ok: true, meta: meta, data: data, usage: usage_(), sheets: sheets };
}
function plannerMeta_(reg, pl, role) {
  const nameOf = e => { const o = reg.planners.find(x => x.owner === e); return o ? o.name : ''; };
  return { id: pl.id, name: pl.name, owner: pl.owner, ownerName: pl.name, role: role,
    shares: reg.shares.filter(s => s.pid === pl.id).map(s => ({ email: s.email, role: s.role, name: nameOf(s.email) })) };
}
function book_(pl) { return SpreadsheetApp.openById(pl.sheet); }
function newBook_(name) {
  const b = SpreadsheetApp.create('구직 플래너(로그인) 데이터 - ' + name);
  Object.keys(SCHEMA).forEach(t => sheet_(b, t));
  const first = b.getSheets().find(s => !Object.keys(SCHEMA).some(t => SCHEMA[t].tab === s.getName()));
  if (first && b.getSheets().length > 1) b.deleteSheet(first);
  return b;
}
function loadAll_(pl) {
  const b = book_(pl), t = {};
  Object.keys(SCHEMA).forEach(k => t[k] = readTable_(b, k));
  return t;
}

/* ---------- 시트 읽기·쓰기 ---------- */
function tab_(b, def) {
  let sh = b.getSheetByName(def.tab);
  if (!sh) {
    sh = b.insertSheet(def.tab);
    sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols.map(c => c[1])]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), def.cols.length).setNumberFormat('@');
  } else if (sh.getLastColumn() < def.cols.length) {
    sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols.map(c => c[1])]).setFontWeight('bold');
    sh.getRange(1, 1, sh.getMaxRows(), def.cols.length).setNumberFormat('@');
  }
  return sh;
}
function readDef_(b, def) {
  const sh = tab_(b, def), last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, def.cols.length).getDisplayValues();
  return vals.filter(r => r.some(v => v !== '')).map(r => { const o = {}; def.cols.forEach((c, i) => o[c[0]] = r[i]); return o; });
}
function writeDef_(b, def, rows) {
  const sh = tab_(b, def), last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, def.cols.length).clearContent();
  if (!rows.length) return;
  const vals = rows.map(o => def.cols.map(c => o[c[0]] == null ? '' : String(o[c[0]])));
  if (sh.getMaxRows() < vals.length + 1) sh.insertRowsAfter(sh.getMaxRows(), vals.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, vals.length, def.cols.length).setNumberFormat('@').setValues(vals);
}
function sheet_(b, table) { return tab_(b, SCHEMA[table]); }
function readTable_(b, table) { return readDef_(b, SCHEMA[table]); }
function writeTable_(b, table, rows) { writeDef_(b, SCHEMA[table], rows); }

/* ---------- 저장 (권한 확인 후) ---------- */
function batchFor_(email, pid, ops) {
  const reg = reg_(), role = roleOf_(reg, email, pid);
  if (!role) return { ok: false, error: 'forbidden' };
  if (RANK[role] < RANK.edit) {
    // 댓글 허용: 댓글 표에 쓰기만. 읽기 허용: 아무것도 못 씀
    const onlyComments = RANK[role] >= RANK.comment && ops.every(op => op.table === 'comments' && op.op === 'upsert');
    if (!onlyComments) return { ok: false, error: 'forbidden' };
  }
  return batch_(reg.planners.find(x => x.id === pid), ops);
}

/**
 * ops: [{op:'replace', table, key, value, rows}, {op:'upsert', table, rows, key?}, {op:'remove', table, key, value}]
 * 표마다 한 번 읽고, 바꾼 뒤 한 번에 씀 (칸 하나씩 쓰지 않음)
 */
function batch_(pl, ops) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const b = book_(pl), cache = {};
    const get = t => { if (!SCHEMA[t]) throw new Error('알 수 없는 표: ' + t); if (!cache[t]) cache[t] = readTable_(b, t); return cache[t]; };
    const conflicts = [], revs = {};
    ops.forEach(op => {
      if (op.op !== 'check') return;
      const cur = get('posts').find(r => r.id === String(op.id));
      if (String(cur ? (cur.rev || '') : '') !== String(op.rev || '') && conflicts.indexOf(op.unit) < 0) conflicts.push(op.unit);
    });
    ops.forEach(op => {
      if (op.op === 'check' || (op.unit && conflicts.indexOf(op.unit) >= 0)) return;
      const rows = get(op.table);
      if (op.table === 'posts' && op.op === 'upsert') (op.rows || []).forEach(n => { n.rev = Utilities.getUuid().slice(0, 8); revs[n.id] = n.rev; });
      if (op.op === 'replace') {
        cache[op.table] = rows.filter(r => r[op.key] !== String(op.value)).concat(op.rows || []);
      } else if (op.op === 'upsert') {
        const key = op.key || (op.table === 'settings' ? 'k' : 'id');
        (op.rows || []).forEach(n => {
          const i = rows.findIndex(r => r[key] === String(n[key]));
          if (i >= 0) rows[i] = Object.assign({}, rows[i], n); else rows.push(n);
        });
      } else if (op.op === 'remove') {
        cache[op.table] = rows.filter(r => r[op.key] !== String(op.value));
      }
    });
    Object.keys(cache).forEach(t => writeTable_(b, t, cache[t]));
    return { ok: true, at: new Date().toISOString(), conflicts: conflicts, revs: revs };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 공유 (주인·전체 허용만) ---------- */
function share_(email, pid, emails, role) {
  if (SHARE_ROLES.indexOf(role) < 0) return { ok: false, error: 'bad_role' };
  const list = (Array.isArray(emails) ? emails : String(emails).split(/[,;\s]+/)).map(normEmail_).filter(Boolean);
  const bad = list.filter(e => !isEmail_(e));
  if (!list.length || bad.length) return { ok: false, error: 'bad_email', detail: bad.join(', ') };
  return editShares_(email, pid, reg => {
    const pl = reg.planners.find(x => x.id === pid);
    list.forEach(e => {
      if (e === pl.owner) return;
      const s = reg.shares.find(x => x.pid === pid && x.email === e);
      if (s) s.role = role; else reg.shares.push({ pid: pid, email: e, role: role, by: email, at: today_() });
    });
  });
}
function setRole_(email, pid, target, role) {
  target = normEmail_(target);
  if (role !== 'remove' && SHARE_ROLES.indexOf(role) < 0) return { ok: false, error: 'bad_role' };
  return editShares_(email, pid, reg => {
    const i = reg.shares.findIndex(x => x.pid === pid && x.email === target);
    if (i < 0) return;
    if (role === 'remove') reg.shares.splice(i, 1); else reg.shares[i].role = role;
  }, target === email && role === 'remove');
}
function editShares_(email, pid, fn, selfLeave) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    CacheService.getScriptCache().remove('reg');
    const reg = reg_(), role = roleOf_(reg, email, pid);
    if (!role) return { ok: false, error: 'forbidden' };
    if (RANK[role] < RANK.full && !(selfLeave)) return { ok: false, error: 'forbidden' }; // 나가기는 누구나
    fn(reg);
    saveReg_(reg);
    const pl = reg.planners.find(x => x.id === pid);
    const myRole = roleOf_(reg, email, pid);
    return { ok: true, planner: myRole ? plannerMeta_(reg, pl, myRole) : null };
  } finally { lock.releaseLock(); }
}

/* ---------- 공고 자동 정리 ---------- */
function usageKey_() { return 'USAGE_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd'); }
function usage_() {
  const p = props_();
  return { used: Number(p.getProperty(usageKey_()) || 0), limit: Number(p.getProperty('DAILY_LIMIT') || 30), hasKey: !!p.getProperty('ANTHROPIC_API_KEY') };
}

function pageText_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  if (res.getResponseCode() >= 400) return '';
  let html = res.getContentText();
  const meta = [];
  html.replace(/<meta[^>]+(?:property|name)=["'](?:og:title|og:description|description)["'][^>]*content=["']([^"']+)["'][^>]*>/gi, (m, c) => { meta.push(c); return m; });
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return (meta.join('\n') + '\n' + text).trim().slice(0, 60000);
}

/* 이미지 주소 → 서버가 대신 받아서 앱에 돌려줌 (앱이 잘라서 글자 크기를 지킨 채로 보내도록) */
function fetchImg_(url) {
  url = String(url || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'img_fetch', detail: 'bad_url' };
  try {
    const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
                 'Accept': 'image/avif,image/webp,image/png,image/*,*/*;q=0.8', 'Referer': url.replace(/^(https?:\/\/[^\/]+).*$/, '$1/') } });
    const code = r.getResponseCode();
    if (code !== 200) return { ok: false, error: 'img_fetch', detail: 'http_' + code };
    const blob = r.getBlob(), bytes = blob.getBytes();
    let type = String(blob.getContentType() || '').split(';')[0].toLowerCase();
    if (!/^image\//.test(type)) {
      const b0 = bytes[0] & 255, b1 = bytes[1] & 255;
      type = b0 === 0xFF && b1 === 0xD8 ? 'image/jpeg' : b0 === 0x89 && b1 === 0x50 ? 'image/png' : b0 === 0x47 ? 'image/gif' : b0 === 0x52 ? 'image/webp' : '';
    }
    if (!type) return { ok: false, error: 'img_fetch', detail: 'not_image' };
    if (bytes.length > 15 * 1024 * 1024) return { ok: false, error: 'img_fetch', detail: 'too_big' };
    return { ok: true, type: type, data: Utilities.base64Encode(bytes), size: bytes.length };
  } catch (e) { return { ok: false, error: 'img_fetch', detail: String(e).slice(0, 120) }; }
}

function extract_(input) {
  const p = props_(), u = usage_();
  const key = p.getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'no_api_key' };
  if (u.used >= u.limit) return { ok: false, error: 'limit', usage: u };

  const content = [];
  let pageTxt = '';
  if (input.url) {
    pageTxt = pageText_(input.url);
    if (pageTxt.length < 400 && !(input.images && input.images.length) && !(input.imageUrls && input.imageUrls.length) && !input.text) return { ok: false, error: 'need_capture' };
  }
  const MAX_IMGS = 20;
  (input.images || []).slice(0, MAX_IMGS).forEach(img => {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.type || 'image/jpeg', data: img.data } });
  });
  // 이미지 주소: 서버가 대신 받아서 넣음 (jpeg/png/gif/webp, 5MB 이하)
  let urlImgs = 0; const urlFail = [];
  (input.imageUrls || []).slice(0, Math.max(0, MAX_IMGS - (input.images || []).length)).forEach(u => {
    try {
      if (!/^https?:\/\//i.test(String(u))) return;
      const r = UrlFetchApp.fetch(String(u), { muteHttpExceptions: true, followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' } });
      if (r.getResponseCode() !== 200) { urlFail.push(String(u)); return; }
      const blob = r.getBlob(), bytes = blob.getBytes();
      let type = String(blob.getContentType() || '').split(';')[0].toLowerCase();
      if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) {
        const b0 = bytes[0] & 255, b1 = bytes[1] & 255;
        type = b0 === 0xFF && b1 === 0xD8 ? 'image/jpeg' : b0 === 0x89 && b1 === 0x50 ? 'image/png' : b0 === 0x47 ? 'image/gif' : b0 === 0x52 ? 'image/webp' : '';
      }
      if (!type || bytes.length > 5 * 1024 * 1024) { urlFail.push(String(u)); return; }
      content.push({ type: 'image', source: { type: 'base64', media_type: type, data: Utilities.base64Encode(bytes) } });
      urlImgs++;
    } catch (e) { urlFail.push(String(u)); }
  });
  // 서버가 못 받은 이미지는 Claude가 직접 주소로 받아 보게 함 (일부 사이트는 구글 서버 접속을 막음)
  urlFail.forEach(u => { content.push({ type: 'image', source: { type: 'url', url: u } }); urlImgs++; });
  if ((input.imageUrls || []).length && !urlImgs && !(input.images || []).length && !input.text && pageTxt.length < 400) return { ok: false, error: 'img_fetch' };
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const jobList = (input.jobs && input.jobs.length ? input.jobs : ['제품영업','솔루션영업','기술영업','금융영업','사업개발','자산운용','리스크/심사']).map(String);
  const jobs = jobList.join(', ');
  const indList = (input.inds && input.inds.length ? input.inds : ['은행','증권','자산운용','저축은행','캐피탈/카드','보험','공기업','일반기업','기타']).map(String);
  const salesHint = jobList.some(j => /제품영업|솔루션영업|기술영업|금융영업/.test(j)) ?
    '  (영업 구분: 제품영업=하드웨어·소비재 등 완제품 판매 / 솔루션영업=소프트웨어·SaaS·클라우드·IT서비스·결제 등 B2B 서비스 / 기술영업=반도체·장비·부품 등 기술 이해가 필요한 엔지니어링 제품 / 금융영업=은행·증권·카드 등 금융회사의 영업·RM·여신)\n' : '';
  content.push({ type: 'text', text:
    '아래 채용 공고에서 정보를 뽑아 JSON으로 정리해 주세요. 오늘은 ' + today + ' (한국 시간)입니다.\n' +
    '규칙\n' +
    '- readable: 회사 이름과 모집 직무를 실제로 읽을 수 있으면 true. 글자가 흐리거나 작거나 잘려서 못 읽겠거나, 채용 공고가 아니면 false로 하고 unreadable_reason에 그 이유를 한국어 한 문장으로. 이때 나머지 칸은 비워 두고 절대 추측해서 채우지 말 것\n' +
    '- 이미지가 여러 장이면 한 화면을 위에서 아래로 잘라 둔 것일 수 있음 (경계가 조금씩 겹침)\n' +
    '- positions: 한 공고에 모집 직무(분야)가 2개 이상이면 전부 하나씩 나열 (role=공고에 적힌 직무명 그대로, job=아래 job 목록 중 가장 가까운 것, loc=근무지, career=신입/경력/무관 중 공고에 적힌 것, note=주요 업무 25자 이내). 이때 위쪽 role·job·loc은 비우고 memo엔 공통 내용만. 모집 직무가 1개면 positions는 []\n' +
    '- 공고에 없는 정보는 지어내지 말고 빈 문자열 "" (숫자는 0, 목록은 [])\n' +
    '- job: 다음 중 가장 가까운 것 하나 (맞는 게 없으면 ""): ' + jobs + '\n' + salesHint +
    '- role: 공고에 적힌 직무명 그대로 · type: 체험형(인턴 후 정규직 전환 없음)/전환형(채용연계·채용전제·정규직 전환 가능 인턴)/정규직/계약직 중 하나. 인턴인데 전환 여부가 공고에 없으면 "" · ind(업권): ' + indList.join(' / ') + ' 중 하나 (지원하는 부문이 하는 사업 기준. 사업이 하나인 회사는 회사 업종 그대로, 여러 사업을 하는 회사는 이 공고가 뽑는 부문의 사업으로. 예: 장비 렌탈 회사의 IT장비 영업 → IT/소프트웨어, 고객센터 회사의 AICC(AI 콜센터) 영업 → IT/소프트웨어, 게임 회사 → IT/소프트웨어. 핀테크=결제·대출·투자 등 금융 서비스를 하는 IT 회사)\n' +
    '- 마감: 날짜와 시각이 있으면 dueKind "확정", due "YYYY-MM-DDTHH:MM" (시각이 없으면 23:59). "채용 시 마감"이면 dueKind "채용시". 알 수 없으면 "미확인". 연도가 없으면 오늘 이후 가장 가까운 날짜로\n' +
    '- applyStart: 접수 시작일 "YYYY-MM-DD" (없으면 "")\n' +
    '- steps: 전형 순서 (예: ["서류","인적성","1차 면접","최종 면접"])\n' +
    '- events: 공고에 날짜가 나온 전형 일정만 (k: apt=인적성·AI역량, int=면접, ann=결과 발표, etc=기타). 서류 마감은 넣지 않음\n' +
    '- qs: 자기소개서 문항을 **원문 그대로** (요약·수정 금지), n은 글자 수 제한 (없으면 0)\n' +
    '- memo: "고용형태 · 근무지 · 주요 업무 · 전형 · 우대 · 마감 시각" 순서로 한 줄 요약 (가운뎃점으로 구분, 공고에 있는 것만)\n' +
    '- short: 휴대폰 달력의 좁은 칸에 쓸 회사 줄임말. 한글 2~4자 또는 영문 약자 2~5자로 널리 쓰는 이름 (예: SK네트웍스서비스→SKNS, 고영테크놀러지→고영, 한국투자증권→한투)\n' +
    (input.text ? '\n[붙여넣은 공고 본문]\n' + String(input.text).slice(0, 60000) + '\n' : '') +
    (pageTxt ? '\n[링크에서 가져온 내용] ' + input.url + '\n' + pageTxt + '\n' : '') +
    (((input.images || []).length || urlImgs) ? '\n[위 이미지는 공고 화면 캡처입니다]\n' : '')
  });

  const schema = { type: 'object', additionalProperties: false,
    required: ['readable','unreadable_reason','co','short','job','role','type','ind','loc','applyStart','dueKind','due','steps','events','qs','memo','positions'],
    properties: {
      readable: { type: 'boolean' }, unreadable_reason: { type: 'string' },
      co: { type: 'string' }, short: { type: 'string' }, job: { type: 'string' }, role: { type: 'string' },
      type: { type: 'string', enum: ['', '체험형', '전환형', '정규직', '계약직'] },
      ind: { type: 'string', enum: [''].concat(indList) },
      loc: { type: 'string' }, applyStart: { type: 'string' },
      dueKind: { type: 'string', enum: ['확정', '채용시', '미확인'] }, due: { type: 'string' },
      steps: { type: 'array', items: { type: 'string' } },
      events: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['d','k','t'],
        properties: { d: { type: 'string' }, k: { type: 'string', enum: ['apt','int','ann','etc'] }, t: { type: 'string' } } } },
      qs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['t','n'], properties: { t: { type: 'string' }, n: { type: 'integer' } } } },
      memo: { type: 'string' },
      positions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role','job','loc','career','note'],
        properties: { role: { type: 'string' }, job: { type: 'string' }, loc: { type: 'string' }, career: { type: 'string' }, note: { type: 'string' } } } }
    } };

  // 비교 시험용: 정해 둔 모델 중에서만 바꿔 볼 수 있음
  const MODEL = p.getProperty('MODEL') || MODEL_DEFAULT;
  const model = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].indexOf(input.model) >= 0 ? input.model : MODEL;
  const body = {
    model: model, max_tokens: 8000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: schema } },
    messages: [{ role: 'user', content: content }]
  };
  if (model !== 'claude-haiku-5-5') body.fallbacks = 'default'; // Haiku는 거절 시 다른 모델로 넘기는 기능이 없음
  const call = (b, beta) => UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: Object.assign({ 'x-api-key': key, 'anthropic-version': '2026-10-21' }, beta ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    payload: JSON.stringify(b)
  });
  let res = call(body, !!body.fallbacks);
  if (res.getResponseCode() === 400 && /fallback/i.test(res.getContentText())) { // 거절 대비 옵션이 안 맞으면 옵션 없이 다시
    delete body.fallbacks; res = call(body, false);
  }
  const code = res.getResponseCode();
  const txt = res.getContentText();
  if (code !== 200) {
    console.error('Claude API ' + code + ' ' + txt.slice(0, 1000));
    if (code === 400 && urlFail.length && /image|url|fetch|download/i.test(txt)) return { ok: false, error: 'img_fetch', detail: txt.slice(0, 300) };
    return { ok: false, error: code === 429 ? 'rate_limited' : code === 401 ? 'bad_api_key' : 'api_error', detail: txt.slice(0, 300) };
  }
  const msg = JSON.parse(txt);
  p.setProperty(usageKey_(), String(u.used + 1));
  if (msg.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
  if (msg.stop_reason === 'max_tokens') return { ok: false, error: 'too_long' };
  const t = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  let data;
  try { data = JSON.parse(t); } catch (e) { return { ok: false, error: 'parse_error' }; }
  // 못 읽었으면 다음 단계(확인 화면)로 넘기지 않음. 회사·직무가 둘 다 비어도 못 읽은 것으로 봄
  if (data.readable === false || (!String(data.co || '').trim() && !String(data.role || '').trim() && !String(data.job || '').trim() && !(data.positions || []).length))
    return { ok: false, error: 'unreadable', detail: String(data.unreadable_reason || '').slice(0, 200), usage: usage_() };
  return { ok: true, data: data, usage: usage_() };
}
