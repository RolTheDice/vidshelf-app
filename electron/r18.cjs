// r18.dev에서 품번으로 작품 정보를 가져온다 (DMM 작품 정보를 공개 JSON으로 제공, 로그인·키 필요 없음).
//  1) /videos/vod/movies/detail/-/dvd_id=<품번>/json   → content_id
//  2) /videos/vod/movies/detail/-/combined=<content_id>/json → 배우(한자·가나·로마자)·장르(일본어)·레이블·제작사·시리즈·감독·표지
// 사이트 화면을 읽지 않고 JSON만 받으므로 사이트가 바뀌어도 잘 깨지지 않는다.
const { sameCode } = require('./code.cjs');
const { mapGenres } = require('./genres-ko.cjs');
const { nameToHangul } = require('./kana.cjs');
const { buildCandidates } = require('./coverfinder.cjs');

const BASE = 'https://r18.dev';
const ACTRESS_IMG = 'https://pics.dmm.co.jp/mono/actjpgs/';

/**
 * 품번 → content_id 후보. dvd_id로 안 잡히는 작품이 있어서(예: START-669 → 1start00669) 직접 넣어 본다.
 * 표지 찾기와 같은 규칙(배운 규칙 → ShowCover 대응표 → 흔한 형태)으로 만든 표지 주소에서 content_id만 뽑는다.
 */
function contentIdGuesses(code, rules = {}, max = 6) {
  const m = String(code || '').toLowerCase().match(/^([a-z0-9]+?)-?0*(\d+)$/);
  if (!m) return [];
  const [, p, n] = m;
  const out = [];
  const add = (cid) => { if (cid && !out.includes(cid)) out.push(cid); };
  for (const url of buildCandidates(code, rules)) {
    const c = String(url).match(/\/([a-z0-9_]+?)p[ls]\.jpg$/i);
    if (c && !/r$/.test(c[1])) add(c[1].toLowerCase());
    if (out.length >= max) break;
  }
  add(`${p}${n.padStart(5, '0')}`);
  add(`${p}${n.padStart(3, '0')}`);
  // 5자리(디지털)로 먼저: 디지털 정보에 배우 가나 이름·장르 일본어가 더 잘 들어 있다
  const five = out.filter((c) => /\d{5}$/.test(c));
  return [...five, ...out.filter((c) => !five.includes(c))].slice(0, max);
}

/** content_id(예: 1start00669, h_1234abc00012)가 품번과 같은 작품인지 */
function contentMatches(cid, code) {
  const c = String(cid || '').toLowerCase().match(/([a-z]+?)0*(\d+)[a-z]?$/);
  const k = String(code || '').toLowerCase().match(/^([a-z0-9]*?[a-z])-?0*(\d+)$/);
  if (!c || !k) return true; // 모양을 모르면 막지 않음
  return c[1].endsWith(k[1].replace(/^\d+/, '')) && Number(c[2]) === Number(k[2]);
}

const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();

/** 표지: mono 작품은 작은 ps.jpg가 올 때가 있어 큰 pl.jpg를 먼저 */
function coverUrls(j) {
  const urls = [];
  const full = clean(j.jacket_full_url);
  if (full) {
    if (/ps\.jpg$/i.test(full)) urls.push(full.replace(/ps\.jpg$/i, 'pl.jpg'));
    urls.push(full);
  }
  return urls;
}

/**
 * combined JSON → 프로그램이 쓰는 모양 (이름은 아직 한글 확정 전: ko는 읽는 법으로 만든 한글)
 * @param {object} j combined 응답
 */
function parseCombined(j) {
  const actresses = (j.actresses || []).map((a) => ({
    id: a.id || null,
    ja: clean(a.name_kanji) || clean(a.name_romaji),
    kana: clean(a.name_kana),
    romaji: clean(a.name_romaji),
    ko: nameToHangul(a.name_kana, a.name_romaji) || clean(a.name_romaji) || clean(a.name_kanji),
    photo: a.image_url ? ACTRESS_IMG + String(a.image_url).replace(/^\/+/, '') : '',
  })).filter((a) => a.ja || a.ko);
  const d = (j.directors || [])[0];
  const dvdId = clean(j.dvd_id);
  return {
    source: 'r18',
    contentId: clean(j.content_id),
    code: dvdId,
    title: clean(j.title_en) || clean(j.title_ja),
    titleJa: clean(j.title_ja),
    actors: actresses.map((a) => ({ name: a.ko, ja: a.ja, kana: a.kana, romaji: a.romaji, r18Id: a.id, photo: a.photo })),
    maker: clean(j.maker_name_en) || clean(j.maker_name_ja),
    makerJa: clean(j.maker_name_ja),
    label: clean(j.label_name_en) || clean(j.label_name_ja),
    labelJa: clean(j.label_name_ja),
    series: clean(j.series_name_en) || clean(j.series_name_ja),
    seriesJa: clean(j.series_name_ja),
    director: d ? (nameToHangul(d.name_kana, d.name_romaji) || clean(d.name_romaji) || clean(d.name_kanji)) : '',
    releaseDate: clean(j.release_date).slice(0, 10),
    runtime: Number(j.runtime_mins) || null,
    genres: mapGenres(j.categories),
    story: '',
    coverUrls: coverUrls(j),
  };
}

class R18Client {
  /** @param {(url:string)=>Promise<{status:number, json:any}>} getJson */
  constructor(getJson, { guessGapMs = 300 } = {}) {
    this.getJson = getJson;
    this.guessGapMs = guessGapMs;
  }

  async _combined(cid) {
    const r = await this.getJson(`${BASE}/videos/vod/movies/detail/-/combined=${encodeURIComponent(cid)}/json`);
    return r.status === 200 && r.json && r.json.content_id ? r.json : null;
  }

  /**
   * @param {string} code
   * @param {{rules?:object}} [opt] rules: 표지에서 배운 레이블별 규칙 (content_id 형태 추측에 씀)
   * @returns {Promise<{found:boolean, data?:object, reason?:string, blocked?:boolean}>}
   */
  async lookup(code, { rules = {} } = {}) {
    // 하이픈을 넣으면 r18.dev가 비슷한 다른 작품을 줄 때가 있어(waaa-700 → waaa00007) 붙여서 묻는다
    const dvd = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const first = await this.getJson(`${BASE}/videos/vod/movies/detail/-/dvd_id=${encodeURIComponent(dvd)}/json`);
    if (first.status === 403 || first.status === 429) return { found: false, blocked: true, reason: `r18.dev가 접속을 막았어요 (HTTP ${first.status})` };
    let full = null;
    if (first.status === 200 && first.json && first.json.content_id && contentMatches(first.json.content_id, code)) {
      full = await this._combined(first.json.content_id);
    }
    if (!full) {
      // dvd_id로 안 잡히는 작품: content_id 형태를 직접 넣어 본다
      for (const cid of contentIdGuesses(code, rules)) {
        if (this.guessGapMs) await new Promise((r) => setTimeout(r, this.guessGapMs));
        const j = await this._combined(cid);
        // 다른 품번이 우연히 같은 content_id를 쓰는 경우는 버린다 (dvd_id가 있으면 비교)
        if (j && (j.dvd_id ? sameCode(j.dvd_id, code) : contentMatches(j.content_id, code))) { full = j; break; }
      }
    }
    if (!full) return { found: false, reason: first.status === 404 ? 'r18.dev에 없는 품번' : `r18.dev 응답 ${first.status}` };
    const data = parseCombined(full);
    if (data.code && !sameCode(data.code, code)) return { found: false, reason: `품번 불일치 (${data.code})` };
    if (!data.code) data.code = code;
    return { found: true, data };
  }
}

module.exports = { R18Client, parseCombined, contentIdGuesses, contentMatches, ACTRESS_IMG };
