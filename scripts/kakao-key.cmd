@echo off
chcp 65001 >nul
rem 카카오맵 JavaScript 키 저장 - 직접 입력(화면에 표시 안 됨), .secrets\kakao.json 에 저장(git 제외) + site\public\map-key.json 내보내기
cd /d "%~dp0.."
node scripts\kakao-key.mjs
pause
