// 품번기(poomki.net) 페이지에서 정보를 읽는 규칙.
// 각 함수는 브라우저 창 안에서 그대로 실행되므로(fn.toString()) 바깥 변수나 require를 쓰면 안 된다.
// 사이트 화면이 바뀌어 정보를 못 읽으면 이 파일만 고치면 된다.

/** 검색 결과(/search/?q=품번)에서 품번이 같은 작품 링크 찾기 → [{url, code}] */
function findMovieLinks(doc, code) {
  const norm = (s) => {
    const m = String(s || '').toUpperCase().replace(/\s+/g, '').match(/([A-Z0-9]+?)[-_]?0*(\d+)$/);
    return m ? m[1] + '-' + m[2] : String(s || '').toUpperCase();
  };
  const want = norm(code);
  const out = [];
  const seen = new Set();
  const main = doc.querySelector('main') || doc.body;
  main.querySelectorAll('a[href]').forEach((a) => {
    if (a.closest('aside')) return; // 옆의 인기 배우·신작 목록은 빼고
    const href = a.getAttribute('href') || '';
    if (!/^(https?:\/\/[^/]+)?\/movies\/[^/?#]+\/?$/.test(href)) return;
    // 카드 안에서 품번처럼 생긴 첫 글자 덩어리
    let found = '';
    const spans = a.querySelectorAll('span');
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (s.children.length === 0 && /^[A-Za-z0-9]+-?\d+$/.test(t)) { found = t; break; }
    }
    if (!found) {
      const m = (a.textContent || '').match(/[A-Za-z0-9]+-\d+/);
      if (m) found = m[0];
    }
    if (!found || norm(found) !== want) return;
    const url = new URL(href, doc.location ? doc.location.href : 'https://www.poomki.net/').toString();
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, code: found.toUpperCase() });
  });
  return out;
}

/** 작품 상세 페이지(/movies/숫자/) 읽기 */
function extractPoomkiDetail(doc) {
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const result = {
    isDetail: false,
    source: 'poomki',
    poomkiId: null,
    code: '',
    title: '',
    actors: [],
    nameAliases: [],
    maker: '',
    label: '',
    series: '',
    director: '',
    releaseDate: '',
    runtime: null,
    genres: [],
    story: '',
    actorPhoto: '',
    dvdIdx: null,
  };

  // 1) 페이지에 들어 있는 구조화 데이터 (schema.org Movie)
  let movie = null;
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    if (movie) return;
    try {
      const j = JSON.parse(s.textContent);
      const list = Array.isArray(j) ? j : (j['@graph'] || [j]);
      movie = list.find((x) => x && x['@type'] === 'Movie') || null;
    } catch (_) { /* 다른 데이터 */ }
  });
  if (movie) {
    result.isDetail = true;
    result.code = clean(movie.identifier);
    result.releaseDate = clean(movie.datePublished).slice(0, 10);
    const dur = String(movie.duration || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (dur && (dur[1] || dur[2])) result.runtime = (+dur[1] || 0) * 60 + (+dur[2] || 0);
    const company = Array.isArray(movie.productionCompany) ? movie.productionCompany[0] : movie.productionCompany;
    if (company && company.name) result.label = clean(company.name);
    const actors = Array.isArray(movie.actor) ? movie.actor : movie.actor ? [movie.actor] : [];
    result.actors = actors.filter((a) => a && a.name).map((a) => {
      const m = String(a.url || a['@id'] || '').match(/\/actress\/(\d+)/);
      return { name: clean(a.name), poomkiIdx: m ? m[1] : null };
    });
    const id = String(movie['@id'] || movie.url || '').match(/\/movies\/([^/]+)\//);
    if (id) result.poomkiId = id[1];
  }

  // 2) 화면 글자에서 보충 (구조화 데이터가 없거나 빠진 칸)
  const main = doc.querySelector('main') || doc.body;
  const h1 = main.querySelector('h1');
  if (!result.code && h1) {
    const m = clean(h1.textContent).match(/[A-Za-z0-9]+-\d+/);
    if (m) { result.code = m[0].toUpperCase(); result.isDetail = true; }
  }
  // "… 출시 · OO 레이블 · OO 제작 · 120분 · 단독 출연 작품입니다." 문장
  let summary = '';
  main.querySelectorAll('p').forEach((p) => {
    const t = clean(p.textContent);
    if (!summary && /작품은/.test(t) && /제작|레이블|출시/.test(t)) summary = t;
  });
  if (summary) {
    for (const part of summary.replace(/입니다\.?$/, '').split('·').map(clean)) {
      let m;
      if ((m = part.match(/^(.+?)\s*제작$/))) result.maker = m[1];
      else if (!result.label && (m = part.match(/^(.+?)\s*레이블$/))) result.label = m[1];
      else if (!result.runtime && (m = part.match(/^(\d+)\s*분$/))) result.runtime = +m[1];
      else if ((m = part.match(/^(.+?)\s*시리즈$/))) result.series = m[1];
      else if ((m = part.match(/^(.+?)\s*감독$/))) result.director = m[1];
    }
    if (!result.releaseDate) {
      const d = summary.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
      if (d) result.releaseDate = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`;
    }
  }
  if (!result.actors.length) {
    // 위쪽 "출연 배우" 줄의 배우 링크
    const seen = new Set();
    main.querySelectorAll('a[href*="/actress/"]').forEach((a) => {
      if (a.closest('aside')) return;
      if (a.querySelector('img')) return; // 아래 출연 배우 카드(사진·나이 글자 포함)는 빼고 이름 링크만
      const name = clean(a.getAttribute('title') ? a.getAttribute('title').replace(/\s*프로필$/, '') : a.textContent);
      const m = (a.getAttribute('href') || '').match(/\/actress\/(\d+)/);
      if (name && !seen.has(name) && name.length < 30) { seen.add(name); result.actors.push({ name, poomkiIdx: m ? m[1] : null }); }
    });
    if (result.actors.length) result.isDetail = result.isDetail || !!result.code;
  }

  // 3) 배우 사진 (본문 "출연 배우" 칸의 배우 링크 안 사진, 옆 목록은 제외)
  const photos = {};
  main.querySelectorAll('#movie-cast-grid img[alt], a[href*="/actress/"] img[alt]').forEach((img) => {
    if (img.closest('aside')) return;
    const name = clean(img.getAttribute('alt').replace(/\s*프로필$/, ''));
    const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (name && /^https?:/.test(src) && !photos[name]) photos[name] = src;
  });
  result.actors.forEach((a) => { if (photos[a.name]) a.photo = photos[a.name]; });
  if (result.actors.length === 1 && result.actors[0].photo) result.actorPhoto = result.actors[0].photo;
  return result;
}

module.exports = { findMovieLinks, extractPoomkiDetail };
