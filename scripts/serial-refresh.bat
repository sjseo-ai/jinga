@echo off
chcp 65001 >nul
rem 연재 회차 자료 최신화 — 올리는 날 아침에 그날 기준으로 다시 받아 둡니다.
rem   1) KB 지역시세(구·동 평당가)  2) KB 주차(서울)  3) 정적 페이지  4) 초안 25편  5) 초안 HTML
rem
rem 배포는 **일부러 하지 않습니다.** 숫자를 사람이 한 번 보고 결정해야 하고,
rem 사진(shot-gu.mjs)은 배포된 화면을 찍기 때문에 배포보다 먼저 찍으면 옛 숫자가 박힙니다
rem (2026-10-30 강남구에서 실제로 그렇게 나갔습니다).
rem
rem 실행 기록: reports\serial-refresh.log
cd /d "%~dp0.."
if not exist reports mkdir reports
echo ===== %date% %time% 연재 자료 최신화 시작 >> reports\serial-refresh.log
node scripts\build-kb-gu.mjs >> reports\serial-refresh.log 2>&1
node scripts\build-kb-parking.mjs seoul >> reports\serial-refresh.log 2>&1
node scripts\build-pages.mjs >> reports\serial-refresh.log 2>&1
node scripts\post-draft.mjs --all --save >> reports\serial-refresh.log 2>&1
node scripts\build-post-html.mjs >> reports\serial-refresh.log 2>&1
echo ===== %date% %time% 끝 (배포·사진은 사람이) >> reports\serial-refresh.log
