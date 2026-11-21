// 시험 공용: index.html 을 jsdom 에 띄우고 가짜 서버(메모리 시트)를 붙임
const { JSDOM } = require('jsdom');
const copy = x => JSON.parse(JSON.stringify(x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = () => ({ posts: [], qs: [], events: [], tasks: [], comments: [], hist: [], settings: [] });
function app(html, opt) {
  opt = opt || {};
  const DEFAULT = (html.match(/const DEFAULT_SERVER='([^']+)'/) || [])[1];
  const store = opt.store, calls = [];
  let down = false;
  const meta = opt.meta || { email: 'me@example.com', me: 'me', status: '승인', names: { me: '민석', gh: '건희' },
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
  const openCo = co => { click('.nav-btn[data-v="board"]'); const c = [...d.querySelectorAll('.card')].find(x => x.textContent.includes(co)); click(c); };
  const openP1 = () => openCo(opt.co || '보안회사');
  const setF = (sel, v) => { const el = d.querySelector(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  return { w, d, store, calls, errs, click, lsDump, refresh, openP1, openCo, setF, setDown: v => { down = v; } };
}
module.exports = { app, sleep, copy, T };
