// 화면(index.html) 보안·데이터 시험: 가짜 서버로 앱을 띄워 공격·충돌 상황을 흉내 냄 (jsdom)
//   node test/security_test.js [index.html]   → 줄마다 OK/FAIL, 맨 끝에 ERRORS
const { JSDOM } = require('jsdom'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8');
const DEFAULT = (html.match(/const DEFAULT_SERVER='([^']+)'/) || [])[1];
const copy = x => JSON.parse(JSON.stringify(x));
const log = [], ck = (n, c) => log.push((c ? 'OK ' : 'FAIL ') + n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = () => ({ posts: [], qs: [], events: [], tasks: [], comments: [], hist: [], settings: [] });
const EVIL = '<img src=x onerror=bad>';

function mkStore(evil) {
  const t = T();
  t.posts.push({ id: 'p1', co: '보안회사', job: '제품영업', role: '영업', stage: '작성중', dueKind: '확정', due: evil ? '2026-12-01T<b>x' : '2026-12-01T18:00', steps: '서류 > 면접', cur: '0', memo: '처음 메모', rev: 'r1', created: '2026-11-01' });
  t.qs.push({ id: 'q1', pid: 'p1', i: '0', t: '지원 동기', n: '500', a: '처음 답변입니다', st: evil ? EVIL : '초안', ver: '1차 제출본' });
  t.events.push({ id: 'e1', pid: 'p1', d: '2026-11-25', k: evil ? '"><img src=x onerror=bad>' : 'int', t: '면접' });
  t.hist.push({ id: 'h1', pid: 'p1', d: evil ? EVIL : '2026-11-01', t: '등록' });
  t.comments.push({ id: evil ? 'x" onmouseover="bad' : 'c1', pid: 'p1', qi: '', quote: '', text: '첫 댓글', by: 'gh', at: evil ? EVIL : '2026-11-20', replies: '[]', resolved: '', read: '', ver: '' });
  return { me: t };
}
function app(opt) {
  opt = opt || {};
  const store = opt.store || mkStore(opt.evil), calls = [];
  let down = false;
  const meta = { email: 'me@example.com', me: 'me', status: '승인', names: { me: '민석', gh: '건희' },
    planners: [{ id: 'me', name: '민석', owner: 'me@example.com', role: 'owner', shares: [] }] };
  const server = (url, b) => {
    calls.push({ url, action: b.action, body: b });
    if (down && b.action === 'batch') throw new Error('offline');
    if (b.action === 'loadAll') return { ok: true, meta: copy(meta), data: copy(store), usage: { used: 0, limit: 20, hasKey: true }, sheets: {} };
    if (b.action === 'logoutAll') return { ok: true };
    if (b.action === 'batch') {
      const S = store[b.pid], conflicts = [], revs = {};
      b.ops.forEach(o => { if (o.op === 'check') { const c = S.posts.find(r => r.id === o.id); if ((c ? c.rev : '') !== o.rev) conflicts.push(o.unit); } });
      b.ops.forEach(o => {
        if (o.op === 'check' || conflicts.includes(o.unit)) return;
        if (o.op === 'upsert') o.rows.forEach(n => { n = Object.fromEntries(Object.entries(n).map(([k, v]) => [k, String(v)]));
          if (o.table === 'posts') { n.rev = 'r' + Math.random().toString(36).slice(2, 6); revs[n.id] = n.rev; }
          const rows = S[o.table], k = o.table === 'settings' ? 'k' : 'id', i = rows.findIndex(r => r[k] === n[k]); if (i >= 0) rows[i] = Object.assign({}, rows[i], n); else rows.push(n); });
        if (o.op === 'remove') S[o.table] = S[o.table].filter(r => r[o.key] !== o.value);
      });
      return { ok: true, conflicts, revs };
    }
    return { ok: false, error: 'unknown' };
  };
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://wizstar0919.github.io/job-planner-login/' + (opt.hash || '') });
  const w = dom.window, d = w.document;
  w.fetch = async (url, o) => { const r = server(url, JSON.parse(o.body)); return { json: async () => copy(r) }; };
  w.google = { accounts: { id: { initialize() {}, renderButton() {}, disableAutoSelect() {} } } };
  const ls = opt.ls || { jpl_cfg: JSON.stringify({ server: opt.server || DEFAULT, sess: 'S1', email: 'me@example.com' }) };
  Object.keys(ls).forEach(k => w.localStorage.setItem(k, ls[k]));
  const errs = [];
  w.addEventListener('error', e => errs.push(e.message));
  w.eval([...d.querySelectorAll('script')].map(x => x.textContent).join('\n'));
  const click = s => { const el = typeof s === 'string' ? d.querySelector(s) : s; if (!el) throw new Error('missing ' + s); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  const lsDump = () => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
  const refresh = async () => { d.dispatchEvent(new w.Event('visibilitychange')); await sleep(60); };
  const openP1 = () => { click('.nav-btn[data-v="board"]'); const c = [...d.querySelectorAll('.card')].find(x => x.textContent.includes('보안회사')); click(c); };
  const setF = (sel, v) => { const el = d.querySelector(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  return { w, d, store, calls, errs, click, lsDump, refresh, openP1, setF, setDown: v => { down = v; } };
}
const injected = d => [...d.querySelectorAll('*')].filter(el => [...el.attributes].some(a => /^on/i.test(a.name)) || (el.tagName === 'IMG' && el.getAttribute('src') === 'x') || (el.tagName === 'B' && el.textContent === 'x'));

(async () => { try {
  /* 1. 서버 주소 고정 */
  {
    const A = app({ hash: '#s=https%3A%2F%2Fevil.example%2Fsteal', server: 'https://evil.example/old' });
    await sleep(80);
    A.click('[data-act="settings"]');
    ck('session only sent to the fixed server', A.calls.length > 0 && A.calls.every(c => c.url === DEFAULT));
    ck('stored evil server overwritten', JSON.parse(A.lsDump().jpl_cfg).server === DEFAULT);
  }
  /* 2. 시트에 코드가 섞여 있어도 화면에서 글자로만 */
  {
    const A = app({ evil: true });
    await sleep(80);
    const views = ['home', 'cal', 'board', 'list'];
    let bad = [];
    for (const v of views) { A.click('.nav-btn[data-v="' + v + '"]'); bad = bad.concat(injected(A.d).map(e => v + ':' + e.outerHTML.slice(0, 60))); }
    A.openP1(); bad = bad.concat(injected(A.d).map(e => 'detail:' + e.outerHTML.slice(0, 60)));
    ck('no injected html/handlers from sheet data', bad.length === 0);
    if (bad.length) console.log(bad.slice(0, 5));
    ck('comment still shown', A.d.querySelector('.sheet').textContent.includes('첫 댓글'));
    ck('no script errors', A.errs.length === 0);
    /* 답글에 id 가 붙어 서버가 합칠 수 있게 */
    A.click('.sheet [data-act="reply"]'); A.d.querySelector('#rTxt').value = '답글입니다'; A.click('[data-act="reply-ok"]');
    await sleep(800);
    const reps = JSON.parse(A.store.me.comments[A.store.me.comments.length - 1].replies); // 이상한 id 는 화면에서 바뀌어 새 줄로 감
    ck('reply sent with its own id', reps.length === 1 && /^[a-z0-9]{6,}$/.test(reps[0].id) && reps[0].text === '답글입니다');
  }
  /* 3. 편집 중 다른 기기에서 바뀐 칸은 지키고, 같은 칸이 겹치면 알림 */
  {
    const A = app();
    await sleep(80);
    A.openP1(); A.click('[data-act="edit"]'); await sleep(700); // 상세를 열면 읽음 표시 저장이 먼저 나감 → 끝난 뒤
    A.store.me.posts[0].memo = '다른 기기 메모'; A.store.me.posts[0].rev = 'r2';
    await A.refresh();
    A.setF('.sheet [data-f="co"]', '보안회사2');
    A.click('[data-act="ed-save"]'); await sleep(800);
    const p = A.store.me.posts[0];
    ck('my field saved, other device field kept', p.co === '보안회사2' && p.memo === '다른 기기 메모');
    A.openP1(); A.click('[data-act="edit"]');
    A.store.me.posts[0].memo = '다른 기기 메모 B'; A.store.me.posts[0].rev = 'r9';
    await A.refresh();
    A.setF('.sheet [data-f="memo"]', '내 메모 C');
    A.click('[data-act="ed-save"]'); await sleep(300);
    ck('same field clash → warned, not overwritten', A.store.me.posts[0].memo === '다른 기기 메모 B' && /다른 기기에서 비고/.test(A.d.querySelector('.toast').textContent) && !!A.d.querySelector('.sheet [data-f="memo"]'));
    ck('draft kept after warning', A.d.querySelector('.sheet [data-f="memo"]').value === '내 메모 C');
    A.click('[data-act="ed-save"]'); await sleep(800);
    ck('second save applies mine', A.store.me.posts[0].memo === '내 메모 C' && A.store.me.posts[0].co === '보안회사2');
    /* 문항 버전 유지 */
    A.openP1(); A.click('[data-act="edit"]');
    A.setF('.sheet [data-q="0"][data-qf="a"]', '고친 답변입니다');
    A.click('[data-act="ed-save"]'); await sleep(800);
    const q = A.store.me.qs[0];
    ck('question version kept after edit', q.a === '고친 답변입니다' && q.ver === '1차 제출본');
  }
  /* 4. 저장 실패 → 기기에 남김 → 다시 열면 마저 보냄 */
  {
    const A = app();
    await sleep(80);
    A.setDown(true);
    A.openP1(); A.click('[data-act="edit"]'); A.setF('.sheet [data-f="memo"]', '오프라인 메모');
    A.click('[data-act="ed-save"]'); await sleep(800);
    const ls = A.lsDump();
    ck('failed save kept on device', !!ls.jpl_pend && ls.jpl_pend.includes('오프라인 메모') && A.store.me.posts[0].memo === '처음 메모');
    ck('offline cache shows my edit', (ls.jpl_cache || '').includes('오프라인 메모'));
    const B = app({ store: A.store, ls });
    await sleep(300);
    ck('pending edit sent on next open', B.store.me.posts[0].memo === '오프라인 메모' && !B.lsDump().jpl_pend);
    ck('screen shows saved edit', B.calls.some(c => c.action === 'batch') && B.calls.filter(c => c.action === 'loadAll').length >= 1);
    /* 다른 기기에서 그사이 고쳤으면 남은 수정은 덮어쓰지 않음 */
    const C = app(); await sleep(80);
    C.setDown(true); C.openP1(); C.click('[data-act="edit"]'); C.setF('.sheet [data-f="memo"]', '늦은 메모'); C.click('[data-act="ed-save"]'); await sleep(800);
    C.store.me.posts[0].memo = '다른 기기가 먼저'; C.store.me.posts[0].rev = 'rX';
    const D = app({ store: C.store, ls: C.lsDump() }); await sleep(300);
    ck('stale pending edit does not overwrite newer data', D.store.me.posts[0].memo === '다른 기기가 먼저' && !D.lsDump().jpl_pend);
  }
  /* 5. 모든 기기에서 로그아웃 */
  {
    const A = app(); await sleep(80);
    A.click('[data-act="settings"]');
    const b = A.d.querySelector('[data-act="logout-all"]');
    A.click(b); ck('logout-all asks once more', !A.calls.some(c => c.action === 'logoutAll'));
    A.click(A.d.querySelector('[data-act="logout-all"]')); await sleep(50);
    ck('logout-all calls server and logs out here', A.calls.some(c => c.action === 'logoutAll') && JSON.parse(A.lsDump().jpl_cfg).sess === '' && !!A.d.querySelector('.start'));
  }
} catch (e) { log.push('FAIL exception ' + (e && e.stack || e)); }
  const fail = log.filter(l => l.startsWith('FAIL'));
  console.log(log.join('\n'));
  console.log('ERRORS: ' + (fail.length ? fail.length + ' failed' : 'none'));
  process.exit(fail.length ? 1 : 0); // 앱의 주기 새로고침 타이머가 남아 있어서 직접 끝냄
})();
