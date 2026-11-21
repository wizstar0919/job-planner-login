// 로그인 시험판 시험: 가짜 서버(Code.gs 권한 규칙 흉내) + 가짜 구글 로그인
// 실행: node test/mock_server_test.js index.html   (jsdom 필요)
const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const T=()=>({posts:[],qs:[],events:[],tasks:[],comments:[],hist:[],settings:[]});
const store={me:T(),gh:T(),p3:T(),p4:T()};
store.p3.posts.push({id:'x3',co:'댓글전용회사',job:'제품영업',stage:'작성중',dueKind:'미확인',steps:'서류',cur:'0',rev:'r1',link:'javascript:alert(1)',relLink:'https://example.com/ok'});
const TODAY=new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
store.gh.posts.push({id:'g1',co:'건희회사',job:'제품영업',stage:'작성중',dueKind:'확정',due:TODAY+'T18:00',steps:'서류',cur:'0',rev:'r1'});
store.p3.qs.push({id:'q3',pid:'x3',i:'0',t:'지원 동기',n:'500',a:'저는 이 회사가 좋습니다.',st:'초안'});
store.p4.posts.push({id:'x4',co:'읽기전용회사',job:'제품영업',stage:'관심',dueKind:'미확인',steps:'서류',cur:'0',rev:'r1'});
const ME='minseok@gmail.com';
const reg={planners:[{id:'me',name:'민석',owner:ME},{id:'gh',name:'건희',owner:''},{id:'p3',name:'철수',owner:'cs@gmail.com'},{id:'p4',name:'영희',owner:'yh@gmail.com'}],
  shares:[{pid:'gh',email:ME,role:'comment'},{pid:'p3',email:ME,role:'comment'},{pid:'p4',email:ME,role:'read'}]};
const RANK={read:1,comment:2,edit:3,full:4,owner:5};
const roleOf=(e,pid)=>{const p=reg.planners.find(x=>x.id===pid);if(!p)return '';if(p.owner===e)return 'owner';const s=reg.shares.find(x=>x.pid===pid&&x.email===e);return s?s.role:''};
const NEW='new@gmail.com',SESS={S1:ME,S2:NEW};
const members=[{email:ME,name:'강민석',status:'승인',joined:'2026-11-21'}];
const stOf=e=>{if(e===ME)return '승인';const m=members.find(x=>x.email===e);if(m&&m.status==='거절')return '거절';if((m&&m.status==='승인')||reg.planners.some(p=>p.owner===e)||reg.shares.some(s=>s.email===e))return '승인';return m?'대기':''};
const memList=()=>members.map(m=>Object.assign({},m,{status:stOf(m.email),admin:m.email===ME}));
const meta=e=>({email:e,status:'승인',admin:e===ME||undefined,pending:e===ME?memList().filter(m=>m.status==='대기').length:undefined,me:(reg.planners.find(p=>p.owner===e)||{}).id||'',names:Object.fromEntries(reg.planners.map(p=>[p.id,p.name])),
  planners:reg.planners.filter(p=>roleOf(e,p.id)).map(p=>pm(e,p))});
const pm=(e,p)=>({id:p.id,name:p.name,owner:p.owner,role:roleOf(e,p.id),shares:reg.shares.filter(s=>s.pid===p.id).map(s=>({email:s.email,role:s.role,name:''}))});
const str=o=>{const r={};for(const k in o)r[k]=o[k]==null?'':String(o[k]);return r};
let calls=[],denied=0;
function server(body){const b=JSON.parse(body);calls.push(b.action);
 if(b.action==='login'){if(b.idToken==='google-new'){if(!members.some(m=>m.email===NEW))members.push({email:NEW,name:'새사람',status:'대기',joined:'2026-11-21'});return {ok:true,sess:'S2',email:NEW,status:stOf(NEW)}}
   if(b.idToken!=='google-ok')return {ok:false,error:'login_failed'};return {ok:true,sess:'S1',email:ME,name:'강민석'}}
 const e=SESS[b.sess];if(!e)return {ok:false,error:'auth'};
 const info=()=>({ok:true,admin:ME,members:memList().map(m=>Object.assign({used:0,limit:20,custom:m.custom||''},m)),planners:reg.planners.map(p=>({id:p.id,name:p.name,owner:p.owner,created:'',shares:reg.shares.filter(s=>s.pid===p.id).length})),total:{used:0,limit:100},userLimit:20,hasKey:true});
 if(['adminInfo','approve','setLimit','setDefaults','setOwner'].includes(b.action)){if(e!==ME){denied++;return {ok:false,error:'forbidden'}}
   if(b.action==='approve'){const m=members.find(x=>x.email===b.email);m.status=b.status}
   if(b.action==='setLimit'){const m=members.find(x=>x.email===b.email);m.custom=b.limit}
   if(b.action==='setOwner'){reg.planners.find(p=>p.id===b.pid).owner=b.email}
   return info()}
 if(stOf(e)!=='승인'){if(b.action==='loadAll')return {ok:true,meta:{email:e,me:'',names:{},planners:[],status:stOf(e)},data:{},usage:{used:0,limit:30,hasKey:true},sheets:{}};denied++;return {ok:false,error:'forbidden'}}
 if(!reg.planners.some(p=>p.owner===e)){reg.planners.push({id:'p5',name:'새사람',owner:e});store.p5=T()}
 if(b.action==='loadAll'){const m=meta(e);const data={};m.planners.forEach(p=>data[p.id]=JSON.parse(JSON.stringify(store[p.id])));return {ok:true,meta:m,data,usage:{used:0,limit:30,hasKey:true},sheets:{me:'https://docs.google.com/x'}}}
 if(b.action==='batch'){const r=roleOf(e,b.pid);if(!r){denied++;return {ok:false,error:'forbidden'}}
   if(r!=='owner'&&!(RANK[r]>=2&&b.ops.every(o=>o.table==='comments'&&o.op==='upsert'))){denied++;return {ok:false,error:'forbidden'}}
   const S=store[b.pid];b.ops.forEach(op=>{if(op.op==='check')return;let rows=S[op.table];
   if(op.op==='upsert'){const key=op.table==='settings'?'k':'id';op.rows.forEach(n=>{n=str(n);const i=rows.findIndex(r=>r[key]===n[key]);if(i>=0)rows[i]=Object.assign({},rows[i],n);else rows.push(n)})}
   else if(op.op==='remove')S[op.table]=rows.filter(r=>r[op.key]!==String(op.value))});return {ok:true,conflicts:[],revs:{}}}
 if(b.action==='share'){if(roleOf(e,b.pid)!=='owner')return {ok:false,error:'forbidden'};b.emails.forEach(x=>{const s=reg.shares.find(y=>y.pid===b.pid&&y.email===x);if(s)s.role=b.role;else reg.shares.push({pid:b.pid,email:x,role:b.role})});return {ok:true,planner:pm(e,reg.planners.find(p=>p.id===b.pid))}}
 if(b.action==='setRole'){const self=b.email===e&&b.role==='remove';if(roleOf(e,b.pid)!=='owner'&&!self)return {ok:false,error:'forbidden'};const i=reg.shares.findIndex(y=>y.pid===b.pid&&y.email===b.email);
   if(b.role==='remove')reg.shares.splice(i,1);else reg.shares[i].role=b.role;const r=roleOf(e,b.pid);return {ok:true,planner:r?pm(e,reg.planners.find(p=>p.id===b.pid)):null}}
 if(b.action==='extract')return {ok:true,usage:{used:1,limit:30,hasKey:true},data:{co:'테스트전자',job:'제품영업',role:'B2B 영업',type:'정규직',ind:'기타',loc:'서울',applyStart:'',dueKind:'확정',due:'2026-12-01T18:00',steps:['서류','면접'],events:[{d:'2026-12-10',k:'int',t:'1차 면접'}],qs:[{t:'지원 동기를 쓰시오.',n:800}],memo:'정규직 · 서울',positions:[]}};
 return {ok:false,error:'unknown'}}
let gcb=null;
function makeDom(ls){const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://wizstar0919.github.io/job-planner-login/#s=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2FX%2Fexec'});
 const w=dom.window;w.fetch=async(url,opt)=>({json:async()=>server(opt.body)});
 w.google={accounts:{id:{initialize(o){gcb=o.callback},renderButton(el){el.innerHTML='<button id="fakeG">Google 로그인</button>'},disableAutoSelect(){}}}};
 if(ls)Object.keys(ls).forEach(k=>w.localStorage.setItem(k,ls[k]));
 return dom}
let dom=makeDom();let w=dom.window,d=w.document;const errs=[];
const runScripts=()=>{w.addEventListener('error',e=>errs.push(e.message));const s=[...d.querySelectorAll('script')].map(x=>x.textContent).join('\n');w.eval(s)};
runScripts();
const click=s=>{const el=typeof s==='string'?d.querySelector(s):s;if(!el)throw new Error('missing '+s);el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const log=[];const ck=(n,c)=>log.push((c?'OK ':'FAIL ')+n);
const openCard=co=>{click('.nav-btn[data-v="board"]');const c=[...d.querySelectorAll('.card')].find(x=>x.textContent.includes(co));if(!c)throw new Error('no card '+co);click(c)};
(async()=>{try{
 ck('login screen with google button',!!d.querySelector('.start')&&!!d.querySelector('#fakeG')&&!d.querySelector('#pwIn'));
 await gcb({credential:'bad'});await sleep(30);ck('bad login shows error',d.querySelector('#pwMsg').textContent.includes('구글 로그인'));
 await gcb({credential:'google-ok'});await sleep(30);
 ck('entered my planner',d.querySelector('#profName').textContent==='민석'&&!d.querySelector('.start'));
 ck('share button visible on mine',!d.querySelector('#shareBtn').hidden);
 ck('no 👀 peek button on my planner',d.querySelector('#peekBtn').hidden);
 // 내 플래너에 공고 추가
 click('.side [data-act="add"]');
 {const el=d.querySelector('#aLink');el.value='javascript:alert(1)';el.dispatchEvent(new w.Event('input',{bubbles:true}));
  ck('bad url → small red warning',!d.querySelector('.bad-url[data-bad="aLink"]').hidden);
  const n=calls.length;click('[data-act="extract"]');await sleep(30);
  ck('bad url → extract not sent',calls.length===n&&d.querySelector('.dlg').textContent.includes('잘못된 주소'));}
 d.querySelector('#aLink').value='https://example.com/job';d.querySelector('#aLink').dispatchEvent(new w.Event('input',{bubbles:true}));
 ck('good url → warning hidden',d.querySelector('.bad-url[data-bad="aLink"]').hidden);
 click('[data-act="extract"]');await sleep(50);
 click('[data-act="form-save"]');await sleep(800);
 ck('saved to my planner (me)',store.me.posts.length===1&&store.me.posts[0].co==='테스트전자');
 // 달력 같이 보기: 계정 메뉴에서 건희 체크 → 내 달력에 건희 일정이 흐리게
 click('#profBtn');ck('menu lists 4 planners',d.querySelectorAll('.menu-list [data-act="view"]').length===4);
 ck('overlay checkbox per shared planner',d.querySelectorAll('.menu-list [data-ch="ovl"]').length===3);
 ck('no calendar overlay before checking',!d.querySelector('#main .ev.p'));
 {const cb=d.querySelector('[data-ch="ovl"][data-v="gh"]');cb.checked=true;cb.dispatchEvent(new w.Event('change',{bubbles:true}))}
 click('[data-act="dlg-close"]');click('.nav-btn[data-v="cal"]');
 ck('calendar color by event kind (due)',[...d.querySelectorAll('#main .ev.p')].some(x=>x.classList.contains('st-due'))&&d.querySelector('#main .legend').textContent.includes('서류 마감'));
 ck('gh events overlaid on my calendar',[...d.querySelectorAll('#main .ev.p')].some(x=>(x.title||'').includes('건희'))&&!d.querySelector('#main [data-ch="overlay"]'));
 // 건희 플래너 (댓글 허용) → 공고 추가·수정 불가
 click('#profBtn');click('[data-act="view"][data-v="gh"]');await sleep(10);
 ck('gh read-only for me (no add button)',d.querySelector('#app').classList.contains('ro')&&!d.querySelector('.side [data-act="add"]')&&d.querySelector('#main').textContent.includes('댓글'));
 ck('top shows 내 플래너로 when away',!d.querySelector('#peekBtn').hidden&&d.querySelector('#peekBtn').textContent==='내 플래너로');
 openCard('건희회사');ck('gh: no edit button',!d.querySelector('[data-act="edit"]'));click('[data-act="close"]');
 // 철수 플래너 (댓글 허용) → 수정 불가, 댓글 가능
 click('#profBtn');click('[data-act="view"][data-v="p3"]');
 ck('p3 is read-only view',d.querySelector('#app').classList.contains('ro')&&d.querySelector('#shareBtn').hidden);
 openCard('댓글전용회사');ck('no edit button',!d.querySelector('[data-act="edit"]'));
 ck('javascript: link not clickable',!d.querySelector('a[href^="javascript"]')&&d.querySelector('.sheet').textContent.includes('javascript:alert(1)'));
 ck('https link still opens',!!d.querySelector('.sheet a[href="https://example.com/ok"]'));ck('comment box present',!!d.querySelector('#pcTxt'));
 d.querySelector('#pcTxt').value='좋아요';click('[data-act="add-pc"]');await sleep(800);
 ck('comment saved to p3 by me',store.p3.comments.length===1&&store.p3.comments[0].by==='me');
 click('[data-act="close"]');
 // 영희 플래너 (읽기 허용) → 댓글도 불가
 click('#profBtn');click('[data-act="view"][data-v="p4"]');openCard('읽기전용회사');
 ck('read role: no comment box, no selbar',!d.querySelector('#pcTxt')&&!d.querySelector('#selbar'));
 click('[data-act="close"]');
 ck('no forbidden writes so far',denied===0);
 // 공유 창: 내 플래너를 건희에게 편집 허용으로
 click('#peekBtn');ck('peek from shared → back to mine',d.querySelector('#main').textContent.includes('민석의'));
 click('#shareBtn');ck('share dialog has owner row',d.querySelector('.dlg').textContent.includes('주인'));
 ck('only 댓글/읽기 roles offered',[...d.querySelectorAll('#shRole option')].map(o=>o.value).join()==='comment,read');
 d.querySelector('#shEm').value='gh@gmail.com, friend@gmail.com';d.querySelector('#shRole').value='comment';click('[data-act="sh-add"]');await sleep(50);
 ck('shared 2 people as comment',reg.shares.filter(s=>s.pid==='me').length===2&&reg.shares.every(s=>s.pid!=='me'||s.role==='comment'));
 ck('rows shown in dialog',d.querySelectorAll('.dlg .sh-row').length>=4);
 click('[data-act="sh-menu"][data-em="friend@gmail.com"]');ck('role menu open',!!d.querySelector('.sh-menu'));
 click('.sh-menu [data-v="read"]');await sleep(50);ck('changed to read',reg.shares.find(s=>s.email==='friend@gmail.com').role==='read');
 click('[data-act="sh-menu"][data-em="friend@gmail.com"]');click('.sh-menu [data-v="remove"]');await sleep(50);ck('removed',!reg.shares.some(s=>s.email==='friend@gmail.com'));
 click('[data-act="dlg-close"]');
 // 읽기 플래너에서 나가기
 click('#profBtn');click('[data-act="view"][data-v="p4"]');click('#profBtn');
 ck('no share button for read role in menu',!d.querySelector('.dlg [data-act="share"]'));
 click('[data-act="dlg-close"]');
 // 새 창: 세션·캐시로 바로 입장
 const ls={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);ls[k]=w.localStorage.getItem(k)}
 ck('uses jpl_ storage (not jp_)',Object.keys(ls).every(k=>!k.startsWith('jp_')||k==='jp_theme'));
 dom=makeDom(ls);w=dom.window;d=w.document;runScripts();await sleep(50);
 ck('reopen enters directly',!d.querySelector('.start')&&d.querySelector('#profName').textContent==='민석');
 // 로그아웃
 click('#profBtn');click('[data-act="logout"]');ck('logout → login screen',!!d.querySelector('.start')&&!!d.querySelector('#fakeG'));
 // 세션 만료: 서버가 auth 를 돌려주면 로그인 화면으로
 dom=makeDom(Object.assign({},ls,{jpl_cfg:JSON.stringify(Object.assign(JSON.parse(ls.jpl_cfg),{sess:'expired'}))}));w=dom.window;d=w.document;runScripts();await sleep(80);
 ck('expired session → login screen',!!d.querySelector('.start')&&d.querySelector('#pwMsg').textContent.includes('만료'));
 // 가입 승인: 새 사람이 로그인 → 대기 화면 → 관리자가 승인 → 다시 확인 → 자기 플래너
 const deniedBefore=denied;
 dom=makeDom();w=dom.window;d=w.document;runScripts();await sleep(30);
 await gcb({credential:'google-new'});await sleep(50);
 ck('new user → waiting screen',!!d.querySelector('.start [data-act="recheck"]')&&d.querySelector('.start').textContent.includes('가입 신청'));
 click('[data-act="recheck"]');await sleep(50);ck('still waiting after recheck',!!d.querySelector('[data-act="recheck"]'));
 const nd=dom;
 dom=makeDom();w=dom.window;d=w.document;runScripts();await sleep(30);await gcb({credential:'google-ok'});await sleep(50);
 click('#profBtn');{const a=d.querySelector('.dlg a[href="admin.html"]');ck('admin sees 관리자 콘솔 button with 1 pending',!!a&&a.textContent.includes('1명'))}
 ck('no member admin inside app',!d.querySelector('[data-act="members"]')&&!d.querySelector('[data-act="mem-set"]'));
 // 관리자 콘솔 (admin.html): 같은 로그인으로 바로 열림 → 승인
 const als={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);als[k]=w.localStorage.getItem(k)}
 {const ah=fs.readFileSync(require('path').join(require('path').dirname(process.argv[2]),'admin.html'),'utf8');
  const adom=new JSDOM(ah,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://wizstar0919.github.io/job-planner-login/admin.html'});const aw=adom.window,ad=aw.document;
  aw.fetch=async(url,opt)=>({json:async()=>server(opt.body)});Object.keys(als).forEach(k=>aw.localStorage.setItem(k,als[k]));aw.addEventListener('error',e=>errs.push('admin: '+e.message));
  aw.eval([...ad.querySelectorAll('script')].map(x=>x.textContent).join('\n'));await sleep(50);
  ck('console lists members with 대기',ad.body.textContent.includes(NEW)&&ad.body.textContent.includes('승인 대기 1명'));
  ck('console shows no planner contents',!ad.body.textContent.includes('댓글전용회사')&&!ad.body.textContent.includes('건희회사'));
  ad.querySelector(`[data-act="approve"][data-em="${NEW}"][data-v="승인"]`).dispatchEvent(new aw.MouseEvent('click',{bubbles:true}));await sleep(50);
  ck('approved from console',stOf(NEW)==='승인'&&ad.body.textContent.includes('이용 중지'));
  const lim=[...ad.querySelectorAll('[data-lim]')].find(x=>x.dataset.lim===NEW);lim.value='5';lim.dispatchEvent(new aw.Event('change',{bubbles:true}));await sleep(50);
  ck('per-person limit saved',members.find(m=>m.email===NEW).custom==='5');
  // 관리자가 아닌 사람이 콘솔을 열면 막힘
  const bdom=new JSDOM(ah,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://wizstar0919.github.io/job-planner-login/admin.html'});const bw=bdom.window;
  bw.fetch=async(url,opt)=>({json:async()=>server(opt.body)});bw.localStorage.setItem('jpl_cfg',JSON.stringify({server:'x',sess:'S2',email:NEW}));
  const dn=denied;bw.eval([...bw.document.querySelectorAll('script')].map(x=>x.textContent).join('\n'));await sleep(50);
  ck('non-admin blocked from console',bw.document.body.textContent.includes('관리자만')&&denied===dn+1);denied=dn}
 w=nd.window;d=w.document;click('[data-act="recheck"]');await sleep(80);
 ck('new user enters own planner after approval',!d.querySelector('.start')&&d.querySelector('#profName').textContent==='새사람');
 ck('new user cannot see others',w.document.querySelectorAll('#peekBtn:not([hidden])').length===0&&!w.document.querySelector('a[href="admin.html"]'));
 members.find(m=>m.email===NEW).status='거절';
 const nls={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);nls[k]=w.localStorage.getItem(k)}
 dom=makeDom(nls);w=dom.window;d=w.document;runScripts();await sleep(80);
 ck('rejected user → blocked screen',!!d.querySelector('.start')&&d.querySelector('.start').textContent.includes('승인을 받지 못했어요'));
 ck('no forbidden writes in approval flow',denied===deniedBefore);
}catch(e){errs.push('TEST '+e.stack)}
 console.log(log.join('\n'));console.log('calls:',calls.join(','));console.log('ERRORS:',errs.length?errs:'none');process.exit(0)})();
