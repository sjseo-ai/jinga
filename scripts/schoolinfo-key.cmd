@echo off
chcp 65001 >nul
rem 학교알리미 Open API 인증키 저장 - 직접 입력(화면에 표시 안 됨), .secrets\schoolinfo.json 에 저장(git 제외)
cd /d "%~dp0.."
node scripts\schoolinfo-key.mjs
pause
