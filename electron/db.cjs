// 아주 단순한 JSON 저장소. 영상 수만 개까지 문제없이 동작한다.
// 저장은 임시 파일에 쓴 뒤 바꿔치기해서, 도중에 꺼져도 파일이 깨지지 않게 한다.
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  coverMode: 'appdata', // appdata: 프로그램 폴더(기본) / beside: 영상 옆 품번.jpg / subfolder: covers 폴더
  requestDelayMs: 1500, // 사이트 요청 간격 (품번기는 최소 2.5초)
  useR18: true, // r18.dev: 주 정보원 (배우·레이블·제작사·시리즈·감독·장르·발매일·표지 주소)
  usePoomki: true, // 품번기(poomki.net): 한국어 배우 이름 확인, r18.dev에 없는 작품
  translateTitles: true, // 일본어 원제를 한국어로 번역
  deeplKey: '', // DeepL API 키 (있으면 DeepL, 없으면 구글 번역)
  extensions: ['mp4', 'mkv', 'avi', 'wmv', 'mov', 'm4v', 'ts', 'flv', 'webm', 'mpg', 'mpeg', 'rmvb'],
  sort: 'added',
  sortDir: 'desc',
  blockedActors: [], // 지운 배우 이름 (다시 정보를 받아도 넣지 않음)
  recentDays: 30, // '최근 추가'에 보여줄 기간 (0 = 기간 상관없이)
};

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.data = { version: 1, folders: [], videos: {}, actors: {}, playlists: [], coverRules: {}, settings: { ...DEFAULT_SETTINGS, sourcesV3: true, avdbsCleared: true } };
    this._timer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        ...this.data, ...raw, playlists: raw.playlists || [], coverRules: raw.coverRules || {},
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      };
      // 정보 가져올 곳을 r18.dev + 품번기로 바꿨다 (avdbs 기능은 없앰)
      if (!this.data.settings.sourcesV3) {
        delete this.data.settings.useAvdbs;
        delete this.data.settings.sourcesV2;
        this.data.settings.useR18 = true;
        this.data.settings.usePoomki = true;
        this.data.settings.sourcesV3 = true;
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // 깨진 파일은 백업해 두고 새로 시작
        try { fs.copyFileSync(this.file, this.file + '.broken-' + Date.now()); } catch (_) { /* ignore */ }
      }
    }
  }

  save(immediate = false) {
    clearTimeout(this._timer);
    const write = () => {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    };
    if (immediate) write();
    else this._timer = setTimeout(write, 400);
  }

  get settings() { return this.data.settings; }
  get videos() { return this.data.videos; }
  get actors() { return this.data.actors; }
  get folders() { return this.data.folders; }
  get playlists() { return this.data.playlists; }

  ensureActor(name, patch = {}) {
    if (!name) return null;
    const a = this.data.actors[name] || { name, idx: null, photo: null, aliases: [], memo: '', rating: 0, favorite: false };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'aliases') a.aliases = Array.from(new Set([...(a.aliases || []), ...v])).filter((x) => x !== name);
      else if (a[k] == null || a[k] === '' || k === 'idx') a[k] = v;
    }
    this.data.actors[name] = a;
    return a;
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
