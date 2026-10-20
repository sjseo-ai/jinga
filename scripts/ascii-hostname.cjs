// Vercel CLI는 로그인·토큰 갱신 요청의 User-Agent 헤더에 컴퓨터 이름(os.hostname())을 넣습니다.
// 이 PC 이름("서신준PC")처럼 한글이 들어 있으면 HTTP 헤더에 넣을 수 없어
// "Cannot convert argument to a ByteString ... value of 49436" 오류로 로그인이 실패합니다.
// NODE_OPTIONS=--require 로 이 파일을 먼저 불러오면, 그 Node 프로세스 안에서만 컴퓨터 이름을 영문으로 바꿔 줍니다.
// (Windows의 실제 PC 이름은 바뀌지 않습니다. 이름을 바꾸고 싶으면 JINGA_ASCII_HOSTNAME 환경변수로 지정)
const os = require('os');
const { syncBuiltinESMExports } = require('module');

if (/[^\x20-\x7e]/.test(os.hostname())) {
  const ascii = process.env.JINGA_ASCII_HOSTNAME || 'JINGA-PC';
  os.hostname = () => ascii;
  syncBuiltinESMExports();   // import { hostname } from 'os' 로 가져간 곳에도 반영
}
