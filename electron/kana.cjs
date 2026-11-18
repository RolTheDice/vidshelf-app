// 일본어 읽는 법(히라가나·가타카나) → 한글 표기.
// 국내 AV 정보 사이트에서 흔히 쓰는 표기에 맞춘다: か행·た행은 항상 거센소리(카·타),
// 장음(ゆう·こう·ー)은 줄이고, っ은 ㅅ 받침, ん은 ㄴ 받침.
// 예) やまぎしあいか → 야마기시 아이카, しいなそら → 시이나 소라

// [가나, 한글, 로마자]
const BASE = [
  ['あ', '아', 'a'], ['い', '이', 'i'], ['う', '우', 'u'], ['え', '에', 'e'], ['お', '오', 'o'],
  ['か', '카', 'ka'], ['き', '키', 'ki'], ['く', '쿠', 'ku'], ['け', '케', 'ke'], ['こ', '코', 'ko'],
  ['が', '가', 'ga'], ['ぎ', '기', 'gi'], ['ぐ', '구', 'gu'], ['げ', '게', 'ge'], ['ご', '고', 'go'],
  ['さ', '사', 'sa'], ['し', '시', 'shi'], ['す', '스', 'su'], ['せ', '세', 'se'], ['そ', '소', 'so'],
  ['ざ', '자', 'za'], ['じ', '지', 'ji'], ['ず', '즈', 'zu'], ['ぜ', '제', 'ze'], ['ぞ', '조', 'zo'],
  ['た', '타', 'ta'], ['ち', '치', 'chi'], ['つ', '츠', 'tsu'], ['て', '테', 'te'], ['と', '토', 'to'],
  ['だ', '다', 'da'], ['ぢ', '지', 'ji'], ['づ', '즈', 'zu'], ['で', '데', 'de'], ['ど', '도', 'do'],
  ['な', '나', 'na'], ['に', '니', 'ni'], ['ぬ', '누', 'nu'], ['ね', '네', 'ne'], ['の', '노', 'no'],
  ['は', '하', 'ha'], ['ひ', '히', 'hi'], ['ふ', '후', 'fu'], ['へ', '헤', 'he'], ['ほ', '호', 'ho'],
  ['ば', '바', 'ba'], ['び', '비', 'bi'], ['ぶ', '부', 'bu'], ['べ', '베', 'be'], ['ぼ', '보', 'bo'],
  ['ぱ', '파', 'pa'], ['ぴ', '피', 'pi'], ['ぷ', '푸', 'pu'], ['ぺ', '페', 'pe'], ['ぽ', '포', 'po'],
  ['ま', '마', 'ma'], ['み', '미', 'mi'], ['む', '무', 'mu'], ['め', '메', 'me'], ['も', '모', 'mo'],
  ['や', '야', 'ya'], ['ゆ', '유', 'yu'], ['よ', '요', 'yo'],
  ['ら', '라', 'ra'], ['り', '리', 'ri'], ['る', '루', 'ru'], ['れ', '레', 're'], ['ろ', '로', 'ro'],
  ['わ', '와', 'wa'], ['ゐ', '이', 'i'], ['ゑ', '에', 'e'], ['を', '오', 'o'], ['ゔ', '부', 'vu'],
  ['ぁ', '아', 'a'], ['ぃ', '이', 'i'], ['ぅ', '우', 'u'], ['ぇ', '에', 'e'], ['ぉ', '오', 'o'],
];
// 두 글자 조합 (きゃ 등)
const COMBO = [
  ['きゃ', '캬', 'kya'], ['きゅ', '큐', 'kyu'], ['きょ', '쿄', 'kyo'],
  ['ぎゃ', '갸', 'gya'], ['ぎゅ', '규', 'gyu'], ['ぎょ', '교', 'gyo'],
  ['しゃ', '샤', 'sha'], ['しゅ', '슈', 'shu'], ['しょ', '쇼', 'sho'], ['しぇ', '셰', 'she'],
  ['じゃ', '자', 'ja'], ['じゅ', '주', 'ju'], ['じょ', '조', 'jo'], ['じぇ', '제', 'je'],
  ['ちゃ', '차', 'cha'], ['ちゅ', '추', 'chu'], ['ちょ', '초', 'cho'], ['ちぇ', '체', 'che'],
  ['ぢゃ', '자', 'ja'], ['ぢゅ', '주', 'ju'], ['ぢょ', '조', 'jo'],
  ['にゃ', '냐', 'nya'], ['にゅ', '뉴', 'nyu'], ['にょ', '뇨', 'nyo'],
  ['ひゃ', '햐', 'hya'], ['ひゅ', '휴', 'hyu'], ['ひょ', '효', 'hyo'],
  ['びゃ', '뱌', 'bya'], ['びゅ', '뷰', 'byu'], ['びょ', '뵤', 'byo'],
  ['ぴゃ', '퍄', 'pya'], ['ぴゅ', '퓨', 'pyu'], ['ぴょ', '표', 'pyo'],
  ['みゃ', '먀', 'mya'], ['みゅ', '뮤', 'myu'], ['みょ', '묘', 'myo'],
  ['りゃ', '랴', 'rya'], ['りゅ', '류', 'ryu'], ['りょ', '료', 'ryo'],
  ['ふぁ', '파', 'fa'], ['ふぃ', '피', 'fi'], ['ふぇ', '페', 'fe'], ['ふぉ', '포', 'fo'],
  ['てぃ', '티', 'ti'], ['でぃ', '디', 'di'], ['とぅ', '투', 'tu'], ['どぅ', '두', 'du'],
  ['うぃ', '위', 'wi'], ['うぇ', '웨', 'we'], ['うぉ', '워', 'wo'],
  ['ゔぁ', '바', 'va'], ['ゔぃ', '비', 'vi'], ['ゔぇ', '베', 've'], ['ゔぉ', '보', 'vo'],
];
const MAP = new Map([...BASE, ...COMBO].map(([k, h, r]) => [k, { h, r }]));

/** 가타카나 → 히라가나 */
function toHiragana(s) {
  return String(s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 한글 글자에 받침 붙이기 (이미 받침이 있으면 그대로)
function addFinal(syl, jong) {
  const code = syl.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171 || code % 28 !== 0) return syl;
  return String.fromCharCode(0xac00 + code + jong);
}
const JONG_N = 4; // ㄴ
const JONG_S = 19; // ㅅ

/** 가나를 (가나 조각, 한글, 로마자) 단위로 나눈다 */
function units(kana) {
  const s = toHiragana(kana).replace(/[\s・･·]/g, '');
  const out = [];
  for (let i = 0; i < s.length;) {
    const two = MAP.get(s.slice(i, i + 2));
    if (two && s.length > i + 1) { out.push({ k: s.slice(i, i + 2), ...two }); i += 2; continue; }
    const c = s[i];
    if (MAP.has(c)) out.push({ k: c, ...MAP.get(c) });
    else if (c === 'ん') out.push({ k: c, h: '', r: 'n', final: JONG_N });
    else if (c === 'っ') out.push({ k: c, h: '', r: '', sokuon: true });
    else if (c === 'ー' || c === '〜' || c === '～') out.push({ k: c, h: '', r: '', long: true });
    else out.push({ k: c, h: c, r: c.toLowerCase() }); // 가나가 아닌 글자는 그대로
    i += 1;
  }
  return out;
}

const vowelOf = (r) => (r.match(/[aiueo]$/) || [''])[0];

/** 가나 → 한글 (띄어쓰기 없음) */
function kanaToHangul(kana) {
  const us = units(kana);
  let out = '';
  let prevVowel = '';
  for (let i = 0; i < us.length; i++) {
    const u = us[i];
    if (u.final) { out = out ? out.slice(0, -1) + addFinal(out.slice(-1), u.final) : 'ㄴ'; prevVowel = ''; continue; }
    if (u.sokuon) { if (out) out = out.slice(0, -1) + addFinal(out.slice(-1), JONG_S); continue; }
    if (u.long) continue;
    // 장음 줄이기: お段+う/お, う段+う (ゆう→유, こう→코, おお→오)
    if ((u.k === 'う' && (prevVowel === 'o' || prevVowel === 'u')) || (u.k === 'お' && prevVowel === 'o')) continue;
    out += u.h;
    prevVowel = vowelOf(u.r);
  }
  return out;
}

/** 로마자 비교용 정규화 (shi/si, chi/ti, tsu/tu, fu/hu, ji/zi, 장음 차이 무시) */
function normRomaji(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '')
    .replace(/sh/g, 's').replace(/ch/g, 't').replace(/ts/g, 't').replace(/f/g, 'h').replace(/j/g, 'z')
    .replace(/([aiueo])\1+/g, '$1').replace(/ou/g, 'o').replace(/oh(?=[^aiueo]|$)/g, 'o')
    .replace(/m(?=[bpm])/g, 'n').replace(/([^aiueo])\1+/g, '$1');
}

/**
 * 배우·감독 이름: 가나 읽는 법을 한글로, 로마자 이름(예: "Aika Yamagishi")으로 성과 이름 사이를 띄운다.
 * @param {string} kana  예) やまぎしあいか
 * @param {string} [romaji] 예) Aika Yamagishi (이름 성 순서)
 */
function nameToHangul(kana, romaji) {
  const us = units(kana);
  if (!us.length) return '';
  const words = String(romaji || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const family = normRomaji(words[words.length - 1]);
    // 성 = 로마자 마지막 단어. 가나 앞부분이 그 성과 같아지는 가장 긴 지점에서 띄운다 (かとう = kato 처럼 장음 포함)
    let acc = '';
    let cut = 0;
    for (let i = 1; i < us.length; i++) {
      acc += us[i - 1].r;
      if (normRomaji(acc) === family) cut = i;
    }
    if (cut) {
      const famKana = us.slice(0, cut).map((u) => u.k).join('');
      const restKana = us.slice(cut).map((u) => u.k).join('');
      return `${kanaToHangul(famKana)} ${kanaToHangul(restKana)}`.trim();
    }
  }
  return kanaToHangul(kana);
}

/** 한글 이름 비슷한 정도 (0~1, 띄어쓰기 무시, 최장 공통 부분 수열 기준) */
function nameSimilarity(a, b) {
  const x = String(a || '').replace(/\s+/g, '');
  const y = String(b || '').replace(/\s+/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[x.length][y.length]) / (x.length + y.length);
}

module.exports = { kanaToHangul, nameToHangul, nameSimilarity, toHiragana, normRomaji };
