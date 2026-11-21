# 구직 플래너 — 로그인 시험판 (job-planner-login)

지금 쓰는 구직 플래너(job-planner)의 사본. 구글 로그인과 노션식 공유 권한을 붙여 시험하는 용도.

- 로그인: 구글 계정 (Google Identity Services). 서버가 구글 확인증을 검사한 뒤 30일 세션 발급
- 권한: 주인 / 전체 허용(편집·댓글·공유) / 편집 허용 / 댓글 허용 / 읽기 허용 — 모든 요청에서 서버가 확인
- `index.html` — 앱 화면 (GitHub Pages). `src/` 조각을 `bash build.sh` 로 합쳐 만듦
- `server/` — Google Apps Script 서버 (데이터는 플래너마다 구글 시트, 공고 자동 정리는 Claude API)

비밀 값(API 키, 세션 서명 값, 시트 id)은 이 저장소에 없다. 서버의 스크립트 속성에만 있다.
