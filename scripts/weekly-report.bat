@echo off
chcp 65001 >nul
rem 진가 주간 작업 — 1) KB 지역시세 집계  2) 주간 보고서  3) Vercel 재배포(로그인돼 있을 때만)  4) 구독자에게 보고서 메일
rem 결과: reports\YYYY-MM-DD\주간보고서.html, reports\latest.html · 실행 기록: reports\weekly-report.log
cd /d "%~dp0.."
if not exist reports mkdir reports
echo ===== %date% %time% >> reports\weekly-report.log
node scripts\build-kb-gu.mjs >> reports\weekly-report.log 2>&1
node scripts\weekly-report.mjs >> reports\weekly-report.log 2>&1
node scripts\deploy-vercel.mjs >> reports\weekly-report.log 2>&1
node scripts\send-weekly-mail.mjs >> reports\weekly-report.log 2>&1
