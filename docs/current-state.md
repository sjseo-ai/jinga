# T001 — 저장소·배포·기능 인벤토리

작성 2026-11-19 · 근거 `artifacts/inventory.json`(`node scripts/build-inventory.mjs` 로 다시 뽑습니다)
**비밀값은 이 문서와 inventory.json 어디에도 없습니다 — 환경변수는 이름만 적습니다.**

## 1. 어디에 올라가 있는가

| | |
|---|---|
| 사이트 | Vercel · https://jinga-retech.vercel.app · 리전 icn1 |
| 배포 방법 | `node scripts/deploy-vercel.mjs` — `site/public` → `site/.build` 로 묶어 올림 |
| 저장소 | https://github.com/sjseo-ai/jinga (**로컬 작업이 기본, 요청할 때만 push**) |
| 서버 함수 | 11개 (Vercel Hobby 한도 12개 — 새 기능은 `api/community.mjs` 안에 얹어 왔음) |
| 공용 모듈 | `site/public/api/_*.mjs` 25개 |
| 워커 | Cloudflare 4개 — `jinga-korea-macro`, `jinga-policy-proxy`, `jinga-realestate-proxy`, `jinga-yahoo-proxy` |
| 정적 페이지 | 단지 2,002장 · 자치구 33장 |
| 테스트 | `npm test` — 스모크 28파일 / 228건 |

### 서버 함수 11개
`/api/admin` `/api/admin-login` `/api/annual` `/api/community` `/api/kb-gu` `/api/market-flow`
`/api/market-map` `/api/report` `/api/stock-analysis` `/api/subscribe` `/api/weekly`

### 자동으로 도는 것 (스케줄)

| 어디 | 언제 | 무엇 | 지금 상태 |
|---|---|---|---|
| Vercel cron | 매일 23:30 UTC (한국 08:30) | `/api/weekly` — **월요일에 주간 작업 시작**, 그 밖의 날은 멈춘 작업 이어 가기·구독 메일 정리 | **KB 수집 단계는 2026-11-19 부터 꺼짐**(`JINGA_KB_BULK`) |
| Cloudflare | 30분·6시간 간격 | `jinga-korea-macro` 거시 지표 갱신 | 켜짐 (KB 무관) |
| Cloudflare | 매시 7분 | `jinga-policy-proxy` 정책 뉴스 | 켜짐 (KB 무관) |
| 내 PC 작업 스케줄러 | 화·금 17:00 | 「진가 블로그 연재 알림」 — 알림창만 | 켜짐 (KB 무관) |
| 내 PC | 수동 | `scripts/weekly-report.bat`, `scripts/serial-refresh.bat` | 예약 없음 |

## 2. 데이터는 어디에 쌓이는가

- **서버(비공개 Vercel Blob)** — `subs/<id>.json` 구독자 / `weekly/…` 주간 작업 조각·보고서·**KB 시세 조각**·지역 지도 집계
- **저장소 안 파일** — `site/public/*.json` (K-apt, KB 단지목록, 정비사업, 입지 등)
- **이용자 브라우저** — `kb2:*`(KB 조회 결과 24시간), `jinga:cm:last`, `jinga_hit`(방문 집계 중복 방지)

## 3. 기능 ↔ 파일

| 기능 | 화면 | 계산·조회 | 서버 |
|---|---|---|---|
| 단지 검색·진가 BEST 5 | `index.html` | `jinga-kb.mjs`, `jinga-reco.mjs` | 없음(브라우저가 KB 직접 조회) |
| 전수 엑셀 내려받기 | — | — | **2026-11-19 삭제** |
| 매물 추천 | `index.html` | `jinga-reco.mjs` | `/api/annual` |
| 지역 지도·시장 흐름 | `index.html` | — | `/api/market-map`, `/api/market-flow`(KB데이터허브 조회) |
| 주간 보고서 구독 | `index.html` | — | `/api/subscribe`, `/api/weekly`, `api/_job.mjs` |
| 커뮤니티·임장·방문집계 | `index.html` | — | `/api/community`, `api/_stats.mjs` |
| 단지·자치구 정적 페이지 | `scripts/_pages.mjs` | — | 없음(미리 만들어 둔 HTML) |
| 블로그 연재 글감 | — | `scripts/_post.mjs` | 없음(내 PC에서만) |
| 주식·재무 | `index.html` | `jinga-*.mjs` | `/api/stock-analysis`, 워커 2개 |

## 4. 바깥으로 나가는 곳 (수집 진입점)

**조회하는 쪽**
- `api.kbland.kr`, `kbland.kr` — KB 시세·매물·단지정보 (이용자 브라우저 + 서버 주간 작업)
- `data-api.kbland.kr` — KB데이터허브 주택가격동향 (서버 `/api/market-flow`, 메모리 캐시만)
- `apis.data.go.kr` — 국토부 실거래 (**인증키 미승인 403**)
- `www.reb.or.kr`, `ecos.bok.or.kr`, `finlife.fss.or.kr`, `www.schoolinfo.go.kr`, `cleanup.seoul.go.kr` — 공공
- `query1.finance.yahoo.com`, `*.nasdaq.com`, `m.stock.naver.com`, `data.sec.gov` — 주식 (부동산과 무관)
- `news.google.com`, `search.naver.com` — 뉴스 제목·링크
- `api.opentopodata.org`(경사도), `dapi.kakao.com`(지도), `api.frankfurter.dev`(환율)

**조회하지 않는 쪽(일부러)** — `new.land.naver.com`, `hogangnono.com` 은 **링크로만** 씁니다.
`api/_outside.mjs` 가 원문 붙여넣기를 막고 요약+원문 링크만 받습니다(robots.txt·약관·개인 저작물 때문).

## 5. 화면 설명과 실제가 달랐던 곳

| 어디 | 적혀 있던 말 | 실제 | 조치 |
|---|---|---|---|
| `legal.html` | 「대량으로 다시 배포하지 않습니다」 | 전수 엑셀 버튼이 있었음 | 2026-11-19 기능 삭제 후 문구 사실화 |
| 설명 문구 | 「전수 데이터 엑셀을 함께 드립니다」 | 같음 | 삭제 |
| 구두 보고(11/18) | 「서버는 KB 를 모아 두지 않습니다」 | **주간 작업이 서버에서 3,000여 곳을 모아 Blob 에 저장** | 2026-11-19 스위치로 차단 |

## 6. 남은 위험

- `kb-*-complexes.json`(단지일련번호·이름·세대수 등)은 KB 수집물이며 **K-apt 와 짝짓는 열쇠**라 당장 대체 수단이 없음 → T009/T011 에서 다룸
- 국토부 실거래 인증키 미승인 → P2 전체가 막혀 있음
- 구독자가 있는 상태에서 주간 메일이 멈춤 → 안내 문구 필요(아래 `docs/mitigation-plan.md`)
