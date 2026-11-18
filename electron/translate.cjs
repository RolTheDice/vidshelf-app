// 일본어 → 한국어 번역.
//  - DeepL API: 설정에 키를 넣었을 때 (무료 키는 끝이 ':fx', 한 달 50만 자)
//  - 구글 번역: 키 없이 쓰는 공개 주소. 구글이 공식으로 보장하는 방법이 아니라서 막히거나 바뀔 수 있다.
// 실패하면 null을 돌려주고, 다음 정리 때 다시 시도한다.
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/**
 * @param {string} text 일본어
 * @param {(url:string)=>Promise<{status:number, json:any}>} getJson
 * @param {{names?:{ja:string, ko:string}[]}} [opt] 번역 전에 일본어 배우 이름을 정해 둔 한국어 이름으로 바꿔 둔다
 * @returns {Promise<string|null>}
 */
async function translateJaKo(text, getJson, { names = [] } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  // 띄어쓰기 단위로 줄을 나눠 보낸다: 한 덩어리로 보내면 구글이 성인 표현이 있는 뒷부분을 빼고 앞부분만 번역할 때가 있다
  const sorted = [...names].filter((x) => x && x.ja && x.ko).sort((a, b) => b.ja.length - a.ja.length);
  const lines = raw.split(/[\s\u3000]+/).filter(Boolean).map((chunk) => {
    // 배우 이름은 번역기가 제멋대로 읽지 않게 미리 한국어 이름으로 바꿔 둔다 (긴 이름부터)
    for (const n of sorted) chunk = chunk.split(n.ja).join(n.ko);
    return chunk;
  });
  const src = lines.join('\n').slice(0, 1500);
  const url = `${ENDPOINT}?client=gtx&sl=ja&tl=ko&dt=t&q=${encodeURIComponent(src)}`;
  const r = await getJson(url);
  if (r.status !== 200 || !Array.isArray(r.json) || !Array.isArray(r.json[0])) return null;
  const out = r.json[0].map((seg) => (Array.isArray(seg) ? seg[0] || '' : '')).join('').replace(/\s+/g, ' ').trim();
  return out || null;
}

// 배우 이름은 번역기가 제멋대로 읽지 않게 미리 한국어 이름으로 바꿔 둔다 (긴 이름부터)
function protectNames(text, names = []) {
  let out = String(text || '');
  for (const n of [...names].filter((x) => x && x.ja && x.ko).sort((a, b) => b.ja.length - a.ja.length)) {
    out = out.split(n.ja).join(` ${n.ko} `);
  }
  return out.replace(/\s+/g, ' ').trim();
}

const deeplBase = (key) => (/:fx$/.test(String(key || '').trim()) ? 'https://api-free.deepl.com' : 'https://api.deepl.com');

/**
 * DeepL로 번역
 * @param {(url:string, init:object)=>Promise<{status:number, json:any}>} request
 * @returns {Promise<{text:string|null, status:number}>} status 403: 키가 틀림, 456: 이번 달 글자 수를 다 씀
 */
async function translateDeepl(text, key, request, { names = [] } = {}) {
  const src = protectNames(text, names);
  if (!src) return { text: null, status: 0 };
  const r = await request(`${deeplBase(key)}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${String(key).trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [src.slice(0, 1500)], source_lang: 'JA', target_lang: 'KO' }),
  });
  const t = r.status === 200 && r.json && r.json.translations && r.json.translations[0] && r.json.translations[0].text;
  return { text: t ? String(t).replace(/\s+/g, ' ').trim() : null, status: r.status };
}

/** DeepL 키 확인 + 이번 달 사용량 */
async function deeplUsage(key, request) {
  const r = await request(`${deeplBase(key)}/v2/usage`, { method: 'GET', headers: { Authorization: `DeepL-Auth-Key ${String(key).trim()}` } });
  if (r.status === 200 && r.json) return { ok: true, used: r.json.character_count || 0, limit: r.json.character_limit || 0 };
  return { ok: false, status: r.status, message: r.status === 403 ? '키가 맞지 않아요' : `DeepL 응답 ${r.status}` };
}

module.exports = { translateJaKo, translateDeepl, deeplUsage, protectNames };
