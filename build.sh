#!/usr/bin/env bash
# src/ 조각을 합쳐 index.html 을 만든다:  bash build.sh
# 시험(가짜 서버, jsdom 필요):  node test/mock_server_test.js index.html
cd "$(dirname "$0")"
{ cat src/1_head.html; cat src/2_base.css src/3_v12.css src/4_app.css; echo "</style>"; echo "</head>"; echo "<body>"; cat src/5_body.html; echo "</body>"; echo "</html>"; } > index.html
echo "index.html 생성 완료"
