// 자소서 문항 시험: 글자 수 세기(공백·줄바꿈 포함, 바이트), 문항 정리 기준, + 추가(확인 단계), 여러 문항 나누기, [수정] 모드 (jsdom)
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
const fire = (A, el, x, v) => { el.value = v; el.dispatchEvent(new A.w.Event(x === 'u' ? 'change' : 'input', { bubbles: true })); };
const typeQ = (A, v) => fire(A, A.d.querySelector('.qnew textarea[data-qw="new"]:not([data-qk])'), 't', v);
const typeN = (A, k, x, v) => fire(A, A.d.querySelector(`[data-qw="new"][data-qk="${k}"][data-qx="${x}"]`), x, v);
const typeM = (A, k, x, v) => fire(A, A.d.querySelector(`[data-qm="${k}"][data-qx="${x}"]`), x, v);
const paste = (A, txt) => { A.click('.q-add-btn'); typeQ(A, txt); A.click('[data-act="qn-ok"]'); };
const repaste = (A, txt) => { A.click('[data-act="qn-back"]'); typeQ(A, txt); A.click('[data-act="qn-ok"]'); };
const prev = A => [...A.d.querySelectorAll('.qn-item')].map(x => ({ t: x.querySelector('textarea').value, n: x.querySelector('input').value, u: x.querySelector('select').value }));

(async () => { try {
  {
    const A = app(); await sleep(80); A.openP1();
    ck('count includes spaces and line breaks ("가 a⏎b" = 5)', A.d.querySelector('.q[data-qi="0"] .cnt').textContent.replace(/\s/g, '') === '5/10자');
    ck('stored question text left as is (old data not cleaned)', A.d.querySelector('.q[data-qi="0"]').textContent.includes('문항 1 (500자 이상'));
    const head = [...A.d.querySelectorAll('.blk-h')].find(x => x.textContent.includes('자소서 문항'));
    ck('header: no 제출본 count, has [수정]', !/제출본\s*\d/.test(head.textContent) && !!head.querySelector('[data-act="qm-open"]'));
    ck('no per-question buttons', !A.d.querySelector('.q [data-act^="q-"]'));
    ck('+ button under questions', !!A.d.querySelector('.q-add-btn'));
    // + → 붙여넣기 → 다음 → 빨간 확인 → 추가
    paste(A, '1. 문항 1 (500자 이상, 1000자 이하) 한화세미텍에 지원하게 된 동기와 입사 후 목표에 대해 기술해 주시기 바랍니다.');
    let P = prev(A);
    ck('red check step shown before adding', !!A.d.querySelector('.q-check') && qs(A).length === 2);
    ck('number and length notes removed, max kept', P.length === 1 && P[0].t === '한화세미텍에 지원하게 된 동기와 입사 후 목표에 대해 기술해 주시기 바랍니다.' && P[0].n === '1000' && P[0].u === '');
    A.click('[data-act="qn-add"]'); await sleep(800);
    ck('added after confirm', qs(A).length === 3 && qs(A)[2].n === '1000' && A.d.querySelector('.q[data-qi="2"]').textContent.includes('3. 한화세미텍'));
    // 같은 모양 번호가 차례로 → 나눔 (확인 칸에서 고칠 수 있음)
    paste(A, '1. 성장 과정을 적어 주세요 (최대 700자)\n2. 협업 경험 (2,000 byte)\n3. 입사 후 포부\n1000자 이내');
    P = prev(A);
    ck('consistent numbering split into 3', P.length === 3 && P[0].t === '성장 과정을 적어 주세요' && P[0].n === '700' && P[1].t === '협업 경험' && P[1].n === '2000' && P[1].u === 'byte' && P[2].t === '입사 후 포부' && P[2].n === '1000');
    typeN(A, 2, 'n', '1200');
    A.click('[data-act="qn-add"]'); await sleep(800);
    ck('fixes in check step are saved', qs(A).length === 6 && qs(A)[5].n === '1200' && qs(A)[4].u === 'byte');
    // 막 나누지 않음
    paste(A, '다음 중 하나를 골라 쓰세요.\n1) 협업 경험\n2) 실패 경험');
    ck('not split when first line has no number', prev(A).length === 1 && prev(A)[0].t.includes('1) 협업 경험'));
    repaste(A, '1. 경험을 쓰세요 (800자)\n1) 협업\n2) 실패\n2. 포부를 쓰세요 (500자)');
    P = prev(A);
    ck('sub-items with other numbering stay inside', P.length === 2 && P[0].t.includes('1) 협업') && P[0].t.includes('2) 실패') && P[0].n === '800' && P[1].n === '500');
    repaste(A, 'Q1. 성장 과정\n[문항2] 협업 경험');
    ck('mixed numbering not split', prev(A).length === 1);
    repaste(A, '1. 가나다\n3. 라마바');
    ck('skipped number not split', prev(A).length === 1);
    repaste(A, '1. 가나다\n2. 라마바');
    A.click('[data-act="qn-one"]');
    ck('"나누지 말고 하나로" works', prev(A).length === 1 && prev(A)[0].t.includes('2. 라마바'));
    ck('warns when no length found', !!A.d.querySelector('.q-warn') && !A.d.querySelector('.q-warn').hidden);
    typeN(A, 0, 'n', '500');
    ck('warning hides after typing length', A.d.querySelector('.q-warn').hidden);
    A.click('[data-act="qn-cancel"]');
    ck('cancel closes box', !A.d.querySelector('.qnew') && qs(A).length === 6);
  }
  {
    // [수정] 모드: 고치기 · 삭제(되돌리기 가능) · 완료 때 반영 · 댓글 번호 맞춤
    const A = app(); await sleep(80); A.openP1();
    A.click('[data-act="qm-open"]');
    ck('edit mode shows fields and delete at bottom', A.d.querySelectorAll('.q-mode').length === 2 && !!A.d.querySelector('.q-mode .q-foot [data-act="qm-del"]') && !A.d.querySelector('.q-add-btn'));
    typeM(A, 0, 'u', 'byte');
    typeM(A, 1, 't', '2) 두 번째 문항 고침 (800자)');
    A.click('.q-mode .q-foot [data-act="qm-del"]');
    ck('delete is marked, can undo', !!A.d.querySelector('.q-del') && qs(A).length === 2);
    A.click('.q-del [data-act="qm-del"]');
    ck('undo delete', !A.d.querySelector('.q-del'));
    A.click('[data-act="qm-done"]'); await sleep(800);
    ck('byte count ("가 a⏎b" = 6, line break 1 byte)', A.d.querySelector('.q[data-qi="0"] .cnt').textContent.replace(/\s/g, '') === '6/10바이트' && qs(A)[0].u === 'byte');
    ck('unchanged text kept as is', qs(A)[0].t.startsWith('1. 문항 1'));
    ck('edited text cleaned', qs(A)[1].t === '두 번째 문항 고침' && qs(A)[1].n === '800');
    A.click('[data-act="qm-open"]'); A.click('.q-mode .q-foot [data-act="qm-del"]'); A.click('[data-act="qm-done"]'); await sleep(800);
    const c0 = A.store.me.comments.find(c => c.id === 'c0'), c1 = A.store.me.comments.find(c => c.id === 'c1');
    ck('question deleted on 완료', qs(A).length === 1 && qs(A)[0].id === 'q2');
    ck('comments follow their question', c0.qi === '' && c1.qi === '0');
    A.click('[data-act="qm-open"]'); typeM(A, 0, 't', '바뀌면 안 됨'); A.click('[data-act="qm-cancel"]'); await sleep(600);
    ck('취소 keeps original', qs(A)[0].t === '두 번째 문항 고침' && !A.d.querySelector('.q-mode'));
    // 새로 불러와 화면이 다시 그려져도 입력 중이던 값이 남음
    A.click('.q-add-btn'); typeQ(A, '쓰던 문항'); if (A.d.activeElement && A.d.activeElement.blur) A.d.activeElement.blur();
    await A.refresh();
    ck('typing survives background refresh', (A.d.querySelector('.qnew textarea') || {}).value === '쓰던 문항');
    ck('no script errors', A.errs.length === 0);
  }
  {
    // 공유받은(댓글 허용) 플래너에선 + · 수정 없음
    const st = mkStore(); st.gh = st.me; st.me = T();
    const meta = { email: 'me@example.com', me: 'me', status: '승인', names: { me: '민석', gh: '건희' },
      planners: [{ id: 'me', name: '민석', owner: 'me@example.com', role: 'owner', shares: [] }, { id: 'gh', name: '건희', owner: 'gh@example.com', role: 'comment', shares: [] }] };
    const A = app({ store: st, meta }); await sleep(80);
    A.click('#profBtn'); A.click('[data-act="view"][data-v="gh"]'); await sleep(20);
    A.openP1();
    ck('shared planner: no add / edit for questions', !A.d.querySelector('.q-add-btn') && !A.d.querySelector('[data-act="qm-open"]') && !!A.d.querySelector('.q'));
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
