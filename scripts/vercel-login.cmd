@echo off
chcp 65001 >nul
rem Vercel 로그인 도우미 — 이 PC 이름("서신준PC")이 한글이라 그냥 "vercel login" 하면
rem "Cannot convert argument to a ByteString" 오류가 나서, 컴퓨터 이름을 영문으로 바꾸는 패치를 먼저 불러온 뒤 로그인합니다.
rem 사용: VS Code 터미널에서  .\scripts\vercel-login.cmd
cd /d "%~dp0.."
set "PATCH=%~dp0ascii-hostname.cjs"
set "PATCH=%PATCH:\=/%"
set "NODE_OPTIONS=--require "%PATCH%""
if /i "%~1"=="check" (
  node -e "console.log(require(\"os\").hostname())"
  exit /b
)
echo === 진가 Vercel 로그인 ===
echo 화살표 키로 로그인 방법을 고르고 Enter 를 누르세요.
call npx --yes vercel@latest login
echo.
echo === 로그인 확인 ===
call npx --yes vercel@latest whoami
