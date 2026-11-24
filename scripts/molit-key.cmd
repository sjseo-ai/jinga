@echo off
chcp 65001 >nul
rem 국토교통부 실거래가 인증키 저장 - 직접 입력(화면에 표시 안 됨), .secrets\molit.json 에 저장(git 제외)
rem 저장 전에 매매/매매상세/전월세 세 서비스를 각각 호출해 어디까지 활용신청이 됐는지 확인합니다.
cd /d "%~dp0.."
node scripts\molit-key.mjs
pause
