# 두 계획서 대조표

작성 2026-11-23

진가에는 **계획서가 둘** 있고, 과제 번호가 겹치면서 뜻이 다릅니다. 같은 일을 두 번 하거나
한 쪽만 보고 「아직 안 했다」고 착각하는 것을 막기 위한 표입니다.

| | 파일 | 번호 체계 |
|---|---|---|
| ㉮ 실행 로드맵 | `재태크 앱/JINGA_Claude_Execution_Roadmap_2027.json` | P0~P6 · T001~T034 |
| ㉯ 구현 계획서 | `재태크 앱/JINGA_IMPLEMENTATION_PLAN.json` | P0~P5 · T001~T013 |

**㉯ T001 과 ㉮ T001 은 다른 과제가 아닙니다 — 같은 일을 다르게 끊어 적은 것입니다.**
아래는 ㉯ 기준으로, 무엇이 이미 끝났고 무엇이 ㉯ 때문에 새로 생겼는지 적은 것입니다.

## ㉯ 구현 계획서 진행 상황

| ㉯ | 과제 | ㉮ 대응 | 상태 | 증빙 |
|---|---|---|---|---|
| T001 | 저장소·경로·모듈 인벤토리 | T001 | **done** | `docs/current-state.md`, `artifacts/inventory.json` |
| T002 | KB 관련 엔드포인트·저장·작업·내보내기 추적 | T002 | **done** | `docs/data-lineage.md`, `artifacts/source-register.csv` |
| T003 | 무허가 유료 배포 경로 차단 | T003 | **done(2회차)** | `docs/mitigation-plan.md` 3·6·7절, `scripts/smoke-no-unlicensed.mjs`(12건). 11-19 에 가격 7경로, 11-24 에 **가격이 아닌 KB 자료 8파일**을 추가로 차단 |
| T004 | 출처 이용허락 대장 | T009 | **done** | `data/source-policy.json`(원천 12건 · 원문URL·검토일·캐시/재배포/파생 권리 · 어떤 공개 파일로 나가는지까지), `scripts/smoke-no-unlicensed.mjs` 가 빈 칸·권리 없는 배포를 막음 |
| T005 | 실거래 서버측 어댑터 | T010 | **done** | `scripts/_trades.mjs`, `build-trades.mjs`, `refresh-trades.mjs`, `smoke-trades-ingest.mjs`(16건), `docs/schema.md` · 서울 **63,319건** · 일별 갱신 75회/22초(2026-11-26) |
| T006 | 단지 표준 식별자·매칭 진단 | T010·T011 | **done** | `scripts/match-trades.mjs`, `scripts/build-kapt-list.mjs` · 74.7% 매칭, **후보가 여럿이면 합치지 않고 포기** |
| T007 | 시점·면적·**층** 보정 비교거래 기준선 | T012 | **done(v3)** | `scripts/_avm.mjs` `FLOOR_FACTOR`, `scripts/exp-floor.mjs`, `docs/model-card.md` |
| T008 | 시간분할 백테스트·코호트별 수치 | T013 | **done** | `research/metrics.json`, `research/avm-backtest.md` — 등급·연식·면적대·층대·자치구 코호트 · v3 로 갱신(2026-11-23) |
| T009 | 반응형 의사결정 화면 `/decision` | — (㉯ 고유) | **done** | `site/public/decision/index.html`, `scripts/build-decision.mjs`, `scripts/smoke-decision.mjs`(13건) |
| T010 | 교통·학교·생활 어댑터 | T009·T011 | **대부분 done(2026-11-24)** | `scripts/build-kapt-infra.mjs`·`build-school-coords.mjs`·`build-stations.mjs`·`build-complex-coords.mjs`, `jinga-reco.mjs` 구간 점수, `smoke-no-unlicensed.mjs`(12건)·`smoke-reco.mjs`(20건). KB 파생 8개 파일 배포 제거(약 2.6MB). 역 좌표는 2026-11-24 에 들어왔습니다(표준데이터 15013205, XLSX 직접 읽기). **남은 것: 카카오 REST 키(사람)** → `docs/mitigation-plan.md` 7절 |
| T011 | 출처 추적 가능한 보고서 | T017 | **기계장치 done · 칸 목록은 T008 대기** | `scripts/_report.mjs`(주장 구조·검사), `_report-compose.mjs`(칸 구성), `smoke-report-source.mjs`(14건), `npm run report`. 실제 단지 보고서 50줄·출처 20종·**출처 없는 주장 0건** |
| T012 | 유료 의향 시범 테스트 | T019·T020 | 대기(사람) | |
| T013 | B2B 시범·투자설명 자료 | T028~ | 대기(사람) | |

## ㉮ 로드맵에만 있는 것 (㉯ 에 대응이 없음)

| ㉮ | 과제 | 상태 |
|---|---|---|
| T004 | 변호사 질의·KB 이용허락 | **blocked(사람)** — 대표가 선임·발송 |
| T005~T008 | 고객 세분화·인터뷰 20건·경쟁 벤치마킹·요구사항 동결 | T006 인터뷰에서 막힘 |
| T014 | 개인정보·보안 기본체계 | **done** — 2FA·접근기록·삭제창구까지 |
| T016 | 대출·비용 및 시나리오 계산 | **done** — `scripts/_finance.mjs`, `docs/finance-model.md` |

㉯ 계획서에는 **보안·개인정보 과제가 없습니다.** ㉮ T014 로 이미 끝냈으므로 ㉯ 를 따른다고
빼면 안 됩니다. 반대로 ㉯ T009(`/decision` 화면)는 ㉮ 에 없던 것이고, ㉮ T016 금융 엔진이
그 화면의 ⑤ 칸을 그대로 채웁니다 — 두 계획서가 여기서 맞물립니다.

## 다음에 손댈 순서

1. ~~㉯ T008~~ — 2026-11-23 완료. v3 로 갱신, 기준선을 처음으로 이김(4.1% vs 4.3%).
2. ~~㉯ T004~~ — 2026-11-24 완료. 대장에 권리 칸과 **어떤 공개 파일로 나가는지**까지 적고 테스트가 지킵니다.
3. ~~㉯ T010~~ — 2026-11-24 대부분 완료. 역 좌표까지 들어와 **지도 역 핀·경사 감점이 되살아났습니다**.
   남은 한 칸: **단지 좌표** — 카카오 **REST API** 키를 `scripts/kakao-rest-key.cmd` 로 넣으면
   `npm run geocode` 가 K-apt 주소를 좌표로 바꿔, 마지막 KB 파일 2개(`kb-*-complexes`)를 정리할 수 있습니다.
4. ~~㉯ T011 기계장치~~ — 2026-11-25 완료. 합격 기준(「출처 없는 주장이 없다」)은 칸 목록과 무관해
   먼저 세웠습니다. **어떤 칸을 담을지는 T008(인터뷰) 뒤에 확정**이고, 그때 칸 함수만 갈아 끼웁니다.
5. **㉮ T006 인터뷰** — 여기서 ㉯ T011 칸 목록·㉮ T008 요구사항 동결·㉮ T015 비교 엔진이 함께 풀립니다.
   지금 로드맵에서 **사람 손을 기다리는 가장 큰 매듭**입니다.
