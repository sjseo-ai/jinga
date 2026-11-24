@echo off
chcp 65001 >nul
rem 진가 주간 작업 — 1) KB 지역시세 집계  2) 주간 보고서  3) Vercel 재배포(로그인돼 있을 때만)  4) 구독자에게 보고서 메일
rem 결과: reports\YYYY-MM-DD\주간보고서.html, reports\latest.html · 실행 기록: reports\weekly-report.log
cd /d "%~dp0.."
if not exist reports mkdir reports
echo ===== %date% %time% >> reports\weekly-report.log
rem 2026-11-19 — 주 1회 서울 전체(3,145개 단지) KB 집계를 여기서 돌리지 않습니다.
rem 보고서는 구독 조건에 해당하는 자치구만 직접 조회하도록 이미 되어 있습니다(weekly-report.mjs 주석 8행).
rem 매주 수천 건을 긁어 쌓아 두는 것이 KB 약관 제14조 제1항 제5호가 말하는 무단 수집에 가장 가깝습니다.
rem node scripts\build-kb-gu.mjs >> reports\weekly-report.log 2>&1
node scripts\weekly-report.mjs >> reports\weekly-report.log 2>&1
node scripts\deploy-vercel.mjs >> reports\weekly-report.log 2>&1
node scripts\send-weekly-mail.mjs >> reports\weekly-report.log 2>&1
