# 화면 사진 찍기 (헤드리스 크롬). 먼저 python test/preview.py 로 preview.html 을 만든 뒤:
#   python test/shot.py 이름 폭 높이 "주소뒤에붙일것"      예) python test/shot.py cal_375 375 900 "v=cal"
#   → .codex-tmp/이름.png
# 크롬 창은 최소 폭(약 500px)이 있어서, 원하는 폭의 iframe 안에 화면을 띄워 찍는다 (그래서 375px 같은 휴대폰 폭도 정확함)
import os, sys, subprocess, pathlib
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass
name, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
query = sys.argv[4] if len(sys.argv) > 4 else ''
root = pathlib.Path(__file__).resolve().parent.parent
tmp = root / '.codex-tmp'
tmp.mkdir(exist_ok=True)
if not (root / 'preview.html').exists():
    sys.exit('preview.html 이 없어요. 먼저: python test/preview.py')
frame = tmp / f'frame_{name}.html'
frame.write_text(f'<!doctype html><html><body style="margin:0;background:#888"><iframe src="../preview.html?{query}" '
                 f'style="border:0;width:{w}px;height:{h}px;display:block"></iframe></body></html>', encoding='utf-8')
chrome = os.environ.get('CHROME') or next((p for p in [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'] if os.path.exists(p)), None)
if not chrome:
    sys.exit('크롬을 찾지 못했어요. 환경변수 CHROME 에 경로를 넣어 주세요')
png = tmp / f'{name}.png'
subprocess.run([chrome, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=4000',
                f'--window-size={max(w, 520)},{h}', f'--screenshot={png}', frame.as_uri()], capture_output=True, timeout=120)
frame.unlink(missing_ok=True)
print(png if png.exists() else '사진을 만들지 못했어요')
