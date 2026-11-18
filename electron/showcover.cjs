// 출처: ShowCover v1.1 (크롬 확장)의 레이블 대응표와 표지 주소 생성 규칙을 프로그램용으로 옮긴 것.
// 품번 → DMM 표지(pl.jpg) 후보 주소 목록을 만든다. 실제 존재 여부는 cover.cjs에서 확인.
// coverfinder.cjs가 '이 PC에서 배운 규칙' 다음, '흔한 형태' 앞에 이 후보들을 넣는다.

// Prestige 계열 레이블 (118 + maker + num + r 패턴)
const PRESTIGE_ITEMS = {
  prestige: /abf|abw|abp|abs|chn|che|gdl|afs|drc|esk|hrv|yrh|yrk|ama|bgn|sga|ppt|pxh|mgt|tus|tre|gwjac|vpc|job|dic|mas|mgt|mrd|trd|dom|shs|evo|mbd|cmi|raw|dnw|gne|kdk|gooe/,
  kanbi: /kpb|dtt/,
  doc: /cdc|sim|fcp|docp/,
  onemore: /onez/,
  shiroutotv: /siv/,
  mbm: /kum/,
  projectdiamond: /prb/,
  jackson: /jac|jnt/,
  gets: /ggen|gyan|gnab|gzap/,
  kurofune: /kfne/,
  nanpatv: /npv/,
  luxutv: /lxv/,
  documentv: /dcv/,
};

// 품번 앞부분 → DMM 콘텐츠 ID 접두어
const ALL_ITEMS = {
  '1': /stars|sdfk|silku|star|sdjs|sdnm|kmhr|sdth|kuse|sdab|sdmm|danuhd|nyh|zozo|ftht|akdl|silks|sdam|sdde|kire|shn|fsdss|fsvss|nhdtb|mist|svdvd|iesp|piyo|dldss|sun|dandy|rctd|hawa|^sw$|ienf|^gs$|hbad|okb|dandan|nhvr|havd|mtvr|iesm|ftdss|okp|svomn|hypn|sdnt|sdmu|nttr|fset|shyn|dvdm|miha|aege|wawa|asex|namh|sdmf|boko|mgold|fns/i,
  'h_139': /doks/i,
  '2': /dfe|wfr|ekw|wpvr|wkd|ktb|neob|enki|hunbl|cko|akdl|hnamh|chuc|chc|inot|avop|mxgs|hmgl|vgd/i,
  '12': /bur|lol|imo|scr/,
  '13': /gvg|dsvr|gqe|gvh|ovg|yvg|rvg/i,
  '18': /mght|mond|sprd|ntrd|spbx/,
  '24': /dfbvr|vdd/,
  '30': /nha|msc|msa/,
  '36': /drop|dkwt/i,
  '42': /^sp$/,
  '55': /davk|tmavr|t28/i,
  '57': /jksr|mcsr|itsr|bdsr|husr|sgsr/,
  '71': /gas/,
  '84': /xrw|ongp|kmvr/i,
  '86': /axdvd/,
  '100': /^tv$|^yen$/,
  '125': /umd/,
  '149': /^rd$/,
  '171': /lhtd/,
  '189': /hsf/,
  '301': /mbdd/,
  '422': /kagd/,
  '433': /gun|neo/,
  '436': /bubb/,
  '504': /ibw/i,
  '5013': /tsds/,
  '5443': /loota/i,
  '5448': /mwkd/,
  '5561': /brth|flvr11|lvid|ftsh|vntg|shmo/i,
  '5581': /pitv/,
  '5642': /bndv|hodv/,
  'h_086': /fera|jrze|jura|mesu|nuka|abba|cvdx|toen|zeaa|iqqq|hima|ferax|iga|kaad|hone/,
  'h_1337': /wvr9c/i,
  'h_1368': /komz/,
  'h_254': /kir|ofku|spz|vnds|doki|mgdn|dmat|udak|nxg|kazk|eih/,
  'h_1248': /kiwvr/,
  'h_1462': /com|pyu/,
  'h_706': /anda|coch|gredb|prbyb|sbmo|sprbd|thnib|ppmn/,
  'h_244': /saba|supa/i,
  'h_1575': /sgkx/,
  'h_1256': /tpvr|tprm/,
  'h_1127': /vovs|gopj|vosf|vosm/i,
  'h_1116': /cafuku|cami|casmani|cafr|capi|cabe|caca/,
  'h_019': /acz|kck/,
  'h_1100': /hzgd|hzhb/,
  'h_1000': /spye/,
  'h_1001': /oyaj/,
  'h_1231': /^ss$/,
  'h_1300': /mtes/,
  'h_1435': /clo|bth/,
  'h_1573': /ftuj/,
  'h_1577': /favkh|fbcpv/,
  'h_496': /dogd/,
  'h_574': /iqpa/,
  'h_1569': /nkkvr/,
  'h_1002': /jgaho/,
  'h_1386': /dinm/,
  'h_1492': /siror/,
  'h_1587': /ein/,
  'h_720': /zex/,
  'h_1416': /^ad$/,
  'h_1563': /mol/,
  'h_094': /ktra/,
  'h_796': /much/,
  'h_458': /hsm/,
  'h_1304': /^tg$/,
  'h_1526': /^pm$/,
  'h_1342': /nsm/,
  'h_1440': /fgan/,
  'h_1594': /spro/,
  'h_1096': /bdsm/,
  'h_113': /^(bbacos|cb|ek|kpp|spo|sw)$/,
  'h_1165': /goju/,
  'h_1553': /ftvr/,
  'h_1560': /shind/,
  'h_1345': /gnax/i,
  'h_1558': /csdx/i,
  'h_1593': /cubex|fanq|fanx|papak/,
  'h_172': /hmnf/i,
  'h_173': /ghkr|gtrl|ryoj|tbb|thp/,
  'h_189': /cha|milf|^pc$|tsm|uta|vio/,
  'h_237': /ambi|ambs|clot|hdka|nacr|nacx|zmar/,
  'h_897': /nmk/,
  'h_101': /^gs$/,
  'h_227': /jukf/,
  'h_1324': /skmj/,
  'h_1240': /milk/,
  'h_1472': /hmvf|stvf/,
  'h_1378': /arso/,
  'h_580': /tms/,
  'h_1533': /can/,
  'h_1321': /pydvr/,
  'h_1155': /crvr/,
  'h_910': /vrtm/i,
  'h_921': /^hj$/,
  'h_346': /rebd/,
  'h_687': /snkh|snkp|shm|jbjb|macb|dasd|hunbl/,
  'h_1495': /bank/,
  '41': /hodv/,
  '': /./,
};

function purifySubjectId(subjectID) {
  const split = String(subjectID || '').split('-');
  if (split.length < 2) return [null, null];
  let maker = split[0].toLowerCase().trim();
  const num = split[1].trim();
  const replaceMap = { kssis: 'ssis', kcawd: 'cawd' };
  if (replaceMap[maker]) maker = replaceMap[maker];
  return [maker, num];
}

function makeImageURLs(subjectID) {
  const [maker, num] = purifySubjectId(subjectID);
  if (!maker || !num) return [];

  const paddedNum5 = num.padStart(5, '0');
  const paddedNum3 = num.padStart(3, '0');
  const urls = [];

  // [1] Prestige 계열
  for (const key in PRESTIGE_ITEMS) {
    if (PRESTIGE_ITEMS[key].test(maker)) {
      const cid = '118' + maker + num + 'r';
      const cidNoR = '118' + maker + num;
      const cidPadded = '118' + maker + paddedNum5 + 'r';
      urls.push(
        `https://pics.dmm.co.jp/mono/movie/${cid}/${cid}pl.jpg`,
        `https://pics.dmm.com/mono/movie/${cid}/${cid}pl.jpg`,
        `https://pics.dmm.co.jp/mono/movie/adult/${cid}/${cid}pl.jpg`,
        `https://pics.dmm.co.jp/digital/video/${cid}/${cid}pl.jpg`,
        `https://pics.dmm.co.jp/mono/movie/${cidNoR}/${cidNoR}pl.jpg`,
        `https://pics.dmm.co.jp/mono/movie/${cidPadded}/${cidPadded}pl.jpg`,
      );
      break;
    }
  }

  // [2] 접두어 매핑
  let foundKey = '';
  for (const key in ALL_ITEMS) {
    if (ALL_ITEMS[key].test(maker)) { foundKey = key; break; }
  }

  // [3] 후보 ID 조합
  const combos = [];
  const needsR = ['h_139'].includes(foundKey);
  if (foundKey && /^\d+$/.test(foundKey)) {
    combos.push(foundKey + maker + num, foundKey + maker + paddedNum3, foundKey + maker + paddedNum5);
  } else if (needsR) {
    combos.push(
      foundKey + maker + num + 'r', foundKey + maker + paddedNum3 + 'r', foundKey + maker + paddedNum5 + 'r',
      foundKey + maker + num, foundKey + maker + paddedNum3, foundKey + maker + paddedNum5,
    );
  } else {
    combos.push(foundKey + maker + paddedNum5, foundKey + maker + paddedNum3, foundKey + maker + num);
  }
  if (!needsR) {
    combos.push(foundKey + maker + num + 'r', foundKey + maker + paddedNum3 + 'r', foundKey + maker + paddedNum5 + 'r');
  }
  if (foundKey) {
    combos.push(maker + num, maker + paddedNum3, maker + paddedNum5, maker + num + 'r', maker + paddedNum5 + 'r');
  }
  if (!foundKey.startsWith('h_')) {
    for (const prefix of ['1', '2', '12', '13', '18', '24', '36', '55', '84']) {
      if (prefix !== foundKey) combos.push(prefix + maker + num, prefix + maker + paddedNum3);
    }
  }

  // [4] URL 생성 (mono/movie 우선)
  for (const cid of combos) {
    urls.push(
      `https://pics.dmm.co.jp/mono/movie/${cid}/${cid}pl.jpg`,
      `https://pics.dmm.co.jp/mono/movie/adult/${cid}/${cid}pl.jpg`,
      `https://pics.dmm.co.jp/digital/video/${cid}/${cid}pl.jpg`,
      `https://pics.dmm.com/mono/movie/${cid}/${cid}pl.jpg`,
      `https://pics.dmm.com/mono/movie/adult/${cid}/${cid}pl.jpg`,
    );
  }

  // [5] 매핑이 없을 때 자주 쓰이는 h_ 접두어 시도
  if (!foundKey) {
    for (const prefix of ['h_086', 'h_254', 'h_346', 'h_237', 'h_127', 'h_706', 'h_244', 'h_687', 'h_1127', '1', '13', '84']) {
      const cid = prefix + maker + paddedNum5;
      urls.push(
        `https://pics.dmm.co.jp/mono/movie/${cid}/${cid}pl.jpg`,
        `https://pics.dmm.co.jp/mono/movie/adult/${cid}/${cid}pl.jpg`,
        `https://pics.dmm.co.jp/digital/video/${cid}/${cid}pl.jpg`,
      );
    }
  }

  return [...new Set(urls)];
}

module.exports = { makeImageURLs, purifySubjectId };
