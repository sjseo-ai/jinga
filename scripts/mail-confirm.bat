@echo off
chcp 65001 >nul
rem 구독 확인 메일 — Windows 작업 스케줄러 「진가 구독 확인메일」이 10분마다 실행
cd /d "%~dp0.."
if not exist reports mkdir reports
node scripts\mail-confirmations.mjs >> reports\mail.log 2>&1
