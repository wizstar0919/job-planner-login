// 자소서 문항 시험: 글자 수 세기(공백·줄바꿈 포함, 바이트), 문항 정리 기준, + 추가, 여러 문항 붙여넣기, 수정·빼기 (jsdom)
//   node test/questions_test.js [index.html]   → 줄마다 OK/FAIL, 맨 끝에 ERRORS
const fs = require('fs'), path = require('path'), H = require('./harness');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8');
const { sleep, T } = H;
const log = [], ck = (n, c) => log.push((c ? 'OK ' : 'FAIL ') + n);

function mkStore() {
  const t = T();
  t.posts.push({ id: 'p1', co: '문항회사', job: '제품영업', role: '영업', stage: '관심', dueKind: '미확인', steps: '서류 > 면접', cur: '0', memo: '', rev: 'r1', created: '2026-11-01' });
  t.qs.push({ id: 'q1', pid: 'p1', i: '0', t: '1. 문항 1 (500자 이상, 1000자 이하) 예전에 저장된 문항', n: '10', a: '가 a\nb', st: '초안', ver: '' });
  t.qs.push({ id: 'q2', pid: 'p1', i: '1', t: '두 번째 문항', n: '0', a: '', st: '미작성', ver: '' });
  t.comments.push({ id: 'c1', pid: 'p1', qi: '1', quote: '', text: '둘째 문항 댓글', by: 'gh', at: '2026-11-20', replies: '[]', resolved: '', read: 'Y', ver: '' });
  t.comments.push({ id: 'c0', pid: 'p1', qi: '0', quote: '', text: '첫째 문항 댓글', by: 'gh', at: '2026-11-20', replies: '[]', resolved: '', read: 'Y', ver: '' });
  t.posts.push({ id: 'g1', co: '남의회사', stage: '관심', dueKind: '미확인', steps: '서류', cur: '0', rev: 'r1' });
  return { me: t };
}
const app = opt => H.app(html, Object.assign({ store: mkStore(), co: '문항회사' }, opt));
const qs = A => A.store.me.qs.filter(q => q.pid === 'p1').sort((a, b) => +a.i - +b.i);
const typeQ = (A, w, k, v) => { const el = A.d.querySelector(`[data-qw="${w}"][data-qx="${k}"]`); el.value = v; el.dispatchEvent(new A.w.Event(k === 'u' ? 'change' : 'input', { bubbles: true })); };

(async () => { try {
  {
    const A = app(); await sleep(80); A.openP1();
    const cnt = A.d.querySelector('.q[data-qi="0"] .cnt').textContent;
    ck('count includes spaces and line breaks ("가 a⏎b" = 5)', cnt.replace(/\s/g, '') === '5/10자');
    ck('stored question text left as is (old data not cleaned)', A.d.querySelector('.q[data-qi="0"]').textContent.includes('문항 1 (500자 이상'));
    ck('+ button under questions', !!A.d.querySelector('.q-add-btn'));
    // + 로 한 문항 추가 (번호·글자 수 표시가 붙은 원문)
    A.click('.q-add-btn');
    ck('+ opens new question box', !!A.d.querySelector('.qnew textarea'));
    typeQ(A, 'new', 't', '1. 문항 1 (500자 이상, 1000자 이하) 한화세미텍에 지원하게 된 동기와 입사 후 목표에 대해 기술해 주시기 바랍니다.');
    A.click('[data-act="qn-ok"]'); await sleep(800);
    let q = qs(A)[2];
    ck('number and length notes removed, max kept', q && q.t === '한화세미텍에 지원하게 된 동기와 입사 후 목표에 대해 기술해 주시기 바랍니다.' && q.n === '1000' && q.u === '');
    ck('new question shown with 3.', A.d.querySelector('.q[data-qi="2"]').textContent.includes('3. 한화세미텍'));
    // 여러 문항 한 번에 붙여넣기 → 나눈 결과 확인 → 나눠 추가
    A.click('.q-add-btn');
    typeQ(A, 'new', 't', 'Q1. 성장 과정을 적어 주세요 (최대 700자)\n[문항2] 협업 경험 (2,000 byte)\n② 입사 후 포부\n1000자 이내');
    A.click('[data-act="qn-ok"]');
    const items = [...A.d.querySelectorAll('.qnew .li')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
    ck('paste split preview shows 3', items.length === 3 && /성장 과정을 적어 주세요/.test(items[0]) && /700자/.test(items[0]) && /2,000바이트/.test(items[1]) && /1,000자/.test(items[2]));
    A.click('[data-act="qn-many"]'); await sleep(800);
    const L = qs(A);
    ck('split questions saved', L.length === 6 && L[3].t === '성장 과정을 적어 주세요' && L[3].n === '700' && L[4].t === '협업 경험' && L[4].n === '2000' && L[4].u === 'byte' && L[5].t === '입사 후 포부' && L[5].n === '1000');
    // 바이트 세기: 한글 2 · 영문/공백 1 · 줄바꿈 2
    A.click('.q[data-qi="0"] [data-act="q-ed"]');
    typeQ(A, 'ed', 'u', 'byte'); A.click('[data-act="qe-ok"]'); await sleep(800);
    ck('byte count ("가 a⏎b" = 7)', A.d.querySelector('.q[data-qi="0"] .cnt').textContent.replace(/\s/g, '') === '7/10바이트' && qs(A)[0].u === 'byte');
    ck('editing only the unit keeps old text as is', qs(A)[0].t.startsWith('1. 문항 1'));
    // 문항 수정 → 글을 고치면 정리 기준 적용
    A.click('.q[data-qi="1"] [data-act="q-ed"]');
    typeQ(A, 'ed', 't', '2) 두 번째 문항 고침 (800자)'); A.click('[data-act="qe-ok"]'); await sleep(800);
    ck('edited question cleaned', qs(A)[1].t === '두 번째 문항 고침' && qs(A)[1].n === '800');
    // 빼기 → 확인 → 뺀 문항 댓글은 공고 댓글로, 뒤 문항 댓글은 번호가 당겨짐
    A.click('.q[data-qi="0"] [data-act="q-rm"]');
    ck('remove asks first', !!A.d.querySelector('.q-rm') && qs(A).length === 6);
    A.click('[data-act="q-rm-ok"]'); await sleep(800);
    const c0 = A.store.me.comments.find(c => c.id === 'c0'), c1 = A.store.me.comments.find(c => c.id === 'c1');
    ck('question removed', qs(A).length === 5 && qs(A)[0].id === 'q2');
    ck('comments follow their question', c0.qi === '' && c1.qi === '0');
    // 새로 불러와 화면이 다시 그려져도 입력 중이던 새 문항이 남아 있음
    A.click('.q-add-btn'); typeQ(A, 'new', 't', '쓰던 문항'); A.d.activeElement && A.d.activeElement.blur && A.d.activeElement.blur();
    await A.refresh();
    ck('typing survives background refresh', (A.d.querySelector('.qnew textarea') || {}).value === '쓰던 문항');
    ck('no script errors', A.errs.length === 0);
  }
  {
    // 공유받은(댓글 허용) 플래너에선 + · 수정 · 빼기 없음
    const st = mkStore(); st.gh = st.me; delete st.me;
    st.gh.posts.forEach(p => { p.co = p.co; });
    const meta = { email: 'me@example.com', me: 'me', status: '승인', names: { me: '민석', gh: '건희' },
      planners: [{ id: 'me', name: '민석', owner: 'me@example.com', role: 'owner', shares: [] }, { id: 'gh', name: '건희', owner: 'gh@example.com', role: 'comment', shares: [] }] };
    st.me = T();
    const A = app({ store: st, meta }); await sleep(80);
    A.click('#profBtn'); A.click('[data-act="view"][data-v="gh"]'); await sleep(20);
    A.openP1();
    ck('shared planner: no add/edit/remove for questions', !A.d.querySelector('.q-add-btn') && !A.d.querySelector('[data-act="q-ed"]') && !A.d.querySelector('[data-act="q-rm"]') && !!A.d.querySelector('.q'));
  }
  {
    // 정보 수정 화면: 글자 수 실시간도 같은 기준
    const A = app(); await sleep(80); A.openP1(); A.click('[data-act="edit"]');
    A.setF('.sheet [data-q="0"][data-qf="a"]', 'ab c\n\nd');
    ck('edit screen counter same rule (7)', A.d.querySelector('[data-cnt="0"]').textContent.replace(/\s/g, '') === '7/10자');
  }
} catch (e) { log.push('FAIL exception ' + (e && e.stack || e)); }
  const fail = log.filter(l => l.startsWith('FAIL'));
  console.log(log.join('\n'));
  console.log('ERRORS: ' + (fail.length ? fail.length + ' failed' : 'none'));
  process.exit(fail.length ? 1 : 0);
})();
