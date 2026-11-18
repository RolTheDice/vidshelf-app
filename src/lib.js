// 화면에서 쓰는 도우미 함수들

export const imgUrl = (p, v) => (p ? `vsimg://img/?p=${encodeURIComponent(p)}${v ? `&v=${v}` : ''}` : null);
export const mediaUrl = (p) => `vsmedia://video/?p=${encodeURIComponent(p)}`;

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
}

export function fmtSize(bytes) {
  if (!bytes) return '-';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export const STATUS_LABEL = {
  new: '정리 전',
  done: '정리 완료',
  coveronly: '표지만 있음',
  notfound: '정보 못 찾음',
  error: '오류',
  nocode: '품번 없음',
};

export const UNKNOWN = {
  pending: '정보 받기 전',
  failed: '정보 못 찾음',
  actor: '배우 미상',
  maker: '제작사 미상',
  prefix: '품번 없음',
  label: '레이블 미상',
  series: '시리즈 없음',
  genre: '장르 없음',
};

// 아직 정보를 받지 않은 영상은 "미상"이 아니라 "정보 받기 전"으로 따로 묶는다
const hasInfo = (v) => v.status === 'done' || v.locked;
const noInfo = (v) => (v.status === 'new' ? UNKNOWN.pending : v.status === 'nocode' ? UNKNOWN.prefix : UNKNOWN.failed);
const or = (v, value, unknown) => (value ? [value] : [hasInfo(v) ? unknown : noInfo(v)]);

// 그룹 기준: 한 영상이 여러 그룹에 들어갈 수 있다(배우·장르)
export const GROUPINGS = [
  { id: 'all', label: '전체' },
  { id: 'new', label: '최근 추가' },
  { id: 'actor', label: '배우별', keys: (v) => (v.actors && v.actors.length ? v.actors : or(v, null, UNKNOWN.actor)) },
  { id: 'maker', label: '제작사별', keys: (v) => or(v, v.maker, UNKNOWN.maker) },
  { id: 'prefix', label: '품번별', keys: (v) => [v.code ? v.code.split('-')[0] : UNKNOWN.prefix] },
  { id: 'label', label: '레이블별', keys: (v) => or(v, v.label, UNKNOWN.label) },
  { id: 'genre', label: '장르별', keys: (v) => (v.genres && v.genres.length ? v.genres : or(v, null, UNKNOWN.genre)) },
  { id: 'playlist', label: '재생목록' },
  { id: 'favorite', label: '즐겨찾기', filter: (v) => v.favorite },
  { id: 'recent', label: '최근 본 영상', filter: (v) => !!v.lastPlayed },
  { id: 'unsorted', label: '미분류', filter: (v) => v.status !== 'done' && !v.locked },
  { id: 'dupes', label: '중복 품번' },
];

export function buildGroups(videos, grouping) {
  const g = GROUPINGS.find((x) => x.id === grouping);
  if (!g || !g.keys) return [];
  const map = new Map();
  for (const v of videos) for (const k of g.keys(v)) map.set(k, (map.get(k) || 0) + 1);
  const unknown = Object.values(UNKNOWN);
  return [...map.entries()]
    .map(([name, count]) => ({ name, count, special: unknown.includes(name) }))
    .sort((a, b) => (a.special - b.special) || b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}

// 최근 추가: 정한 기간 안에 들어왔고 아직 한 번도 안 본(재생 횟수 0) 영상
export function isRecentUnwatched(v, days) {
  if (v.missing || v.playCount > 0 || v.lastPlayed) return false;
  return !days || (v.addedAt || 0) >= Date.now() - days * 86400000;
}

export function filterByGroup(videos, grouping, key, opts = {}) {
  const g = GROUPINGS.find((x) => x.id === grouping);
  if (g && g.id === 'new') return videos.filter((v) => isRecentUnwatched(v, opts.recentDays));
  if (!g || g.id === 'all' || g.id === 'playlist') return videos; // 재생목록은 App에서 순서대로 고른다
  if (g.filter) return videos.filter(g.filter);
  if (g.id === 'dupes') {
    const counts = {};
    videos.forEach((v) => { if (v.code) counts[v.code] = (counts[v.code] || 0) + 1; });
    return videos.filter((v) => v.code && counts[v.code] > 1);
  }
  if (key == null) return videos;
  return videos.filter((v) => g.keys(v).includes(key));
}

export function searchVideos(videos, q) {
  const s = q.trim().toLowerCase();
  if (!s) return videos;
  const compact = s.replace(/[-_\s]/g, '');
  return videos.filter((v) => {
    const hay = [v.code, v.fileName, v.title, v.maker, v.label, v.series, v.director, ...(v.actors || []), ...(v.genres || []), v.memo]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(s) || (v.code && v.code.toLowerCase().replace('-', '').includes(compact));
  });
}

export const SORTS = [
  { id: 'added', label: '추가한 날짜', fn: (a, b) => a.addedAt - b.addedAt },
  { id: 'code', label: '품번', fn: (a, b) => (a.code || a.fileName).localeCompare(b.code || b.fileName, 'en', { numeric: true }) },
  { id: 'release', label: '발매일', fn: (a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || '') },
  { id: 'actor', label: '배우', fn: (a, b) => (a.actors[0] || '힣').localeCompare(b.actors[0] || '힣', 'ko') },
  { id: 'rating', label: '별점', fn: (a, b) => (a.rating || 0) - (b.rating || 0) },
  { id: 'plays', label: '재생 횟수', fn: (a, b) => (a.playCount || 0) - (b.playCount || 0) },
  { id: 'lastPlayed', label: '최근 재생', fn: (a, b) => (a.lastPlayed || 0) - (b.lastPlayed || 0) },
  { id: 'size', label: '용량', fn: (a, b) => a.size - b.size },
  { id: 'file', label: '파일 이름', fn: (a, b) => a.fileName.localeCompare(b.fileName, 'ko', { numeric: true }) },
];

export function sortVideos(videos, sortId, dir) {
  const s = SORTS.find((x) => x.id === sortId) || SORTS[0];
  const out = [...videos].sort(s.fn);
  return dir === 'desc' ? out.reverse() : out;
}
