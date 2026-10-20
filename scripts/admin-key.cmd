@echo off
chcp 65001 >nul
rem 진가 구독 관리자 페이지(https://jinga-retech.vercel.app/admin)에 넣을 관리 키를 클립보드에 복사 — 화면·기록에는 남기지 않음
cd /d "%~dp0.."
node -e "const k=(require('./.secrets/jinga-mail.json')||{}).adminSecret;if(!k){process.exit(1)}process.stdout.write(k)" | clip
if errorlevel 1 (
  echo 관리 키가 없습니다 - .secrets\jinga-mail.json 을 확인하세요.
) else (
  echo 관리 키를 클립보드에 복사했습니다. 관리자 페이지 입력칸에 붙여넣으세요 [Ctrl+V].
)
