@echo off
chcp 65001 >nul
rem 소상공인 상가(상권)정보 인증키 저장 - 직접 입력(화면에 표시 안 됨), .secrets\sangga.json 에 저장(git 제외)
cd /d "%~dp0.."
node scripts\sangga-key.mjs
pause
