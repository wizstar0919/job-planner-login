// 서버(server/Code.gs) 진짜 코드를 가짜 구글 환경(시트·속성·잠금·네트워크)에서 돌려 보는 시험
//   node test/server_test.js      → 줄마다 OK/FAIL, 맨 끝에 ERRORS
// 실제 Apps Script 와 다른 점: 시트·잠금·네트워크가 메모리 속 가짜. 진짜 동시 실행 대신 "호출 도중에 또 호출"로 겹침을 흉내 냄
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const src = fs.readFileSync(process.env.CODE_GS || path.join(__dirname, '..', 'server', 'Code.gs'), 'utf8'); // CODE_GS: 다른 버전 시험용
const copy = x => JSON.parse(JSON.stringify(x));
const log = [], ck = (n, c) => log.push((c ? 'OK ' : 'FAIL ') + n);
const OWNER = 'owner@example.com', CM = 'commenter@example.com', RD = 'reader@example.com', ADMIN = 'admin@example.com';

function boot(opt) {
  opt = opt || {};
  const props = Object.assign({ ADMIN_EMAIL: ADMIN, SESSION_SECRET: 'test-secret', USER_LIMIT: '20', DAILY_LIMIT: '100', ANTHROPIC_API_KEY: 'fake', MIGRATE_V: '2', REG_SHEET: 'x' }, opt.props || {});
  const reg = { planners: [{ id: 'P_OWN', name: '주인', owner: OWNER, sheet: 's1' }, { id: 'P_CM', name: '댓글러', owner: CM, sheet: 's2' }],
    shares: [{ pid: 'P_OWN', email: CM, role: 'comment' }, { pid: 'P_OWN', email: RD, role: 'read' }],
    members: [{ email: CM, status: '승인', limit: '' }, { email: RD, status: '승인', limit: '' }, { email: OWNER, status: '승인', limit: '' }] };
  const tables = { posts: [{ id: 'p1', co: '원래 회사', rev: 'r1' }],
    comments: [{ id: 'c1', pid: 'p1', qi: '', text: '주인이 쓴 글', by: 'P_OWN', at: '2026-11-20', replies: '[]', resolved: '', read: 'Y', ver: '' }],
    qs: [], events: [], tasks: [], hist: [], settings: [] };
  const fetches = [];
  let onFetch = opt.onFetch || (() => ({ code: 500, text: '{}' }));
  const P = { getProperty: k => props[k] == null ? null : props[k], setProperty: (k, v) => { props[k] = String(v); },
    getProperties: () => Object.assign({}, props), deleteProperty: k => { delete props[k]; } };
  const ctx = vm.createContext({ console, Date, JSON, Math,
    PropertiesService: { getScriptProperties: () => P },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return JSON.parse(s); } }), MimeType: { JSON: 'json' } },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, z, f) => f === 'yyyyMMdd' ? '20261122' : '2026-11-22',
      base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'),
      base64DecodeWebSafe: s => [...Buffer.from(s, 'base64url')],
      base64Encode: b => Buffer.from(b).toString('base64'),
      computeHmacSha256Signature: (body, key) => [...crypto.createHmac('sha256', key).update(body).digest()],
      newBlob: v => ({ getBytes: () => [...Buffer.from(Array.isArray(v) ? Buffer.from(v) : String(v))], getDataAsString: () => Buffer.from(v).toString('utf8') })
    },
    UrlFetchApp: { fetch(url, o) { fetches.push(url); const r = onFetch(url, o); return { getResponseCode: () => r.code, getContentText: () => r.text,
      getBlob: () => ({ getBytes: () => [0x89, 0x50, 1, 2], getContentType: () => 'image/png' }) }; } }
  });
  vm.runInContext(src, ctx, { filename: 'Code.gs' });
  ctx.ensureInit_ = () => ({}); ctx.migrate_ = () => {};
  ctx.reg_ = () => copy(reg);
  ctx.saveReg_ = r => { Object.assign(reg, copy(r)); };
  ctx.editReg_ = fn => { const r = copy(reg); const x = fn(r); Object.assign(reg, r); return x; };
  ctx.book_ = () => ({});
  ctx.readTable_ = (b, t) => copy(tables[t]);
  ctx.writeTable_ = (b, t, rows) => { tables[t] = copy(rows); };
  const call = (email, body, sess) => ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ sess: sess || ctx.makeSession_(email) }, body)) } });
  return { ctx, props, reg, tables, fetches, call, setFetch: f => { onFetch = f; } };
}
const cmt = (o) => ({ op: 'upsert', table: 'comments', rows: [o] });

/* ---------- 댓글 권한 ---------- */
{
  const S = boot();
  let r = S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'c1', pid: 'p1', text: '바꿔치기', by: 'P_OWN', replies: '[]' })] });
  const c1 = S.tables.comments.find(c => c.id === 'c1');
  ck('commenter cannot change others comment text', r.ok && c1.text === '주인이 쓴 글' && c1.by === 'P_OWN');
  r = S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'c2', pid: 'p1', qi: '', text: '새 댓글', by: 'P_OWN', at: '1999-01-01', resolved: 'Y', read: 'Y', replies: '[]' })] });
  const c2 = S.tables.comments.find(c => c.id === 'c2');
  ck('new comment author forced to commenter', r.ok && c2 && c2.by === 'P_CM' && c2.at === '2026-11-22' && c2.read === '' && c2.resolved === '');
  // 답글 두 개를 서로 모르는 상태(오래된 목록)로 차례로 저장 → 둘 다 남아야 함
  S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'c1', replies: JSON.stringify([{ id: 'r1', text: '첫 답글', by: 'P_OWN' }]) })] });
  S.call(OWNER, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'c1', replies: JSON.stringify([{ id: 'r2', text: '둘째 답글' }]), read: 'Y' })] });
  let reps = JSON.parse(S.tables.comments.find(c => c.id === 'c1').replies);
  ck('stale reply lists do not drop replies', reps.map(x => x.id).join() === 'r1,r2');
  ck('reply author forced (no impersonation)', reps[0].by === 'P_CM' && reps[1].by === 'P_OWN');
  S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'c1', replies: JSON.stringify([{ id: 'r1', text: '답글 내용 바꿔치기' }]) })] });
  reps = JSON.parse(S.tables.comments.find(c => c.id === 'c1').replies);
  ck('existing reply cannot be replaced', reps[0].text === '첫 답글' && reps.length === 2);
  S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'c1', read: 'Y', resolved: 'Y' })] });
  const c1b = S.tables.comments.find(c => c.id === 'c1');
  ck('commenter can resolve but not mark read', c1b.resolved === 'Y' && c1b.read === 'Y');
  S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'c1', replies: JSON.stringify([{ id: 'r3', text: '셋째' }]) })] });
  ck('commenter reply marks comment unread for owner', S.tables.comments.find(c => c.id === 'c1').read === '');
  r = S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'c9', pid: 'nope', text: 'x', replies: '[]' })] });
  ck('comment on missing post ignored', r.ok && !S.tables.comments.some(c => c.id === 'c9'));
  r = S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [{ op: 'upsert', table: 'comments', key: 'pid', rows: [{ id: 'z', pid: 'p1', text: 'x' }] }] });
  ck('custom match key rejected', !r.ok && (r.error === 'forbidden' || r.error === 'bad_request'));
  r = S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [{ op: 'upsert', table: 'posts', rows: [{ id: 'p1', co: '해킹' }] }] });
  ck('commenter cannot edit posts', !r.ok && r.error === 'forbidden' && S.tables.posts[0].co === '원래 회사');
  r = S.call(RD, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'c5', pid: 'p1', text: 'x', replies: '[]' })] });
  ck('reader cannot comment', !r.ok && r.error === 'forbidden');
  r = S.call(CM, { action: 'batch', pid: 'P_OWN', ops: [cmt({ id: 'x" onmouseover="alert(1)', pid: 'p1', text: 'x', replies: '[]' })] });
  ck('id with quotes rejected', !r.ok && r.error === 'bad_request' && !S.tables.comments.some(c => /onmouseover/.test(c.id)));
  r = S.call(OWNER, { action: 'batch', pid: 'P_OWN', ops: [{ op: 'upsert', table: 'events', rows: [{ id: 'e<img>', pid: 'p1', d: '2026-11-30', k: 'int', t: '면접' }] }] });
  ck('owner write with bad id rejected', !r.ok && r.error === 'bad_request');
  r = S.call(OWNER, { action: 'batch', pid: 'P_OWN', ops: [{ op: 'check', id: 'p1', rev: 'r1', unit: 'p:p1' }, { op: 'upsert', table: 'posts', rows: [{ id: 'p1', co: '고친 회사' }], unit: 'p:p1' },
    { op: 'upsert', table: 'events', rows: [{ id: 'e1', pid: 'p1', d: '2026-11-30', k: 'int', t: '면접' }], unit: 'p:p1' }] });
  ck('normal owner save still works', r.ok && S.tables.posts[0].co === '고친 회사' && S.tables.events.length === 1);
  r = S.call(OWNER, { action: 'batch', pid: 'P_OWN', ops: [{ op: 'replace', table: 'events', key: 'pid', value: 'p1', rows: [] }] });
  ck('unknown op replace rejected', !r.ok && r.error === 'bad_request' && S.tables.events.length === 1);
}

/* ---------- 공고 정리 한도: 호출 전에 잡아 둠 ---------- */
{
  const okBody = JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ readable: true, co: '회사', role: '영업', job: '', positions: [] }) }] });
  let inner = null, api = 0, started = false;
  const S = boot({ props: { USER_LIMIT: '1', DAILY_LIMIT: '1' } });
  S.setFetch(url => {
    if (/anthropic/.test(url)) { api++; if (!started) started = true, inner = S.ctx.extract_({ text: '공고' }, OWNER); return { code: 200, text: okBody }; }
    return { code: 404, text: '' };
  });
  const first = S.ctx.extract_({ text: '공고' }, OWNER);
  ck('overlapping extract blocked by reserved count', first.ok && inner && !inner.ok && inner.error === 'limit' && api === 1);
  ck('count recorded once', S.props['U_20261122_' + OWNER] === '1' && S.props['USAGE_20261122'] === '1');

  const S2 = boot({ props: { USER_LIMIT: '5' } });
  S2.setFetch(() => ({ code: 500, text: 'err' }));
  const bad = S2.ctx.extract_({ text: '공고' }, OWNER);
  ck('failed API call refunds the count', !bad.ok && bad.error === 'api_error' && S2.props['U_20261122_' + OWNER] === '0');
  S2.setFetch(() => ({ code: 404, text: '' }));
  const cap = S2.ctx.extract_({ url: 'https://example.com/x' }, OWNER);
  ck('need_capture (no API call) refunds', cap.error === 'need_capture' && S2.props['U_20261122_' + OWNER] === '0');

  const S3 = boot({ props: { USER_LIMIT: '5' } });
  let model = '';
  S3.setFetch((url, o) => { if (/anthropic/.test(url)) model = JSON.parse(o.payload).model; return { code: 200, text: okBody }; });
  S3.ctx.extract_({ text: '공고', model: 'claude-opus-5-5' }, OWNER);
  ck('non-admin cannot pick model', model === 'claude-haiku-5-5');
  S3.ctx.extract_({ text: '공고', model: 'claude-opus-5-5' }, ADMIN);
  ck('admin can pick model', model === 'claude-opus-5-5');

  const S4 = boot({ props: { IMG_LIMIT: '2' } });
  S4.setFetch(() => ({ code: 200, text: '' }));
  const a = [1, 2, 3].map(() => S4.call(OWNER, { action: 'fetchImg', url: 'https://example.com/a.png' }));
  ck('image fetch has daily limit', a[0].ok && a[1].ok && !a[2].ok && a[2].detail === 'limit' && S4.fetches.length === 2);
  const S5 = boot();
  ck('page fetch rejects non-http url', S5.ctx.pageText_('file:///etc/passwd') === '' && S5.fetches.length === 0);
}

/* ---------- 세션 ---------- */
{
  const S = boot();
  const old = S.ctx.makeSession_(OWNER);
  ck('valid session accepted', S.ctx.checkSession_(old) === OWNER);
  const legacy = (() => { const body = Buffer.from(JSON.stringify({ e: OWNER, x: Date.now() + 1e6 })).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', 'test-secret').update(body).digest('base64url'); })();
  ck('older session without number still valid', S.ctx.checkSession_(legacy) === OWNER);
  const expired = (() => { const body = Buffer.from(JSON.stringify({ e: OWNER, x: Date.now() - 1000 })).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', 'test-secret').update(body).digest('base64url'); })();
  ck('expired session rejected', S.ctx.checkSession_(expired) === '');
  ck('tampered session rejected', S.ctx.checkSession_(old.slice(0, -2) + 'xx') === '');
  const r = S.call(OWNER, { action: 'logoutAll' }, old);
  ck('logoutAll ok', r.ok);
  ck('old sessions dead after logoutAll', S.ctx.checkSession_(old) === '' && S.ctx.checkSession_(legacy) === '' && S.call(OWNER, { action: 'loadAll' }, old).error === 'auth');
  ck('new login session works', S.ctx.checkSession_(S.ctx.makeSession_(OWNER)) === OWNER);
  const cmSess = S.ctx.makeSession_(CM);
  S.call(ADMIN, { action: 'approve', email: CM, status: '거절' });
  ck('reject cuts that user sessions', S.ctx.checkSession_(cmSess) === '');
}

let fail = log.filter(l => l.startsWith('FAIL'));
console.log(log.join('\n'));
console.log('ERRORS: ' + (fail.length ? fail.length + ' failed' : 'none'));
process.exitCode = fail.length ? 1 : 0;
