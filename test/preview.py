# 화면 미리보기: index.html 에 가짜 서버·가짜 데이터를 끼워 넣은 preview.html 을 만든다 (서버·구글 접속 없음)
#   python test/preview.py                 → preview.html (저장소 맨 위, .gitignore 대상)
#   브라우저 주소 뒤에 붙일 수 있는 것 (여러 개는 & 로):
#     v=home|cal|board|list|rec   화면      m=list|month|week  달력 보기 방식
#     open=1 첫 공고 상세 열기 (open=p1 처럼 공고 id 도 됨)    add=1 공고 추가 창    menu=1 계정 메뉴    set=1 설정 창    light=1 / dark=1 밝은·어두운 화면
#     who=gh  공유받은 플래너(댓글 허용) 보기
#     do=선택자~선택자::값  차례로 누르기·값 넣기 (값 안의 ¶ 는 줄바꿈)   예) do=.q-add-btn~.qnew textarea::1. 지원 동기 (700자)~[data-act="qn-ok"]
import sys
import json, datetime, random, os
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
random.seed(3)
today = datetime.date.today()
d = lambda n: (today + datetime.timedelta(days=n)).isoformat()
cos = ['한국투자증권', '삼성전자', 'LG에너지솔루션', '카카오뱅크', 'KB국민은행', '신한카드', '현대자동차', 'SK하이닉스', '네이버', '미래에셋증권',
       'NH투자증권', '하나은행', '롯데쇼핑', 'CJ제일제당', '포스코', '한화생명', '우리은행', 'KT', '쿠팡', '토스뱅크']
jobs = ['제품영업', '리테일 영업', '기업금융', '해외영업', 'B2B 영업']
stages = ['관심', '작성중', '제출', '인적성', '면접1', '종료']
posts, events, tasks, qs, comments = [], [], [], [], []
for i, co in enumerate(cos):
    st = stages[i % len(stages)]
    dk = '미확인' if i in (0, 12) else '확정'
    due = d(random.randint(-10, 20)) + 'T18:00'
    posts.append({'id': f'p{i}', 'co': co, 'job': jobs[i % 5], 'role': jobs[i % 5] + ' 신입', 'type': '정규직', 'ind': '금융', 'loc': '서울',
                  'link': 'https://example.com/' + str(i), 'relLink': '', 'applyStart': '', 'dueKind': dk, 'due': due if dk == '확정' else '',
                  'recheck': '', 'stage': st, 'result': '서류 탈락' if st == '종료' else '', 'failAt': '',
                  'submitted': d(-3) if st in ('제출', '인적성', '면접1') else '', 'steps': '서류 > 인적성 > 면접', 'cur': '0', 'memo': '',
                  'src': '', 'created': d(-20), 'updated': d(-1), 'short': '', 'rev': 'r1'})
    if st in ('인적성', '면접1', '제출'):
        k = {'인적성': 'apt', '면접1': 'int', '제출': 'ann'}[st]
        events.append({'id': f'e{i}', 'pid': f'p{i}', 'd': d(random.randint(0, 14)), 'k': k,
                       't': {'apt': '인적성 검사', 'int': '1차 면접 14:00', 'ann': '서류 발표'}[k]})
    if st == '작성중':
        qs.append({'id': f'q{i}', 'pid': f'p{i}', 'i': '0', 't': '지원 동기를 적어 주세요', 'n': '700', 'a': '저는 이 회사의 영업 방식에 관심이 있습니다.', 'st': '초안', 'lock': '', 'ver': ''})
        tasks.append({'id': f't{i}', 'pid': f'p{i}', 't': '1번 문항 작성', 'due': d(0), 'done': '', 'doneAt': '', 'auto': 'Y'})
for k, n in ((1, 1), (6, 2), (13, 3)):
    posts[k].update(stage='작성중', dueKind='확정', due=d(n) + 'T18:00')
events.append({'id': 'esub', 'pid': 'p2', 'd': d(2), 'k': 'sub', 't': '서류 제출'})
tasks.append({'id': 'tg', 'pid': '', 't': '이력서 사진 바꾸기', 'due': d(0), 'done': '', 'doneAt': '', 'auto': ''})
comments.append({'id': 'c1', 'pid': 'p1', 'qi': '0', 'quote': '영업 방식', 'text': '조금 더 구체적으로', 'by': 'gh', 'at': d(-1), 'replies': '[]', 'resolved': '', 'read': '', 'ver': ''})
me = {'posts': posts, 'qs': qs, 'events': events, 'tasks': tasks, 'comments': comments, 'hist': [], 'settings': []}
gh = {'posts': [dict(p, id='g' + p['id'], co=p['co'] + ' (건희)') for p in posts[:6]], 'qs': [], 'events': [], 'tasks': [], 'comments': [], 'hist': [], 'settings': []}
meta = {'email': 'me@example.com', 'me': 'me', 'status': '승인', 'admin': True, 'pending': 1, 'names': {'me': '민석', 'gh': '건희'},
        'planners': [{'id': 'me', 'name': '민석', 'owner': 'me@example.com', 'role': 'owner', 'shares': [{'email': 'gh@example.com', 'role': 'comment', 'name': '건희'}]},
                     {'id': 'gh', 'name': '건희', 'owner': 'gh@example.com', 'role': 'comment', 'shares': [{'email': 'me@example.com', 'role': 'comment', 'name': '민석'}]}]}
load = {'ok': True, 'meta': meta, 'data': {'me': me, 'gh': gh}, 'usage': {'used': 2, 'limit': 20, 'hasKey': True}, 'sheets': {}}
inj = """<script>
(function(){var q=new URLSearchParams(location.search);
localStorage.setItem('jpl_cfg',JSON.stringify({server:'https://example.invalid',sess:'S1',email:'me@example.com'}));
localStorage.removeItem('jpl_cache');
if(q.get('light'))localStorage.setItem('jp_theme','"light"');else if(q.get('dark'))localStorage.setItem('jp_theme','"dark"');else localStorage.removeItem('jp_theme');
var LOAD=%s;
window.fetch=async function(u,o){var b=JSON.parse(o.body);return {json:async function(){return b.action==='loadAll'?JSON.parse(JSON.stringify(LOAD)):{ok:true,conflicts:[],revs:{}}}}};
window.google={accounts:{id:{initialize:function(){},renderButton:function(){},disableAutoSelect:function(){}}}};
addEventListener('load',function(){setTimeout(function(){
  var c=function(s){var e=document.querySelector(s);if(e)e.click()};
  if(q.get('who')){c('#profBtn');c('[data-act="view"][data-v="'+q.get('who')+'"]')}
  if(q.get('v'))c('[data-act="nav"][data-v="'+q.get('v')+'"]');
  if(q.get('m'))c('[data-act="cal-mode"][data-v="'+q.get('m')+'"]');
  if(q.get('open'))c(q.get('open')==='1'?'[data-act="open"]':'[data-act="open"][data-id="'+q.get('open')+'"]');
  if(q.get('add'))c('[data-act="add"]');
  if(q.get('menu'))c('#profBtn');
  if(q.get('set'))c('[data-act="settings"]');
  /* do=선택자1~선택자2::값~... : 차례로 누르거나(:: 없으면) 값 넣기(:: 있으면). 값 안의 ¶ 는 줄바꿈 */
  (q.get('do')||'').split('~').filter(Boolean).forEach(function(x){var i=x.indexOf('::');if(i<0){c(x);return}var el=document.querySelector(x.slice(0,i));if(el){el.value=x.slice(i+2).split('¶').join(String.fromCharCode(10));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}});
},400)});
})();
</script>""" % json.dumps(load, ensure_ascii=False)
h = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
h = h.replace('<head>', '<head>' + inj, 1)
h = h.replace('<link rel="stylesheet" href="https://fonts.googleapis.com', '<link rel="x" href="https://fonts.googleapis.com')  # 글꼴도 인터넷에서 받지 않음
out = os.path.join(root, 'preview.html')
open(out, 'w', encoding='utf-8').write(h)
print('preview.html 생성:', out)
