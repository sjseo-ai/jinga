@echo off
chcp 65001 >nul
rem 진가 관리자 페이지 비밀번호 정하기 - 직접 입력(화면에 표시 안 됨), 서버에는 해시만 저장
cd /d "%~dp0.."
node scripts\admin-password.mjs
pause
