// 파일명에서 품번(예: ABCD-123)을 추출한다.
const EXCLUDE = new Set([
  'hd', 'fhd', 'uhd', 'sd', 'mp', 'av', 'dts', 'aac', 'ac', 'hevc', 'avc', 'part', 'pt', 'cd', 'disc',
  'ep', 'vol', 'ch', 'web', 'dvd', 'bd', 'fps', 'bit', 'kbps', 'mbps', 'dl', 'rip', 'res', 'top', 'no',
]);

function extractCode(fileName) {
  const base = String(fileName).replace(/\.[^.]+$/, '');
  // 대괄호/괄호 안의 사이트명·태그 등은 뒤로 미룬다 (우선 바깥 부분에서 찾음)
  const outside = base.replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ');
  for (const text of [outside, base]) {
    const re = /(?:^|[^a-z0-9])([a-z]{2,6})[-_ ]?(\d{2,5})(?=$|[^0-9])/gi;
    let m;
    while ((m = re.exec(text))) {
      const prefix = m[1].toLowerCase();
      if (EXCLUDE.has(prefix)) continue;
      // 1080p, 720p, x264 등 해상도/코덱 표기 배제
      if (/^(x|h)$/.test(prefix)) continue;
      const num = m[2].length < 3 ? m[2].padStart(3, '0') : m[2];
      return `${m[1].toUpperCase()}-${num}`;
    }
  }
  return null;
}

/** 두 품번이 같은지 (대소문자·하이픈·앞자리 0 무시: ABC-045 = abc45) */
function sameCode(a, b) {
  const n = (s) => {
    const m = String(s || '').toUpperCase().match(/([A-Z0-9]+?)[-_ ]?0*(\d+)$/);
    return m ? m[1] + '-' + m[2] : String(s || '').toUpperCase();
  };
  return n(a) === n(b);
}

module.exports = { extractCode, sameCode };
