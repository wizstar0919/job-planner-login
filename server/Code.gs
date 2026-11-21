/**
 * 구직 플래너 서버 — 구글 로그인 + 노션식 공유 권한 (시험판)
 * - 로그인: 앱이 구글 로그인 확인증(ID 토큰)을 보내면 서버가 구글에 진짜인지 확인 → 30일짜리 서버 출입증(세션) 발급
 * - 플래너: 사람마다 하나 (처음 로그인하면 자동 생성). 데이터는 플래너마다 구글 시트 하나
 * - 권한: 주인(자기 플래너만 수정·공유) / 댓글 허용 / 읽기 허용. 남의 플래너는 고칠 수 없음. 모든 요청에서 서버가 권한을 확인
 * - 가입 승인 · 사람별 하루 공고 정리 한도 · 관리자 콘솔(admin.html)용 요청은 관리자(서버 주인)만
 * - 플래너 목록·공유 목록 = "구직 플래너(로그인) 관리" 시트 (민석님이 직접 열어 고칠 수도 있음)
 *
 * 스크립트 속성 (자동 생성)
 *   REG_SHEET          관리 시트 id
 *   SESSION_SECRET     세션 서명용 비밀 값
 *   ANTHROPIC_API_KEY  Claude API 키 (민석님이 직접 입력)
 *   DAILY_LIMIT        공고 정리 서버 전체 하루 한도 (기본 100, 안전장치)
 *   USER_LIMIT         공고 정리 한 사람당 하루 한도 (기본 20, 회원 탭 '하루 한도' 칸으로 사람별 변경)
 */

const CLIENT_ID = '405546328317-siu1ah5girrbl1o2us9rtls4eafpn8eh.apps.googleusercontent.com'; // 공개 값 (구글 로그인 이름표)
const MODEL_DEFAULT = 'claude-haiku-5-5';
const RANK = { read: 1, comment: 2, edit: 3, full: 4, owner: 5 };
const SHARE_ROLES = ['comment', 'read'];
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
  shares: { tab: '공유', cols: [['pid','플래너 id'],['email','이메일'],['role','권한'],['by','공유한 사람'],['at','공유한 날']] },
  members: { tab: '회원', cols: [['email','이메일'],['name','이름'],['status','상태'],['joined','가입일'],['decided','처리일'],['limit','하루 한도']] }
};
/* 가입 승인: 관리자(서버 주인)·플래너 주인·공유받은 사람은 자동 승인, 그 밖의 새 사람은 '대기' → 관리자가 승인. '거절'이면 전부 막힘 */
const ST = { ok: '승인', wait: '대기', no: '거절' };

/* ---------- 진입점 ---------- */
function doGet() {
  const r = ensureInit_();
  migrate_();
  return out_({ ok: true, app: 'job-planner-login', msg: '구직 플래너(로그인 시험판) 서버가 동작 중이에요.', init: r });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  try {
    ensureInit_();
    migrate_();
    if (req.action === 'login') return out_(login_(req.idToken));
    const email = checkSession_(req.sess);
    if (!email) return out_({ ok: false, error: 'auth' });
    switch (req.action) {
      case 'loadAll': return out_(loadFor_(email));
      case 'batch': return out_(batchFor_(email, String(req.pid || ''), req.ops || []));
      case 'share': return out_(share_(email, String(req.pid || ''), req.emails || [], String(req.role || '')));
      case 'setRole': return out_(setRole_(email, String(req.pid || ''), String(req.email || ''), String(req.role || '')));
      case 'extract': return out_(approved_(email) ? extract_(req.input || {}, email) : { ok: false, error: 'forbidden' });
      case 'fetchImg': return out_(approved_(email) ? fetchImgFor_(email, req.url) : { ok: false, error: 'forbidden' });
      case 'logoutAll': bumpSess_(email); return out_({ ok: true });
      case 'adminInfo': case 'approve': case 'setLimit': case 'setDefaults': case 'setOwner':
        return out_(email === admin_() ? adminAct_(email, req) : { ok: false, error: 'forbidden' });
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
    if (admin) p.setProperty('ADMIN_EMAIL', admin);
    const reg = { planners: [], shares: [], members: [] };
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
  if (c) { const r = JSON.parse(c); if (Object.keys(REG).every(t => Array.isArray(r[t]))) return r; }
  const b = regBook_(), r = {};
  Object.keys(REG).forEach(t => r[t] = readDef_(b, REG[t]));
  r.planners.forEach(x => x.owner = normEmail_(x.owner));
  r.shares.forEach(x => x.email = normEmail_(x.email));
  r.members.forEach(x => { x.email = normEmail_(x.email); x.status = String(x.status || '').trim(); });
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
  if (status_(reg, email) !== ST.ok) return '';
  const pl = reg.planners.find(x => x.id === pid);
  if (!pl) return '';
  if (pl.owner && pl.owner === email) return 'owner';
  const s = reg.shares.find(x => x.pid === pid && x.email === email);
  if (!s || !RANK[s.role]) return '';
  return s.role === 'full' || s.role === 'edit' ? 'comment' : s.role; // 예전 권한은 댓글 허용으로
}

/* ---------- 가입 승인 ---------- */
function admin_() {
  const p = props_();
  let a = p.getProperty('ADMIN_EMAIL');
  if (!a) { a = normEmail_(Session.getEffectiveUser().getEmail()); if (a) p.setProperty('ADMIN_EMAIL', a); }
  return a;
}
/* '승인' / '대기' / '거절' / '' (처음 보는 사람) */
function status_(reg, email) {
  if (!email) return '';
  if (email === admin_()) return ST.ok;
  const m = reg.members.find(x => x.email === email);
  if (m && m.status === ST.no) return ST.no;
  if ((m && m.status === ST.ok) || reg.planners.some(x => x.owner === email) || reg.shares.some(x => x.email === email)) return ST.ok;
  return m ? ST.wait : '';
}
function approved_(email) { return status_(reg_(), email) === ST.ok; }
function members_(reg) {
  const p = props_(), admin = admin_(), list = reg.members.slice();
  if (admin && !list.some(m => m.email === admin)) {
    const pl = reg.planners.find(x => x.owner === admin);
    list.unshift({ email: admin, name: pl ? pl.name : admin.split('@')[0], joined: '', decided: '', limit: '' });
  }
  return list.map(m => ({ email: m.email, name: m.name, status: status_(reg, m.email), joined: m.joined, decided: m.decided,
    admin: m.email === admin, limit: userLimit_(reg, m.email), custom: String(m.limit || '').trim(),
    used: Number(p.getProperty(userKey_(m.email)) || 0), planner: (reg.planners.find(x => x.owner === m.email) || {}).name || '' }));
}
/* 회원 목록에 기록 (처음 로그인할 때) */
function addMember_(email, name, status) {
  editReg_(reg => {
    if (reg.members.some(x => x.email === email)) return;
    reg.members.push({ email: email, name: String(name).slice(0, 30), status: status, joined: today_(), decided: status === ST.ok ? today_() : '', limit: '' });
  });
}
/* 관리 시트를 잠그고 고친 뒤 저장 (fn 이 error 를 돌려주면 저장 안 함) */
function editReg_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    CacheService.getScriptCache().remove('reg');
    const reg = reg_();
    const r = fn(reg);
    if (r && r.error) return r;
    saveReg_(reg);
    return r;
  } finally { lock.releaseLock(); }
}
function memberRow_(reg, email) {
  let m = reg.members.find(x => x.email === email);
  if (!m) { m = { email: email, name: email.split('@')[0], status: '', joined: today_(), decided: '', limit: '' }; reg.members.push(m); }
  return m;
}
/* ---------- 관리자 콘솔 ---------- */
function adminAct_(admin, req) {
  const p = props_();
  if (req.action === 'approve') {
    const target = normEmail_(req.email), status = String(req.status || '');
    if (!isEmail_(target) || target === admin) return { ok: false, error: 'bad_email' };
    if ([ST.ok, ST.no, ST.wait].indexOf(status) < 0) return { ok: false, error: 'bad_role' };
    editReg_(reg => { const m = memberRow_(reg, target); m.status = status; m.decided = today_(); });
    if (status !== ST.ok) bumpSess_(target); // 거절·대기로 바꾸면 그 사람 기기의 로그인도 모두 끊음
  } else if (req.action === 'setLimit') {
    const target = normEmail_(req.email), v = String(req.limit == null ? '' : req.limit).trim();
    if (!isEmail_(target)) return { ok: false, error: 'bad_email' };
    if (v !== '' && !/^\d{1,4}$/.test(v)) return { ok: false, error: 'bad_number' };
    editReg_(reg => { memberRow_(reg, target).limit = v; });
  } else if (req.action === 'setDefaults') {
    const u = String(req.userLimit == null ? '' : req.userLimit), t = String(req.total == null ? '' : req.total);
    if (!/^\d{1,4}$/.test(u) || !/^\d{1,4}$/.test(t)) return { ok: false, error: 'bad_number' };
    p.setProperty('USER_LIMIT', u); p.setProperty('DAILY_LIMIT', t);
  } else if (req.action === 'setOwner') {
    const pid = String(req.pid || ''), target = normEmail_(req.email);
    if (!isEmail_(target)) return { ok: false, error: 'bad_email' };
    const r = editReg_(reg => {
      const pl = reg.planners.find(x => x.id === pid);
      if (!pl) return { ok: false, error: 'not_found' };
      if (reg.planners.some(x => x.owner === target && x.id !== pid)) return { ok: false, error: 'has_planner' };
      pl.owner = target;
      reg.shares = reg.shares.filter(x => !(x.pid === pid && x.email === target));
    });
    if (r && r.error) return r;
  }
  return adminInfo_();
}
function adminInfo_() {
  CacheService.getScriptCache().remove('reg');
  const reg = reg_(), p = props_();
  return { ok: true, admin: admin_(), members: members_(reg),
    planners: reg.planners.map(pl => ({ id: pl.id, name: pl.name, owner: pl.owner, created: pl.created, shares: reg.shares.filter(x => x.pid === pl.id).length })),
    total: { used: Number(p.getProperty(usageKey_()) || 0), limit: Number(p.getProperty('DAILY_LIMIT') || 100) },
    userLimit: Number(p.getProperty('USER_LIMIT') || 20), hasKey: !!p.getProperty('ANTHROPIC_API_KEY') };
}
/* 한 번만: 예전 권한(전체·편집) → 댓글 허용, 건희 플래너 주인 지정(Local.gs 의 GH_OWNER), 한도 기본값 */
function migrate_() {
  const p = props_();
  if (p.getProperty('MIGRATE_V') === '2') return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (p.getProperty('MIGRATE_V') === '2') return;
    CacheService.getScriptCache().remove('reg');
    const reg = reg_(), admin = admin_();
    reg.shares.forEach(x => { if (x.role === 'full' || x.role === 'edit') x.role = 'comment'; });
    const gh = typeof GH_OWNER !== 'undefined' ? normEmail_(GH_OWNER) : '';
    const pl = reg.planners.find(x => x.id === 'gh');
    if (gh && pl && !pl.owner && !reg.planners.some(x => x.owner === gh)) {
      pl.owner = gh;
      reg.shares = reg.shares.filter(x => !(x.pid === 'gh' && x.email === gh));
      const m = memberRow_(reg, gh);
      if (m.status !== ST.no) { m.status = ST.ok; m.decided = today_(); if (!m.name || m.name === gh.split('@')[0]) m.name = pl.name; }
      // 예전 앱처럼 서로 보기 + 댓글: 민석 플래너를 건희에게 댓글 허용으로 공유
      const mine = reg.planners.find(x => x.owner === admin);
      if (mine && !reg.shares.some(x => x.pid === mine.id && x.email === gh)) reg.shares.push({ pid: mine.id, email: gh, role: 'comment', by: admin, at: today_() });
    }
    saveReg_(reg);
    if (Number(p.getProperty('DAILY_LIMIT') || 0) < 100) p.setProperty('DAILY_LIMIT', '100');
    if (!p.getProperty('USER_LIMIT')) p.setProperty('USER_LIMIT', '20');
    p.setProperty('MIGRATE_V', '2');
  } finally { lock.releaseLock(); }
}

/* ---------- 로그인 · 세션 ---------- */
function login_(idToken) {
  if (!idToken) return { ok: false, error: 'login_failed' };
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'login_failed' };
  const info = JSON.parse(res.getContentText());
  const okIss = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  if (info.aud !== CLIENT_ID || !okIss || String(info.email_verified) !== 'true' || Number(info.exp) * 1000 < Date.now()) return { ok: false, error: 'login_failed' };
  const email = normEmail_(info.email), name = info.name || email.split('@')[0];
  const reg = reg_();
  let st = status_(reg, email);
  if (!reg.members.some(x => x.email === email)) { addMember_(email, name, st === ST.ok ? ST.ok : ST.wait); if (!st) st = ST.wait; }
  if (st === ST.ok) ensurePlanner_(email, name);
  return { ok: true, sess: makeSession_(email), email: email, name: info.name || '', picture: info.picture || '', status: st };
}
function secret_() { return props_().getProperty('SESSION_SECRET'); }
function b64_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
/* 세션 번호: 사람마다 하나. 올리면 그 사람의 예전 세션이 모두 무효 (모든 기기에서 로그아웃 · 이용 중지) */
function sessVer_(email) { return Number(props_().getProperty('SV_' + email) || 0); }
function bumpSess_(email) { props_().setProperty('SV_' + email, String(sessVer_(email) + 1)); }
function makeSession_(email) {
  const body = b64_(Utilities.newBlob(JSON.stringify({ e: email, x: Date.now() + SESSION_DAYS * 864e5, v: sessVer_(email) })).getBytes());
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
    if (!o.e || !(Date.now() <= Number(o.x))) return '';
    const em = normEmail_(o.e);
    if (Number(o.v || 0) !== sessVer_(em)) return '';
    return em;
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
  let reg = reg_();
  const st = status_(reg, email) || ST.wait;
  if (st !== ST.ok) return { ok: true, meta: { email: email, me: '', names: {}, planners: [], status: st }, data: {}, usage: usage_(email), sheets: {} };
  if (!reg.planners.some(x => x.owner === email)) {
    const m = reg.members.find(x => x.email === email);
    ensurePlanner_(email, (m && m.name) || email.split('@')[0]);
    reg = reg_();
  }
  const acc = reg.planners.map(pl => ({ pl: pl, role: roleOf_(reg, email, pl.id) })).filter(x => x.role);
  const mine = acc.find(x => x.role === 'owner');
  const data = {}, sheets = {};
  acc.forEach(x => {
    data[x.pl.id] = loadAll_(x.pl);
    if (x.role === 'owner' && email === admin_()) sheets[x.pl.id] = 'https://docs.google.com/spreadsheets/d/' + x.pl.sheet + '/edit';
  });
  // 댓글 쓴 사람 이름을 보여 주려고: 내가 볼 수 있는 플래너에 관련된 사람들의 플래너 이름만
  const people = {};
  acc.forEach(x => { if (x.pl.owner) people[x.pl.owner] = 1; reg.shares.filter(s => s.pid === x.pl.id).forEach(s => people[s.email] = 1); });
  people[email] = 1;
  const names = {};
  reg.planners.forEach(pl => { if (people[pl.owner] || acc.some(x => x.pl.id === pl.id)) names[pl.id] = pl.name; });
  const meta = {
    email: email, me: mine ? mine.pl.id : '', names: names, status: st,
    planners: acc.map(x => plannerMeta_(reg, x.pl, x.role))
  };
  if (email === admin_()) { meta.admin = true; meta.pending = reg.members.filter(m => status_(reg, m.email) === ST.wait).length; }
  return { ok: true, meta: meta, data: data, usage: usage_(email), sheets: sheets };
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
  if (role !== 'owner') {
    // 남의 플래너: 댓글 허용이면 댓글 표에 쓰기만. 읽기 허용이면 아무것도 못 씀
    const onlyComments = RANK[role] >= RANK.comment && ops.every(op => op.table === 'comments' && op.op === 'upsert');
    if (!onlyComments) return { ok: false, error: 'forbidden' };
  }
  if (!validOps_(ops)) return { ok: false, error: 'bad_request' };
  const pl = reg.planners.find(x => x.id === pid), mine = reg.planners.find(x => x.owner === email);
  // 댓글 작성자는 화면이 보낸 값이 아니라 로그인한 사람(의 플래너 id)으로 정함
  return batch_(pl, ops, { owner: role === 'owner', actor: mine ? mine.id : email });
}

/* 저장 요청 형식 검사: id 에 따옴표·꺾쇠 같은 글자가 들어오면 거절 (화면에 그릴 때 코드가 끼어들 수 없게) */
const SAFE_ID = /^[^\s"'<>&`=\\]{1,100}$/;
function validOps_(ops) {
  if (!Array.isArray(ops) || ops.length > 2000) return false;
  return ops.every(op => {
    if (!op || typeof op !== 'object') return false;
    if (op.op === 'check') return SAFE_ID.test(String(op.id || ''));
    if (!SCHEMA[op.table]) return false;
    if (op.op === 'remove') return ['id', 'pid', 'k'].indexOf(op.key) >= 0 && SAFE_ID.test(String(op.value || ''));
    if (op.op !== 'upsert' || op.key || !Array.isArray(op.rows)) return false; // 임의의 기준 칸(key)으로 덮어쓰기 금지
    return op.rows.every(n => {
      if (!n || typeof n !== 'object') return false;
      if (op.table === 'settings') return ['jobs', 'inds', 'auto'].indexOf(String(n.k)) >= 0;
      if (!SAFE_ID.test(String(n.id || ''))) return false;
      if (op.table !== 'posts' && !SAFE_ID.test(String(n.pid || '')) && String(n.pid || '') !== '') return false;
      return Object.keys(n).every(k => String(n[k] == null ? '' : n[k]).length <= 50000);
    });
  });
}

/* 댓글 저장: 새 댓글은 작성자·작성일을 서버가 채움. 이미 있는 댓글은 본문·작성자를 못 바꾸고
   답글은 기존 목록에 새 것만 더함(통째로 덮어쓰지 않음 → 동시에 단 답글도 안 사라짐). 해결 표시는 댓글 권한이면 가능, 읽음 표시는 주인만 */
function parseReps_(s) { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
const cut_ = (s, n) => String(s == null ? '' : s).slice(0, n);
function commentUpsert_(rows, n, ctx, postIds) {
  const id = String(n.id), today = today_();
  const newRep = r => ({ id: String(r.id), text: cut_(r.text, 5000), by: ctx.actor, at: today });
  const inRep = parseReps_(n.replies).filter(r => r && r.id && SAFE_ID.test(String(r.id)) && String(r.text || '').trim());
  const i = rows.findIndex(r => r.id === id);
  if (i < 0) {
    if (!postIds[String(n.pid)]) return;
    const qi = String(n.qi == null ? '' : n.qi);
    if (qi !== '' && !/^\d{1,3}$/.test(qi)) return;
    rows.push({ id: id, pid: String(n.pid), qi: qi, quote: cut_(n.quote, 2000), text: cut_(n.text, 5000), by: ctx.actor, at: today,
      replies: JSON.stringify(inRep.map(newRep)), resolved: '', read: ctx.owner ? 'Y' : '', ver: cut_(n.ver, 100) });
    return;
  }
  const cur = rows[i], old = parseReps_(cur.replies), have = {};
  old.forEach(r => { if (r && r.id) have[String(r.id)] = 1; });
  const add = inRep.filter(r => !have[String(r.id)]).map(newRep);
  const next = Object.assign({}, cur);
  if (add.length) { next.replies = JSON.stringify(old.concat(add)); if (!ctx.owner) next.read = ''; }
  if (n.resolved != null) next.resolved = n.resolved === 'Y' ? 'Y' : '';
  if (ctx.owner && n.read != null) next.read = n.read === 'Y' ? 'Y' : '';
  rows[i] = next;
}

/**
 * ops: [{op:'check', id, rev}, {op:'upsert', table, rows}, {op:'remove', table, key(id|pid|k), value}] — 형식은 validOps_ 가 먼저 검사
 * 표마다 한 번 읽고, 바꾼 뒤 한 번에 씀 (칸 하나씩 쓰지 않음)
 */
function batch_(pl, ops, ctx) {
  ctx = ctx || { owner: true, actor: pl.id };
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
      if (op.table === 'comments' && op.op === 'upsert') {
        const postIds = {};
        get('posts').forEach(r => { postIds[r.id] = 1; });
        (op.rows || []).forEach(n => commentUpsert_(rows, n, ctx, postIds));
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
    if (role !== 'owner' && !selfLeave) return { ok: false, error: 'forbidden' }; // 공유 설정은 주인만, 나가기는 누구나
    fn(reg);
    saveReg_(reg);
    const pl = reg.planners.find(x => x.id === pid);
    const myRole = roleOf_(reg, email, pid);
    return { ok: true, planner: myRole ? plannerMeta_(reg, pl, myRole) : null };
  } finally { lock.releaseLock(); }
}

/* ---------- 공고 자동 정리 ---------- */
function dayKey_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd'); }
function usageKey_() { return 'USAGE_' + dayKey_(); }              // 서버 전체
function userKey_(email) { return 'U_' + dayKey_() + '_' + email; } // 한 사람
function userLimit_(reg, email) {
  const m = reg.members.find(x => x.email === email), v = m ? String(m.limit || '').trim() : '';
  return /^\d+$/.test(v) ? Number(v) : Number(props_().getProperty('USER_LIMIT') || 20);
}
function usage_(email) {
  const p = props_();
  const tUsed = Number(p.getProperty(usageKey_()) || 0), tLimit = Number(p.getProperty('DAILY_LIMIT') || 100);
  return { used: Number(p.getProperty(userKey_(email)) || 0), limit: userLimit_(reg_(), email), full: tUsed >= tLimit, hasKey: !!p.getProperty('ANTHROPIC_API_KEY') };
}
/* 날이 바뀌면 지난 횟수 기록은 지움 (잠금 안에서 부름) */
function cleanDay_(p, day) {
  if (p.getProperty('USAGE_DAY') === day) return;
  const all = p.getProperties();
  Object.keys(all).forEach(k => { if ((/^USAGE_\d{8}$/.test(k) || /^[UF]_\d{8}_/.test(k)) && k.indexOf(day) < 0) p.deleteProperty(k); });
  p.setProperty('USAGE_DAY', day);
}
/* 공고 정리 1번을 Claude 호출 "전에" 잠금 안에서 미리 잡아 둠 → 동시에 여러 번 눌러도 한도를 못 넘김.
   돌려받으면 '' , 막히면 'limit' / 'limit_total'. 호출이 실패하면 refundUse_ 로 되돌림 */
function reserveUse_(email) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = props_(), day = dayKey_();
    cleanDay_(p, day);
    const used = Number(p.getProperty(userKey_(email)) || 0), tUsed = Number(p.getProperty(usageKey_()) || 0);
    if (used >= userLimit_(reg_(), email)) return { error: 'limit' };
    if (tUsed >= Number(p.getProperty('DAILY_LIMIT') || 100)) return { error: 'limit_total' };
    p.setProperty(usageKey_(), String(tUsed + 1));
    p.setProperty(userKey_(email), String(used + 1));
    return { day: day };
  } finally { lock.releaseLock(); }
}
function refundUse_(email, day) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (dayKey_() !== day) return;
    const p = props_();
    [usageKey_(), userKey_(email)].forEach(k => p.setProperty(k, String(Math.max(0, Number(p.getProperty(k) || 0) - 1))));
  } finally { lock.releaseLock(); }
}
/* 이미지 주소 가져오기: 한 사람당 하루 IMG_LIMIT(기본 100)번까지 (서버를 남의 그림 받아 오는 통로로 쓰지 못하게) */
function fetchImgFor_(email, url) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const p = props_(), day = dayKey_(), k = 'F_' + day + '_' + email, n = Number(p.getProperty(k) || 0);
    cleanDay_(p, day);
    if (n >= Number(p.getProperty('IMG_LIMIT') || 100)) return { ok: false, error: 'img_fetch', detail: 'limit' };
    p.setProperty(k, String(n + 1));
  } finally { lock.releaseLock(); }
  return fetchImg_(url);
}

function pageText_(url) {
  url = String(url || '');
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return '';
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

function extract_(input, email) {
  const key = props_().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'no_api_key' };
  const r = reserveUse_(email);
  if (r.error) return { ok: false, error: r.error, usage: usage_(email) };
  const st = { billed: false };
  try { return extractRun_(input || {}, email, key, st); }
  finally { if (!st.billed) refundUse_(email, r.day); } // Claude 를 실제로 부르지 못했으면 1번 돌려줌
}
function extractRun_(input, email, key, st) {
  const p = props_();

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
  const model = email === admin_() && ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].indexOf(input.model) >= 0 ? input.model : MODEL; // 모델 바꾸기는 관리자만
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
  st.billed = true; // 여기까지 오면 Claude 비용이 든 것 → 횟수 유지
  const msg = JSON.parse(txt);
  if (msg.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
  if (msg.stop_reason === 'max_tokens') return { ok: false, error: 'too_long' };
  const t = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  let data;
  try { data = JSON.parse(t); } catch (e) { return { ok: false, error: 'parse_error' }; }
  // 못 읽었으면 다음 단계(확인 화면)로 넘기지 않음. 회사·직무가 둘 다 비어도 못 읽은 것으로 봄
  if (data.readable === false || (!String(data.co || '').trim() && !String(data.role || '').trim() && !String(data.job || '').trim() && !(data.positions || []).length))
    return { ok: false, error: 'unreadable', detail: String(data.unreadable_reason || '').slice(0, 200), usage: usage_(email) };
  return { ok: true, data: data, usage: usage_(email) };
}
