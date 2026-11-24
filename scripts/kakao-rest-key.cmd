@echo off
chcp 65001 >nul
rem 카카오 REST API 키 저장 - 직접 입력(화면에 표시 안 됨), .secrets\kakao-rest.json 에 저장(git 제외)
cd /d "%~dp0.."
node scripts\kakao-rest-key.mjs
pause
