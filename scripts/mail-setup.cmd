@echo off
chcp 65001 >nul
rem 진가 주간 보고서 메일 발송 설정 — 보내는 메일(Gmail 또는 네이버)과 비밀번호 입력(비밀번호는 이 PC의 .secrets 폴더에만 저장)
cd /d "%~dp0.."
if not exist node_modules\nodemailer call npm install --no-audit --no-fund
node scripts\mail-setup.mjs
pause
