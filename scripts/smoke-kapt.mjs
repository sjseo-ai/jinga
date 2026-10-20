// 공동주택 공식 정보(_kapt.mjs) 스모크 테스트 — 순수 계산, 네트워크 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normName, dongStem, stripDong, sameName, matchComplex, householdsAgree,
  parseBasis, parseDetail, parkingText, parkingPerHouse, areaMixText, publicKapt,
  MIN_NAME_LEN, HOUSEHOLD_TOLERANCE,
} from '../site/public/api/_kapt.mjs';

const R = (kaptName, as3, kaptCode = 'A' + kaptName.length) => ({ kaptCode, kaptName, as3, as2: '강동구' });

test('이름 다듬기 — 띄어쓰기·괄호·「아파트」 꼬리·제2차', () => {
  assert.equal(normName('삼익그린맨션 (2차)'), '삼익그린맨션2차');
  assert.equal(normName('고덕 그라시움 아파트'), '고덕그라시움');
  assert.equal(normName('래미안 제3차'), '래미안3차');
  assert.equal(normName(null), '');
  assert.equal(dongStem('명일동'), '명일');
  assert.equal(dongStem('상일동'), '상일');
  assert.equal(dongStem('고덕동'), '고덕');
});

test('K-apt 가 앞에 붙이는 동 이름 떼기', () => {
  // 같은 단지를 KB 는 「삼익그린맨션(2차)」, K-apt 는 「명일삼익그린2차」로 적습니다
  assert.equal(stripDong('명일삼익그린2차', '명일동'), '삼익그린2차');
  assert.equal(stripDong('고덕그라시움', '고덕동'), '그라시움');
  assert.equal(stripDong('래미안솔베뉴', '명일동'), '래미안솔베뉴', '동 이름으로 시작하지 않으면 그대로');
  // 떼고 나서 너무 짧아지면 떼지 않습니다(그 이름이 곧 동 이름인 경우)
  assert.equal(stripDong('명일주공', '명일동'), '명일주공');
});

test('같은 단지인지 — 짧은 이름으로는 따지지 않음', () => {
  assert.equal(sameName('고덕그라시움', '고덕그라시움'), true);
  assert.equal(sameName('고덕그라시움', '고덕그라시움1단지'), true, '한쪽이 품고 있으면');
  assert.equal(sameName('삼익', '명일삼익그린2차'), false, `${MIN_NAME_LEN}자 미만은 포함관계를 보지 않음`);
  assert.equal(sameName('래미안', '래미안솔베뉴'), true);
  assert.equal(sameName('', '무엇'), false);
  assert.equal(sameName('가나다', '라마바'), false);
});

test('짝 맞추기 — 같은 동 먼저, 애매하면 포기', () => {
  const rows = [R('래미안솔베뉴', '명일동'), R('명일삼익그린2차', '명일동'), R('고덕그라시움', '고덕동')];

  assert.equal(matchComplex({ name: '래미안솔베뉴', dong: '명일동' }, rows).kaptName, '래미안솔베뉴');
  assert.equal(matchComplex({ name: '고덕그라시움', dong: '고덕동' }, rows).kaptName, '고덕그라시움');
  // 동 이름을 떼야 맞는 경우
  assert.equal(matchComplex({ name: '삼익그린맨션(2차)', dong: '명일동' }, rows), null, '「삼익그린맨션2차」와 「삼익그린2차」는 품지 못함');
  assert.equal(matchComplex({ name: '삼익그린2차', dong: '명일동' }, rows).kaptName, '명일삼익그린2차');

  // 다른 동이어도 구 전체에서 찾아 줍니다(KB 와 K-apt 의 동 표기가 다를 수 있어서)
  assert.equal(matchComplex({ name: '고덕그라시움', dong: '상일동' }, rows).kaptName, '고덕그라시움');
  assert.equal(matchComplex({ name: '없는단지이름', dong: '명일동' }, rows), null);

  // 후보가 여럿이고 길이가 똑같이 벌어지면 포기 — 틀린 짝은 없느니만 못합니다
  const twins = [R('한양1차', '길동'), R('한양2차', '길동')];
  assert.equal(matchComplex({ name: '한양', dong: '길동' }, twins), null, '둘 다 똑같이 품으면 고르지 않음');
  // 하나가 뚜렷이 가까우면 고릅니다
  const near = [R('한양아파트', '길동'), R('한양아파트2차한솔', '길동')];
  assert.equal(matchComplex({ name: '한양', dong: '길동' }, near).kaptName, '한양아파트');
});

test('세대수로 되짚기 — 이름이 비슷해도 세대수가 크게 다르면 버림', () => {
  assert.equal(householdsAgree(1000, 1000), true);
  assert.equal(householdsAgree(1000, 900), true, '10% 차이는 통과');
  assert.equal(householdsAgree(1000, 700), false, '30% 차이는 다른 단지로 봄');
  assert.equal(householdsAgree(943, 532), false);
  assert.equal(householdsAgree(1000, null), true, '한쪽을 모르면 되짚을 수 없으니 통과');
  assert.equal(householdsAgree(null, 1000), true);
  assert.equal(householdsAgree(1000, 1000 * (1 - HOUSEHOLD_TOLERANCE)), true, '딱 경계면 통과');
});

const BASIS = {
  kaptCode: 'A13822301', kaptName: '갤러리아팰리스', codeSaleNm: '분양', codeHeatNm: '지역난방',
  kaptTarea: 265791.62, kaptDongCnt: '3', kaptdaCnt: 741, codeAptNm: '주상복합', codeMgrNm: '위탁관리',
  codeHallNm: '혼합식', kaptUsedate: '20050111', kaptTopFloor: 46, kaptBaseFloor: 5, kaptdEcntp: 22,
  kaptMparea60: 0, kaptMparea85: 48, kaptMparea135: 137, kaptMparea136: 556,
};
const DETAIL = {
  kaptCode: 'A13822301', kaptdPcnt: '20', kaptdPcntu: '1427', kaptdEcnt: 27, kaptdCccnt: '300',
  codeStr: '철근콘크리트구조', subwayLine: '2호선, 8호선', subwayStation: '잠실', kaptdWtimesub: '5분이내',
  kaptdWtimebus: '10~15분이내', welfareFacility: '관리사무소, 노인정', educationFacility: '초등학교(잠전초등)',
  groundElChargerCnt: 0, undergroundElChargerCnt: 43,
};

test('기본 정보 읽기 — 실제 응답 모양 그대로', () => {
  const b = parseBasis(BASIS);
  assert.equal(b.dongs, 3);
  assert.equal(b.households, 741);
  assert.equal(b.hall, '혼합식');
  assert.equal(b.sale, '분양');
  assert.equal(b.baseFloor, 5, '지하층수');
  assert.equal(b.lifts, 22);
  assert.equal(b.area136, 556);
  assert.equal(b.usedAt, '20050111');
  assert.equal(parseBasis(null), null);
  assert.equal(parseBasis({}), null, '단지코드가 없으면 버림');
});

test('상세 정보 읽기 — 지하주차장이 핵심', () => {
  const d = parseDetail(DETAIL);
  assert.equal(d.parkUnder, 1427, '문자열로 와도 숫자로');
  assert.equal(d.parkGround, 20);
  assert.equal(d.cctv, 300);
  assert.equal(d.subwayStation, '잠실');
  assert.equal(d.subwayWalk, '5분이내');
  assert.equal(d.evUnder, 43);
  assert.equal(parseDetail({}), null);
  // 길면 잘라 둡니다
  assert.ok(parseDetail({ ...DETAIL, welfareFacility: 'ㄱ'.repeat(500) }).welfare.length <= 200);
});

test('주차 — 보여 줄 한 줄과 세대당 대수', () => {
  const k = { ...parseBasis(BASIS), ...parseDetail(DETAIL) };
  assert.equal(parkingText(k), '지하주차 1,427대 · 지상 20대');
  assert.equal(parkingPerHouse(k, 741), 1.95);
  assert.equal(parkingText({ parkUnder: 0, parkGround: 120 }), '지하주차장 없음 · 지상 120대');
  assert.equal(parkingText({ parkUnder: 0, parkGround: 0 }), '지하주차장 없음');
  assert.equal(parkingText({}), '', '둘 다 모르면 아무 말도 하지 않음');
  assert.equal(parkingText(null), '');
  assert.equal(parkingPerHouse({ parkUnder: 0, parkGround: 0 }, 500), null);
  assert.equal(parkingPerHouse(k, 0), null);
  // 세대당 1대가 안 되는 단지
  assert.equal(parkingPerHouse({ parkUnder: 300, parkGround: 100 }, 800), 0.5);
});

test('면적대별 세대수 — 어떤 평형이 몇 세대인지', () => {
  assert.equal(areaMixText(parseBasis(BASIS)), '60~85㎡ 48세대 · 85~135㎡ 137세대 · 135㎡ 초과 556세대');
  assert.equal(areaMixText({ area60: 100, area85: 0 }), '60㎡ 이하 100세대');
  assert.equal(areaMixText({}), '');
  assert.equal(areaMixText(null), '');
});

test('화면으로 내보내는 묶음', () => {
  const k = { ...parseBasis(BASIS), ...parseDetail(DETAIL) };
  const pub = publicKapt(k);
  assert.equal(pub.parkUnder, 1427);
  assert.equal(pub.subwayStation, '잠실');
  assert.equal(pub.baseFloor, 5);
  assert.equal(publicKapt(null), null);
});

test('값이 없는 것과 0은 다름 — Number("")가 0이 되는 함정', () => {
  // 이 프로젝트에서 네 번째로 겪은 함정입니다(좌표·종가·임대세대수·여기).
  // 모르는 단지를 「지하주차장 없음」이라고 단정하면 안 됩니다.
  assert.equal(parkingText({}), '');
  assert.equal(parkingText({ parkUnder: null, parkGround: null }), '');
  assert.equal(parkingText({ parkUnder: '', parkGround: '' }), '');
  assert.equal(parkingText({ parkUnder: 0, parkGround: 0 }), '지하주차장 없음', '0은 「없다」가 맞음');

  const b = parseBasis({ kaptCode: 'A1' });
  assert.equal(b.dongs, null, '동수를 못 받으면 0동이 아니라 모름');
  assert.equal(b.households, null);
  assert.equal(b.baseFloor, null);
  assert.equal(parseBasis({ kaptCode: 'A1', kaptBaseFloor: 0 }).baseFloor, 0, '지하층 0은 진짜 0');
  assert.equal(parseDetail({ kaptCode: 'A1' }).parkUnder, null);
  assert.equal(parseDetail({ kaptCode: 'A1', kaptdPcntu: '0' }).parkUnder, 0);
});
