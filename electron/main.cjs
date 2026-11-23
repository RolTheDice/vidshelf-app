const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Store } = require('./db.cjs');
const { scanFolder, reconcileMoves } = require('./scanner.cjs');
const { handleMediaRequest } = require('./media.cjs');
const { readKeyframes } = require('./keyframes.cjs');
const { findSubtitles, loadSubtitle } = require('./subtitles.cjs');
const { extractCode } = require('./code.cjs');
const { R18Client } = require('./r18.cjs');
const { PoomkiClient } = require('./poomki.cjs');
const { nameSimilarity, nameToHangul, normRomaji } = require('./kana.cjs');
const { translateJaKo, translateDeepl, deeplUsage } = require('./translate.cjs');
const { findCover, coverPathFor, findExistingCover, saveCover, imageSize } = require('./cover.cjs');
const { rememberRule, describeRule, parseCode, learnRule } = require('./coverfinder.cjs');

// 로컬 이미지(표지·배우 사진)용 vsimg://img/?p=<경로>, 내장 플레이어용 vsmedia://video/?p=<경로>
protocol.registerSchemesAsPrivileged([
  { scheme: 'vsimg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'vsmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

let win = null;
let store = null;
// 정보 가져올 곳: r18.dev(주 정보원, JSON) → 품번기(한국어 배우 이름 확인, r18.dev에 없는 작품)
async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    let json = null;
    if (res.ok) { try { json = await res.json(); } catch (_) { /* JSON이 아님 */ } }
    return { status: res.status, json };
  } finally { clearTimeout(t); }
}
// 사이트별 요청 차례 지키기: 여러 영상을 동시에 처리해도 한 사이트에는 하나씩, 정해진 간격을 두고 묻는다
class SiteGate {
  constructor() { this.tails = new Map(); }
  run(key, gapMs, fn) {
    const prev = this.tails.get(key) || Promise.resolve();
    const p = prev.then(async () => {
      try { return await fn(); } finally { await sleep(typeof gapMs === 'function' ? gapMs() : gapMs); }
    });
    this.tails.set(key, p.catch(() => {}));
    return p;
  }
}
const gate = new SiteGate();
const ORGANIZE_WORKERS = 3; // 동시에 정리하는 영상 수 (사이트마다 요청은 위 차례대로)

// r18.dev: 너무 잦다(429)·서버 오류·연결 끊김이면 잠깐 쉬었다가 다시 (3초 → 10초 → 30초)
async function r18Get(url) {
  const waits = [3000, 10000, 30000];
  for (let i = 0; ; i++) {
    let r;
    try { r = await fetchJson(url); } catch (_) { r = { status: 0, json: null }; }
    if ((r.status && r.status !== 429 && r.status < 500) || i >= waits.length) return r;
    await sleep(waits[i]);
  }
}
const r18 = new R18Client((url) => gate.run('r18', 250, () => r18Get(url)), { guessGapMs: 0 });

// POST 등 요청 (DeepL)
async function requestJson(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await net.fetch(url, { ...init, signal: ctrl.signal });
    let json = null;
    try { json = await res.json(); } catch (_) { /* JSON이 아님 */ }
    return { status: res.status, json };
  } finally { clearTimeout(t); }
}
const poomki = new PoomkiClient();
// 품번기는 사이트에 부담을 주지 않게 요청 사이를 넉넉히 쉰다
const poomkiGap = () => Math.max(store.settings.requestDelayMs || 0, 1500) + Math.round(Math.random() * 500);
// 품번기는 보이지 않는 창 하나로 열기 때문에 한 번에 하나만 (검색 → 상세 사이도 쉬고, 끝나고도 쉼)
const poomkiLookup = (code) => gate.run('poomki', poomkiGap, () => poomki.lookup(code, { gapMs: poomkiGap() }));
const job = { running: false, cancelled: false };

const dataDir = () => app.getPath('userData');
const appCoversDir = () => path.join(dataDir(), 'covers');
const actorPhotoDir = () => path.join(dataDir(), 'actors');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 화면에 보여줄 버전: package.json 버전 + 소스로 실행 중이면 git 커밋
function appVersion() {
  let commit = '';
  try {
    const gitDir = path.join(__dirname, '..', '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.slice(4).trim();
      const loose = path.join(gitDir, ...ref.split('/'));
      commit = fs.existsSync(loose) ? fs.readFileSync(loose, 'utf8').trim()
        : (fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(' ' + ref)) || '').split(' ')[0];
    } else commit = head;
  } catch (_) { /* 설치판에는 .git이 없음 */ }
  return app.getVersion() + (commit ? ` (${commit.slice(0, 7)})` : '');
}

function snapshot() {
  return {
    version: appVersion(),
    videos: Object.values(store.videos),
    actors: store.actors,
    folders: store.folders,
    playlists: store.playlists,
    coverRules: coverRuleList(),
    settings: store.settings,
    dataDir: dataDir(),
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function existingCover(v) {
  return findExistingCover(v, appCoversDir());
}

// 이미 받은 표지 기록(coverUrl)으로 표지 규칙을 채운다 (처음 한 번, 그리고 빠진 것만)
function seedCoverRules() {
  const rules = store.data.coverRules;
  let added = 0;
  for (const v of Object.values(store.videos)) {
    if (!v.code || !v.coverUrl || v.ruleLearned) continue;
    if (rememberRule(rules, v.code, v.coverUrl)) added++;
    v.ruleLearned = true;
  }
  if (added) store.save();
  return added;
}

// 설정 화면용 규칙 목록
function coverRuleList() {
  return Object.entries(store.data.coverRules).flatMap(([label, list]) => list.map((r, i) => ({
    label, index: i, hits: r.hits || 0, manual: !!r.manual, example: describeRule(label, r),
  }))).sort((a, b) => a.label.localeCompare(b.label));
}

// 등록한 폴더를 모두 다시 읽는다 (새 파일 추가, 사라진 파일 표시, 이름 바뀐 파일 정보 이어 붙이기)
async function rescanAll() {
  const newIds = new Set();
  let missing = 0;
  for (const f of store.folders) {
    if (!fs.existsSync(f.path)) continue; // 외장 드라이브가 빠져 있으면 건너뜀 (정보는 그대로 둠)
    const r = await scanFolder(store, f, existingCover, newIds);
    missing += r.missing;
  }
  const moved = reconcileMoves(store, newIds);
  store.save(true);
  return { added: newIds.size - moved, moved, missing: Math.max(0, missing - moved) };
}

// ---------------------------------------------------------------- 정리하기

async function fetchImage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return { ok: false, status: res.status, url: res.url, buffer: null };
    return { ok: true, status: res.status, url: res.url, buffer: Buffer.from(await res.arrayBuffer()) };
  } finally {
    clearTimeout(t);
  }
}

const isBlocked = (name) => (store.settings.blockedActors || []).includes(name);

// 이름 대응표: 배우(일본어 이름 → 한국어), 제작사·레이블(영어 → 한국어). 한 번 정하면 다음 작품부터 그대로 쓴다
function nameMaps() {
  const n = store.data.names || (store.data.names = {});
  for (const k of ['actors', 'maker', 'label', 'series', 'director', 'genre']) n[k] = n[k] || {};
  return n;
}

// 같은 품번 앞글자(예: SONE)로 예전에 받아 둔 한국어 제작사·레이블 이름 (r18.dev·품번기는 영어·일본어라 분류가 갈라지지 않게)
function knownNamesForPrefix(code) {
  const prefix = String(code || '').split('-')[0];
  if (!prefix) return null;
  const hit = Object.values(store.videos).find((o) => o.status === 'done' && (!o.infoSource || o.infoSource === 'avdbs')
    && String(o.code || '').split('-')[0] === prefix && (o.maker || o.label));
  return hit ? { maker: hit.maker, label: hit.label } : null;
}

function koreanMakerLabel(code, d) {
  const maps = nameMaps();
  let maker = (d.maker && maps.maker[d.maker]) || '';
  let label = (d.label && maps.label[d.label]) || '';
  if (!maker || !label) {
    const k = knownNamesForPrefix(code);
    if (k) {
      if (!maker && k.maker) { maker = k.maker; if (d.maker) maps.maker[d.maker] = k.maker; }
      if (!label && k.label) { label = k.label; if (d.label) maps.label[d.label] = k.label; }
    }
  }
  return { maker: maker || d.maker || '', label: label || d.label || '' };
}

/**
 * r18.dev 배우 이름을 한국어로 정한다.
 *  1) 전에 정해 둔 이름(일본어 이름 기준) → 2) 라이브러리에 같은 이름의 배우 → 3) 품번기의 한국어 이름과 맞춰 보기
 *  → 4) 그래도 없으면 읽는 법(가나)을 한글로 바꾼 이름
 */
// 영어(로마자) 이름 비교용: 순서·장음 표기 차이 무시 (Aika Yamagishi = Yamagishi Aika = Aika Yamagisi)
const romajiKey = (r) => String(r || '').toLowerCase().split(/[^a-z]+/).filter(Boolean).map(normRomaji).sort().join(' ');

async function resolveActorNames(code, info, ctx, log, prevNames = []) {
  const maps = nameMaps();
  const compact = (n) => String(n || '').replace(/\s+/g, '');
  // 이미 있는 배우 찾기: 일본어(한자) 이름 → 영어 이름 → 한국어 이름(바꾸기 전 이름 포함)
  const byJa = {};
  const byRomaji = {};
  const byName = {};
  for (const a of Object.values(store.actors)) {
    if (a.ja) byJa[a.ja] = a.name;
    if (a.romaji) byRomaji[romajiKey(a.romaji)] = a;
    for (const n of [a.name, ...(a.aliases || [])]) if (n) byName[compact(n)] = a.name;
  }
  const pending = [];
  // 예전(avdbs)에 받아 둔 영상을 새로 받을 때: 그때의 한국어 배우 이름을 그대로 쓰고 기억한다
  // (배우 사진·별점·즐겨찾기가 그 이름에 붙어 있으므로 이름이 바뀌지 않게)
  const prev = prevNames.filter(Boolean);
  const matchedPrev = new Map();
  if (prev.length) {
    if (prev.length === 1 && info.actors.length === 1) matchedPrev.set(info.actors[0], prev[0]);
    else {
      const used = new Set();
      for (const a of info.actors) {
        let best = null, score = 0;
        for (const n of prev) { if (used.has(n)) continue; const sc = nameSimilarity(a.name, n); if (sc > score) { best = n; score = sc; } }
        if (best && score >= 0.5) { matchedPrev.set(a, best); used.add(best); }
      }
    }
  }
  for (const a of info.actors) {
    if (matchedPrev.has(a)) {
      a.name = matchedPrev.get(a);
      continue;
    }
    const rom = a.romaji && byRomaji[romajiKey(a.romaji)];
    const known = (a.ja && (maps.actors[a.ja] || byJa[a.ja]))
      // 영어 이름이 같아도 일본어 이름이 서로 다르게 알려져 있으면 다른 사람으로 본다
      || (rom && (!rom.ja || !a.ja || rom.ja === a.ja) ? rom.name : null)
      || byName[compact(a.name)];
    if (known) a.name = known;
    else pending.push(a);
  }
  if (pending.length && store.settings.usePoomki && !ctx.skipPoomki) {
    try {
      const r = await poomkiLookup(code);
      if (r.found) {
        const ko = r.data.actors;
        for (const a of pending) {
          let best = null, score = 0;
          for (const p of ko) { const sc = nameSimilarity(a.name, p.name); if (sc > score) { best = p; score = sc; } }
          if (best && (score >= 0.5 || (pending.length === 1 && ko.length === 1))) {
            if (best.name !== a.name) log(`  └ 배우 이름: ${a.ja || a.name} → ${best.name} (품번기)`);
            a.name = best.name;
            if (best.photo) a.photoKo = best.photo;
          }
        }
      } else if (r.blocked) {
        ctx.skipPoomki = true;
        log('품번기가 접속을 막아서 이번 정리에서는 품번기 확인을 멈춰요 (배우 이름은 읽는 법으로 적어요).');
      }
    } catch (_) { /* 읽는 법으로 만든 이름 사용 */ }
  }
  for (const a of info.actors) if (a.ja) maps.actors[a.ja] = a.name;
}

function applyInfo(v, d, { legacy = false } = {}) {
  if (v.locked) return; // 사용자가 직접 고친 영상은 덮어쓰지 않음
  d.actors = d.actors.filter((a) => !isBlocked(a.name)); // 지운 배우는 다시 넣지 않음
  const maps = nameMaps();
  // 예전(avdbs) 정보를 새로 받을 때: 그때의 한국어 제작사·레이블·시리즈·감독 이름을 기억해서 계속 쓴다
  if (legacy) {
    const learn = (kind, from, ko) => { if (from && ko && hasHangul(ko) && !maps[kind][from]) maps[kind][from] = ko; };
    learn('maker', d.maker, v.maker);
    learn('label', d.label, v.label);
    learn('series', d.series, v.series);
    learn('director', d.director, v.director);
  }
  const ml = koreanMakerLabel(v.code, d);
  const oldTitle = v.title;
  // 전에 번역해 둔 제목의 원문(일본어, 없으면 영어)이 그대로면 번역을 다시 하지 않음
  const sameJa = d.titleJa ? d.titleJa === v.titleJa : !!(d.title && d.title === v.titleEn);
  if (legacy && oldTitle) { v.title = oldTitle; v.titleKo = v.titleKo || oldTitle; } // 예전 한국어 제목은 그대로
  else if (v.titleKo && sameJa) v.title = v.titleKo; // 전에 번역해 둔 제목
  else { v.titleKo = ''; v.title = d.title || oldTitle; } // 번역 전에는 영어 제목 (processVideo에서 번역)
  v.titleEn = d.source === 'r18' ? d.title : (v.titleEn || '');
  v.titleJa = d.titleJa || '';
  v.seriesJa = d.seriesJa || '';
  // 새 정보에 배우가 없으면(예: r18.dev에 출연 정보가 빈 작품) 전에 받아 둔 배우는 남긴다
  v.actors = d.actors.length ? d.actors.map((a) => a.name) : (v.actors || []).filter((n) => !isBlocked(n));
  v.maker = ml.maker;
  v.label = ml.label;
  v.series = (d.series && maps.series[d.series]) || d.series || '';
  v.director = (d.director && maps.director[d.director]) || d.director || '';
  v.releaseDate = d.releaseDate || '';
  v.runtime = d.runtime || null;
  v.genres = d.genres || [];
  v.story = d.story || v.story || ''; // r18.dev에는 줄거리가 없어서 예전 줄거리는 남긴다
  v.r18Id = d.contentId || null;
  v.poomkiId = d.poomkiId || null;
  v.infoSource = d.source;
  for (const a of d.actors) {
    store.ensureActor(a.name, { ja: a.ja, kana: a.kana, romaji: a.romaji, r18Id: a.r18Id, photoUrl: a.photoKo || a.photo, photoUrl2: a.photoKo ? a.photo : '' });
  }
}

// 배우 사진 저장 (url은 여러 개를 줄 수 있음: 앞에서부터 되는 것)
async function saveActorPhoto(name, urls) {
  const actor = store.actors[name];
  if (!actor || (actor.photo && fs.existsSync(actor.photo))) return true;
  for (const url of [].concat(urls || []).filter(Boolean)) {
    try {
      const res = await fetchImage(url);
      if (!res.ok || !res.buffer || /printing|noimage/i.test(res.url || '')) continue; // 사진 없음 대체 이미지
      const isWebp = res.buffer.length > 12 && res.buffer.toString('ascii', 0, 4) === 'RIFF' && res.buffer.toString('ascii', 8, 12) === 'WEBP';
      if (!isWebp) {
        const size = imageSize(res.buffer);
        if (!size || size.width < 60 || size.height < 60) continue;
      }
      fs.mkdirSync(actorPhotoDir(), { recursive: true });
      const file = path.join(actorPhotoDir(), (actor.idx || name).toString().replace(/[\\/:*?"<>|]/g, '_') + (isWebp ? '.webp' : '.jpg'));
      fs.writeFileSync(file, res.buffer);
      actor.photo = file;
      return true;
    } catch (_) { /* 다음 주소 */ }
  }
  return false;
}

// 사진 없는 배우들의 사진 받기
//  1) 전에 알아 둔 사진 주소 → 2) 그 배우가 나온 작품을 r18.dev에서 찾아 DMM 배우 사진 주소 알아내기
async function fetchActorPhotos() {
  const counts = {};
  for (const v of Object.values(store.videos)) for (const a of v.actors || []) counts[a] = (counts[a] || 0) + 1;
  const list = Object.keys(counts).map((n) => store.ensureActor(n)).filter((a) => !a.photo || !fs.existsSync(a.photo));
  const total = list.length;
  let got = 0, failed = 0, done = 0;
  const report = (extra = {}) => send('actors:progress', { running: true, done, total, got, failed, ...extra });
  report();
  for (const a of list) {
    if (job.cancelled) break;
    report({ current: a.name });
    let ok = false;
    try {
      if (a.photoUrl) ok = await saveActorPhoto(a.name, [a.photoUrl, a.photoUrl2]);
      // 그 배우가 나온 작품 (혼자 나온 작품을 먼저)
      const works = Object.values(store.videos).filter((x) => x.code && (x.actors || []).includes(a.name))
        .sort((x, y) => (x.actors.length - y.actors.length)).slice(0, 2);
      for (const w of works) {
        if (ok || job.cancelled) break;
        const r = await r18.lookup(w.code, { rules: store.data.coverRules }).catch(() => null);
        await sleep(store.settings.requestDelayMs);
        if (!r || !r.found) continue;
        const cands = r.data.actors;
        let hit = (a.ja && cands.find((c) => c.ja === a.ja)) || null;
        if (!hit && cands.length === 1 && w.actors.length === 1) hit = cands[0];
        if (!hit) {
          const scored = cands.map((c) => ({ c, s: nameSimilarity(a.name, nameToHangul(c.kana, c.romaji)) })).sort((x, y) => y.s - x.s);
          if (scored[0] && scored[0].s >= 0.75) hit = scored[0].c;
        }
        if (hit && hit.photo) {
          if (!a.ja && hit.ja) { a.ja = hit.ja; nameMaps().actors[hit.ja] = a.name; }
          a.photoUrl = hit.photo;
          ok = await saveActorPhoto(a.name, hit.photo);
        }
      }
    } catch (_) { /* 다음 배우 */ }
    if (ok) got++; else failed++;
    done++;
    store.save();
  }
  store.save(true);
  const result = { running: false, finished: true, done, total, got, failed, cancelled: job.cancelled };
  send('actors:progress', result);
  send('library:changed', snapshot());
  return result;
}

const INFO_COPY = ['title', 'titleKo', 'titleBy', 'titleEn', 'titleJa', 'seriesJa', 'actors', 'maker', 'label', 'series', 'director', 'releaseDate', 'runtime', 'genres', 'story', 'avdbsIdx', 'r18Id', 'poomkiId', 'infoSource'];

// 같은 품번의 다른 파일에서 이미 받은 정보와 표지를 그대로 가져온다 (사이트에 다시 묻지 않음)
function reuseFrom(v, donor, log) {
  if (!v.locked) for (const k of INFO_COPY) v[k] = Array.isArray(donor[k]) ? [...donor[k]] : donor[k];
  if (!v.locked) v.actors = (v.actors || []).filter((a) => !isBlocked(a));
  if ((!v.cover || !fs.existsSync(v.cover)) && donor.cover && fs.existsSync(donor.cover)) {
    const target = coverPathFor(v, store.settings.coverMode, appCoversDir());
    try {
      v.cover = path.resolve(target) === path.resolve(donor.cover) ? donor.cover : saveCover(fs.readFileSync(donor.cover), target);
    } catch (_) { v.cover = donor.cover; }
  }
  v.fetchedAt = Date.now();
  v.status = 'done';
  v.lastError = null;
  log(`같은 품번 정보 재사용: ${v.code}`);
}

// 번역 한 번: DeepL 키가 있으면 DeepL, 없거나 DeepL이 안 되면 구글
async function translateText(text, names, ctx, log, from = 'ja') {
  const key = String(store.settings.deeplKey || '').trim();
  if (key && !ctx.deeplOff) {
    const r = await gate.run('deepl', 150, () => translateDeepl(text, key, requestJson, { names, from })).catch(() => ({ text: null, status: 0 }));
    if (r.text) return { text: r.text, by: 'deepl' };
    if (r.status === 403 || r.status === 456) {
      ctx.deeplOff = true;
      log(r.status === 403 ? 'DeepL 키가 맞지 않아서 구글 번역으로 바꿔요 (설정 → 정보 가져올 곳에서 키를 확인해 주세요).'
        : 'DeepL 이번 달 무료 글자 수를 다 써서 구글 번역으로 바꿔요.');
    }
  }
  const t = await gate.run('google', 500, () => translateJaKo(text, fetchJson, { names, from })); // 구글이 너무 잦은 요청을 막지 않게
  return { text: t, by: 'google' };
}

// 제목(과 시리즈 이름)을 일본어 원제에서 한국어로 번역. 실패가 이어지면 이번 정리에서는 멈춘다
const hasHangul = (x) => /[가-힣]/.test(String(x || ''));
// 아직 한국어가 아닌 것: 원제(일본어)가 없어 영어로 남은 제목, 표에 없어 영어로 남은 장르
const needsTranslate = (v) => !v.missing && !v.locked && v.infoSource === 'r18'
  && ((!v.titleKo && (v.titleJa || (v.titleEn && !hasHangul(v.title)))) || (v.genres || []).some((g) => !hasHangul(g)));

// 제목·시리즈·장르를 한국어로 번역. 실패가 이어지면 이번 정리에서는 멈춘다
async function translateVideo(v, log, ctx) {
  if (store.settings.translateTitles === false || ctx.skipTranslate || v.locked) return;
  // 배우 이름은 정해 둔 한국어로 바꿔 넣고 번역 (일본어 이름, 영어 로마자 이름 둘 다)
  const names = (v.actors || []).flatMap((n) => {
    const a = store.actors[n] || {};
    return [{ ja: a.ja, ko: n }, { ja: a.romaji, ko: n }, { ja: a.romaji && a.romaji.split(' ').reverse().join(' '), ko: n }];
  }).filter((x) => x.ja);
  const fail = () => {
    if (++ctx.translateFails >= 3) { ctx.skipTranslate = true; log('번역이 계속 실패해서 이번 정리에서는 번역을 멈춰요 (다음 정리 때 다시 시도해요).'); }
  };
  try {
    if (!v.titleKo && (v.titleJa || (v.titleEn && !hasHangul(v.title)))) {
      // 일본어 원제가 없는 작품(예: SOD)은 영어 제목을 번역
      const from = v.titleJa ? 'ja' : 'en';
      const r = await translateText(v.titleJa || v.titleEn, names, ctx, log, from);
      if (r.text) { v.titleKo = r.text; v.title = r.text; v.titleBy = r.by; ctx.translateFails = 0; } else fail();
    }
    const maps = nameMaps();
    if (v.series && !hasHangul(v.series) && !ctx.skipTranslate) {
      const key = v.series;
      if (!maps.series[key]) {
        const r = await translateText(v.seriesJa || v.series, names, ctx, log, v.seriesJa ? 'ja' : 'en');
        if (r.text) maps.series[key] = r.text; else fail();
      }
      if (maps.series[key]) v.series = maps.series[key];
    }
    // 장르 표에 없어 영어로 남은 장르 (한 번 번역하면 기억)
    if ((v.genres || []).some((g) => !hasHangul(g)) && !ctx.skipTranslate) {
      const out = [];
      for (const g of v.genres) {
        if (hasHangul(g) || /^[A-Z0-9]{1,4}$/.test(g)) { out.push(g); continue; } // 3P·4K·VR 같은 건 그대로
        if (!maps.genre[g] && !ctx.skipTranslate) {
          const r = await translateText(g, [], ctx, log, 'en');
          if (r.text) maps.genre[g] = r.text; else fail();
        }
        out.push(maps.genre[g] || g);
      }
      v.genres = [...new Set(out)];
    }
  } catch (_) { fail(); }
}

// 정보가 일부만 있는 영상: r18.dev에 아직 없어서 품번기 정보(제목·장르 없음)만 받았거나, 예전(avdbs) 정보에 제목이 없던 것
const isPartial = (v) => v.status === 'done' && !v.locked
  && (v.infoSource === 'poomki' || ((!v.infoSource || v.infoSource === 'avdbs') && !v.title));
const PARTIAL_RETRY_MS = 12 * 3600 * 1000; // 이런 영상은 정리할 때 12시간에 한 번씩 r18.dev에 다시 물어본다

async function processVideo(v, log, ctx) {
  if (!v.code) { v.status = 'nocode'; log(`품번을 찾지 못함: ${v.fileName}`); return; }

  const partial = isPartial(v);
  const donor = ctx.fresh.get(v.code) || (ctx.mode !== 'all' && ctx.mode !== 'legacy'
    ? Object.values(store.videos).find((o) => o.id !== v.id && o.code === v.code && o.status === 'done' && !isPartial(o))
    : null);
  if (donor) { reuseFrom(v, donor, log); return; }

  let info = null;
  // 예전(avdbs)에 받아 둔 영상인지: 그때의 한국어 이름들을 그대로 이어 쓰기 위해
  const legacy = v.status === 'done' && (!v.infoSource || v.infoSource === 'avdbs' || v.infoSource === 'poomki');
  const prevActors = legacy ? [...(v.actors || [])] : [];
  // 1) r18.dev (주 정보원)
  let r18Trouble = !!ctx.skipR18 && store.settings.useR18 !== false; // r18.dev에 못 물어본 경우 (없는 작품과 구분)
  if (store.settings.useR18 !== false && !ctx.skipR18) {
    try {
      const r = await r18.lookup(v.code, { rules: store.data.coverRules });
      if (r.found) info = r.data;
      else {
        log(`r18.dev에서 찾지 못함: ${v.code} (${r.reason})`);
        v.lastError = r.reason;
        if (r.blocked) { ctx.skipR18 = true; log('r18.dev가 접속을 막아서 이번 정리에서는 r18.dev 검색을 멈춰요.'); }
        r18Trouble = !!(r.transient || r.blocked);
      }
    } catch (e) {
      log(`r18.dev 오류: ${v.code} — ${e.message}`);
      v.lastError = e.message;
      r18Trouble = true;
    }
    if (info) await resolveActorNames(v.code, info, ctx, log, prevActors);
  }

  // r18.dev에 연결이 안 됐으면 품번기 정보(제목·장르 없음)로 채우지 않고, 다음 정리 때 다시 r18.dev부터
  if (!info && r18Trouble) {
    if (!partial && v.status !== 'done') v.status = 'error';
    return;
  }

  // 일부 정보만 있는 영상을 다시 물었는데 r18.dev에 아직 없으면: 있던 정보는 그대로 두고 다음에 다시
  if (!info && partial) {
    v.partialTriedAt = Date.now();
    v.lastError = null;
    return;
  }

  // 2) 품번기 (r18.dev에 없는 작품)
  if (!info && store.settings.usePoomki && !ctx.skipPoomki) {
    try {
      const r = await poomkiLookup(v.code);
      if (r.found) info = r.data;
      else {
        log(`품번기에서도 찾지 못함: ${v.code} (${r.reason})`);
        if (r.blocked) { ctx.skipPoomki = true; log('품번기가 접속을 막아서 이번 정리에서는 품번기 검색을 멈춰요.'); }
      }
    } catch (e) {
      log(`품번기 오류: ${v.code} — ${e.message}`);
    }
  }

  if (info) {
    applyInfo(v, info, { legacy });
    if (info.source === 'r18') await translateVideo(v, log, ctx);
    const from = info.source === 'r18' ? 'r18.dev' : '품번기';
    log(`정보 가져옴(${from}): ${v.code} · ${v.actors.join(', ') || '배우 정보 없음'} · ${v.label || v.maker || '-'}`);
  }

  if (!v.cover || !fs.existsSync(v.cover)) v.cover = existingCover(v);
  if (!v.cover) {
    // r18.dev가 알려 준 표지 주소를 먼저, 없으면 품번으로 주소를 만들어 찾기
    const found = await findCover(v.code, fetchImage, { signal: job, rules: store.data.coverRules, extraUrls: (info && info.coverUrls) || [] });
    if (found) {
      // 찾은 주소에서 규칙을 배워 둔다 → 같은 레이블의 다음 작품은 첫 시도에 찾음
      rememberRule(store.data.coverRules, v.code, found.url);
      const target = coverPathFor(v, store.settings.coverMode, appCoversDir());
      try {
        v.cover = saveCover(found.buffer, target);
        v.coverUrl = found.url;
        log(`표지 저장: ${v.code} → ${target}`);
      } catch (e) {
        log(`표지 저장 실패: ${v.code} — ${e.message}`);
      }
    } else if (!job.cancelled) {
      log(`표지를 찾지 못함: ${v.code}`);
    }
  }

  if (info) {
    for (const a of info.actors) {
      const name = isBlocked(a.name) ? null : a.name;
      const urls = [a.photoKo, a.photo, info.actors.length === 1 ? info.actorPhoto : ''].filter(Boolean);
      if (name && urls.length) await saveActorPhoto(name, urls);
    }
  }

  v.fetchedAt = Date.now();
  v.status = info ? 'done' : v.cover ? 'coveronly' : 'notfound';
  if (info) { v.lastError = null; ctx.fresh.set(v.code, v); }
}

// 정리 대상 고르기: new = 아직 시도 안 한 영상, retry = 정보를 못 찾은 영상, all = 전부
function pickTargets(mode) {
  const live = Object.values(store.videos).filter((v) => !v.missing);
  if (mode === 'all') return live;
  if (mode === 'retry') return live.filter((v) => ['notfound', 'coveronly', 'error'].includes(v.status));
  if (mode === 'translate') return []; // 제목 번역만 (아래 번역 단계에서 처리)
  // 예전(avdbs)에 받아 둔 영상을 r18.dev로 새로 받기
  if (mode === 'legacy') return live.filter((v) => v.code && v.status === 'done' && (!v.infoSource || v.infoSource === 'avdbs'));
  // 새 영상 + 표지 없는 영상 + 정보가 일부만 있는 영상(12시간에 한 번 r18.dev에 다시 확인)
  return live.filter((v) => v.status === 'new' || v.status === 'error' || (v.status === 'done' && !v.cover)
    || (v.code && isPartial(v) && Date.now() - (v.partialTriedAt || 0) > PARTIAL_RETRY_MS));
}

async function runOrganize({ mode = 'new', ids = null } = {}) {
  if (job.running) return { ok: false, message: '이미 정리 중이에요' };
  job.running = true;
  job.cancelled = false;

  try {
    return await organizeBody(mode, ids);
  } finally {
    job.running = false;
  }
}

async function organizeBody(mode, ids) {
  const log = (m) => send('organize:progress', { log: m });
  send('organize:progress', { reset: true, running: true, done: 0, total: 0, current: '폴더 다시 읽는 중' });

  if (!ids && mode !== 'translate') {
    const r = await rescanAll();
    log(`폴더 다시 읽기: 새 영상 ${r.added}개${r.moved ? `, 이름·위치 바뀐 영상 ${r.moved}개 정보 이어 붙임` : ''}${r.missing ? `, 사라진 파일 ${r.missing}개` : ''}`);
    send('library:changed', snapshot());
  }

  const list = ids ? Object.values(store.videos).filter((v) => ids.includes(v.id)) : pickTargets(mode);
  const total = list.length;
  const ctx = { mode, fresh: new Map(), skipR18: false, skipPoomki: false, skipTranslate: false, translateFails: 0, deeplOff: false };
  send('organize:progress', { done: 0, total, current: '' });
  if (!total && mode !== 'translate') log('정리할 영상이 없어요.');

  // 여러 영상을 동시에 처리 (사이트마다 요청은 SiteGate가 차례대로)
  let done = 0;
  let next = 0;
  const working = new Set();
  const worker = async () => {
    while (!job.cancelled && next < list.length) {
      const v = list[next++];
      working.add(v.code || v.fileName);
      send('organize:progress', { done, total, current: [...working].join(', ') });
      try {
        await processVideo(v, log, ctx);
      } catch (e) {
        v.status = 'error';
        v.lastError = e.message;
        log(`오류: ${v.fileName} — ${e.message}`);
      }
      working.delete(v.code || v.fileName);
      store.save();
      send('video:changed', v);
      done++;
      send('organize:progress', { done, total, current: [...working].join(', ') });
    }
  };
  await Promise.all(Array.from({ length: Math.min(ORGANIZE_WORKERS, list.length) }, worker));
  // 전에 번역을 못 한 제목이 있으면 이어서 번역 (사이트에는 다시 묻지 않음)
  if (!job.cancelled && store.settings.translateTitles !== false && !ctx.skipTranslate) {
    const rest = Object.values(store.videos).filter(needsTranslate).slice(0, 500);
    let n = 0;
    for (const x of rest) {
      if (job.cancelled || ctx.skipTranslate) break;
      send('organize:progress', { current: `제목 번역 ${n + 1}/${rest.length}` });
      await translateVideo(x, log, ctx);
      n++; send('video:changed', x); store.save();
    }
    if (n) log(`제목·장르 번역: ${n}개`);
  }
  store.save(true);
  const summary = { done, total, cancelled: job.cancelled };
  send('organize:progress', { running: false, finished: true, ...summary });
  send('library:changed', snapshot());
  return { ok: true, ...summary };
}

// ---------------------------------------------------------------- IPC

const INFO_FIELDS = ['code', 'title', 'actors', 'maker', 'label', 'series', 'director', 'releaseDate', 'runtime', 'genres'];
const USER_FIELDS = ['rating', 'favorite', 'memo'];

function registerIpc() {
  ipcMain.handle('lib:get', () => snapshot());

  ipcMain.handle('folder:add', async () => {
    const r = await dialog.showOpenDialog(win, { title: '영상 폴더 선택', properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled) return snapshot();
    for (const p of r.filePaths) {
      let f = store.folders.find((x) => path.resolve(x.path).toLowerCase() === path.resolve(p).toLowerCase());
      if (!f) {
        f = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), path: p, addedAt: Date.now() };
        store.folders.push(f);
      }
      const newIds = new Set();
      await scanFolder(store, f, existingCover, newIds);
      reconcileMoves(store, newIds);
    }
    store.save(true);
    return snapshot();
  });

  // 끌어다 놓기: 폴더는 폴더로 등록, 영상 파일은 그 파일만 등록. 새로 들어온 영상 id를 돌려준다.
  ipcMain.handle('files:add', async (_e, paths) => {
    const exts = new Set(store.settings.extensions.map((x) => x.toLowerCase()));
    const norm = (p) => path.resolve(p).toLowerCase();
    const inside = (file, dir) => norm(file).startsWith(norm(dir) + path.sep.toLowerCase());
    const newIds = new Set();
    const touched = new Set();
    let skipped = 0;
    for (const p of paths || []) {
      let st;
      try { st = fs.statSync(p); } catch { skipped++; continue; }
      if (st.isDirectory()) {
        let f = store.folders.find((x) => !x.only && norm(x.path) === norm(p));
        if (!f) {
          f = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), path: p, addedAt: Date.now() };
          store.folders.push(f);
        }
        touched.add(f);
        continue;
      }
      if (!exts.has(path.extname(p).slice(1).toLowerCase())) { skipped++; continue; }
      // 이미 등록한 폴더 안의 파일이면 그 폴더만 다시 읽음
      const parent = store.folders.find((x) => !x.only && inside(p, x.path));
      if (parent) { touched.add(parent); continue; }
      // 아니면 그 파일만 담는 항목에 추가 (같은 폴더에서 온 파일끼리 묶음)
      const dir = path.dirname(p);
      let f = store.folders.find((x) => x.only && norm(x.path) === norm(dir));
      if (!f) {
        f = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), path: dir, only: [], addedAt: Date.now() };
        store.folders.push(f);
      }
      if (!f.only.some((x) => norm(x) === norm(p))) f.only.push(p);
      touched.add(f);
    }
    for (const f of touched) await scanFolder(store, f, existingCover, newIds);
    reconcileMoves(store, newIds);
    store.save(true);
    const ids = [...newIds].filter((id) => store.videos[id]);
    return { added: ids.length, ids, skipped, library: snapshot() };
  });

  ipcMain.handle('folder:remove', (_e, id) => {
    // 목록에서만 지우고 실제 파일은 그대로 둔다
    store.data.folders = store.folders.filter((f) => f.id !== id);
    for (const v of Object.values(store.videos)) if (v.folderId === id) delete store.videos[v.id];
    store.save(true);
    return snapshot();
  });

  ipcMain.handle('lib:rescan', async () => {
    await rescanAll();
    return snapshot();
  });

  ipcMain.handle('organize:start', (_e, opts) => runOrganize(opts));
  // 구글로 번역한 제목을 DeepL로 다시 번역
  ipcMain.handle('titles:retranslate', () => {
    if (job.running) return { ok: false, message: '이미 정리 중이에요' };
    let n = 0;
    for (const v of Object.values(store.videos)) {
      if (!v.locked && (v.titleJa || v.titleEn) && v.titleBy === 'google') { v.titleKo = ''; n++; }
    }
    if (!n) return { ok: true, count: 0 };
    runOrganize({ mode: 'translate' });
    return { ok: true, count: n };
  });
  ipcMain.handle('deepl:test', async (_e, key) => {
    const k = String(key || store.settings.deeplKey || '').trim();
    if (!k) return { ok: false, message: '키를 넣어 주세요' };
    try { return await deeplUsage(k, requestJson); } catch (e) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('organize:cancel', () => { job.cancelled = true; return true; });

  ipcMain.handle('video:update', (_e, id, patch) => {
    const v = store.videos[id];
    if (!v) return null;
    let infoChanged = false;
    for (const k of [...INFO_FIELDS, ...USER_FIELDS]) {
      if (!(k in patch)) continue;
      v[k] = patch[k];
      if (INFO_FIELDS.includes(k)) infoChanged = true;
    }
    if ('code' in patch) v.code = patch.code ? String(patch.code).toUpperCase().trim() : extractCode(v.fileName);
    if (infoChanged) {
      v.locked = true;
      (v.actors || []).forEach((n) => store.ensureActor(n));
      if (v.status === 'nocode' && v.code) v.status = 'new';
    }
    if ('locked' in patch) v.locked = !!patch.locked;
    store.save();
    return v;
  });

  // 내장 플레이어: 일정 시간 이상 봤을 때 1회
  // 내장 플레이어: ←/→ 건너뛰기를 기준 화면 위치에 맞추기 위한 시각 목록 (MP4만)
  ipcMain.handle('video:keyframes', async (_e, id) => {
    const v = store.videos[id];
    return v ? readKeyframes(v.path) : null;
  });

  // 영상 옆 자막 파일 목록 / 읽기 (그 영상의 자막으로 찾은 파일만 읽어 준다)
  ipcMain.handle('video:subtitles', (_e, id) => {
    const v = store.videos[id];
    if (!v) return [];
    const list = findSubtitles(v.path);
    const has = list.length > 0;
    if (v.hasSub !== has) { v.hasSub = has; store.save(); }
    return list.map(({ file, label, name }) => ({ file, label, name }));
  });
  ipcMain.handle('subtitle:load', (_e, id, file) => {
    const v = store.videos[id];
    if (!v || !findSubtitles(v.path).some((x) => x.file === file)) return null;
    try { return loadSubtitle(file); } catch (e) { return { error: e.message }; }
  });

  // 재생 횟수 직접 고치기 (+1 / -1)
  ipcMain.handle('video:playCount', (_e, id, delta) => {
    const v = store.videos[id];
    if (!v) return null;
    const d = Math.trunc(Number(delta) || 0);
    v.playCount = Math.max(0, (v.playCount || 0) + d);
    if (d > 0) { v.lastPlayed = Date.now(); v.watchPending = 0; }
    store.save();
    return v;
  });

  // 아직 재생 횟수로 세지 않은 시청 시간 (전에 보다 만 시간, 초)
  ipcMain.handle('video:watchPending', (_e, id) => (store.videos[id] && store.videos[id].watchPending) || 0);

  ipcMain.handle('video:played', (_e, id) => {
    const v = store.videos[id];
    if (!v) return null;
    v.playCount = (v.playCount || 0) + 1;
    v.lastPlayed = Date.now();
    v.watchPending = 0; // 합쳐 둔 시청 시간은 1회로 셌으니 비움
    store.save();
    return v;
  });

  // 이어 보기 위치 저장
  ipcMain.handle('video:position', (_e, id, position, duration, watched) => {
    const v = store.videos[id];
    if (!v) return null;
    v.lastPosition = Math.max(0, Math.floor(position || 0));
    // 영상 옆 자막 파일 목록 / 읽기 (그 영상의 자막으로 찾은 파일만 읽어 준다)
  ipcMain.handle('video:subtitles', (_e, id) => {
    const v = store.videos[id];
    if (!v) return [];
    const list = findSubtitles(v.path);
    const has = list.length > 0;
    if (v.hasSub !== has) { v.hasSub = has; store.save(); }
    return list.map(({ file, label, name }) => ({ file, label, name }));
  });
  ipcMain.handle('subtitle:load', (_e, id, file) => {
    const v = store.videos[id];
    if (!v || !findSubtitles(v.path).some((x) => x.file === file)) return null;
    try { return loadSubtitle(file); } catch (e) { return { error: e.message }; }
  });

  // 재생 횟수 직접 고치기 (+1 / -1)
  ipcMain.handle('video:playCount', (_e, id, delta) => {
    const v = store.videos[id];
    if (!v) return null;
    const d = Math.trunc(Number(delta) || 0);
    v.playCount = Math.max(0, (v.playCount || 0) + d);
    if (d > 0) { v.lastPlayed = Date.now(); v.watchPending = 0; }
    store.save();
    return v;
  });

  // 아직 재생 횟수로 세지 않은 시청 시간 (다음에 열면 여기서부터 이어서 더한다)
    if (watched != null && isFinite(watched)) v.watchPending = Math.max(0, Math.round(watched));
    if (duration && isFinite(duration)) v.duration = Math.round(duration);
    store.save();
    return null;
  });

  // 삭제: 기본은 휴지통, permanent면 완전 삭제
  ipcMain.handle('video:delete', async (_e, ids, opts = {}) => {
    const errors = [];
    let deleted = 0;
    for (const id of ids) {
      const v = store.videos[id];
      if (!v) continue;
      try {
        if (fs.existsSync(v.path)) {
          if (opts.permanent) await fs.promises.unlink(v.path);
          else await shell.trashItem(v.path);
        }
      } catch (e) {
        errors.push(`${v.fileName}: ${e.message}`);
        continue;
      }
      // 표지는 다른 영상이 같이 쓰고 있지 않을 때만 지운다
      if (opts.withCover && v.cover && fs.existsSync(v.cover)
        && !Object.values(store.videos).some((o) => o.id !== id && o.cover === v.cover)) {
        try { if (opts.permanent) await fs.promises.unlink(v.cover); else await shell.trashItem(v.cover); } catch (_) { /* 표지는 실패해도 됨 */ }
      }
      delete store.videos[id];
      for (const pl of store.playlists) pl.items = pl.items.filter((x) => x !== id);
      deleted++;
    }
    store.save(true);
    return { deleted, errors, library: snapshot() };
  });

  ipcMain.handle('playlists:save', (_e, playlists) => {
    store.data.playlists = (playlists || []).map((p) => ({
      id: String(p.id), name: String(p.name || '재생목록').slice(0, 100), createdAt: p.createdAt || Date.now(),
      items: Array.from(new Set((p.items || []).filter((x) => store.videos[x]))),
    }));
    store.save();
    return store.playlists;
  });

  ipcMain.handle('video:play', async (_e, id) => {
    const v = store.videos[id];
    if (!v) return 'not found';
    const err = await shell.openPath(v.path);
    if (!err) { v.playCount = (v.playCount || 0) + 1; v.lastPlayed = Date.now(); store.save(); }
    return err || null;
  });

  // 여러 영상을 기본 앱(곰플레이어·팟플레이어·VLC 등)에서 재생목록으로 열기: .m3u8 재생목록 파일을 만들어 연다
  ipcMain.handle('videos:playExternal', async (_e, ids, name) => {
    const list = (ids || []).map((id) => store.videos[id]).filter((v) => v && !v.missing && fs.existsSync(v.path));
    if (!list.length) return { ok: false, message: '열 수 있는 영상이 없어요' };
    const dir = path.join(dataDir(), 'playlists');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(name || '재생목록').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '재생목록';
    const file = path.join(dir, `${safe}.m3u8`);
    const lines = ['#EXTM3U'];
    for (const v of list) {
      lines.push(`#EXTINF:${v.duration ? Math.round(v.duration) : -1},${[v.code, v.title].filter(Boolean).join(' ') || v.fileName}`);
      lines.push(v.path);
    }
    fs.writeFileSync(file, lines.join('\r\n') + '\r\n', 'utf8');
    const err = await shell.openPath(file);
    return err ? { ok: false, message: `기본 앱으로 열지 못했어요: ${err}` } : { ok: true, count: list.length, file };
  });

  ipcMain.handle('video:reveal', (_e, id) => {
    const v = store.videos[id];
    if (v) shell.showItemInFolder(v.path);
  });

  ipcMain.handle('video:refetch', async (_e, id) => {
    const v = store.videos[id];
    if (!v) return null;
    v.locked = false;
    return runOrganize({ ids: [id], mode: 'all' });
  });

  ipcMain.handle('video:chooseCover', async (_e, id) => {
    const v = store.videos[id];
    if (!v) return null;
    const r = await dialog.showOpenDialog(win, {
      title: '표지 이미지 선택', properties: ['openFile'],
      filters: [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (r.canceled) return v;
    const target = coverPathFor(v, store.settings.coverMode, appCoversDir());
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (path.resolve(r.filePaths[0]) !== path.resolve(target)) fs.copyFileSync(r.filePaths[0], target);
    v.cover = target;
    v.coverVersion = Date.now();
    store.save();
    return v;
  });

  ipcMain.handle('actor:update', (_e, name, patch) => {
    const a = store.ensureActor(name);
    for (const k of ['memo', 'rating', 'favorite']) if (k in patch) a[k] = patch[k];
    store.save();
    return a;
  });

  // 배우 이름 바꾸기. 바꾼 이름의 배우가 이미 있으면 둘을 하나로 합친다.
  // 예전 이름은 다른 이름(aliases)으로 남기고, 일본어·영어 이름 대응도 새 이름으로 옮겨서 앞으로 받는 작품도 새 이름으로
  ipcMain.handle('actor:rename', (_e, oldName, newName) => {
    const to = String(newName || '').replace(/\s+/g, ' ').trim();
    if (!to || to === oldName) return { ok: false, library: snapshot() };
    for (const v of Object.values(store.videos)) {
      if (v.actors && v.actors.includes(oldName)) v.actors = [...new Set(v.actors.map((n) => (n === oldName ? to : n)))];
    }
    const from = store.actors[oldName] || { name: oldName };
    const target = store.actors[to];
    const merged = !!target;
    const a = target || { ...from, name: to };
    if (target) {
      for (const k of ['ja', 'kana', 'romaji', 'r18Id', 'photoUrl', 'photoUrl2', 'idx', 'poomkiIdx']) if (!a[k] && from[k]) a[k] = from[k];
      if ((!a.photo || !fs.existsSync(a.photo)) && from.photo) a.photo = from.photo;
      a.favorite = !!(a.favorite || from.favorite);
      a.rating = Math.max(a.rating || 0, from.rating || 0);
      if (from.memo && !String(a.memo || '').includes(from.memo)) a.memo = [a.memo, from.memo].filter(Boolean).join('\n');
    }
    a.aliases = [...new Set([...(a.aliases || []), ...(from.aliases || []), oldName])].filter((x) => x && x !== to);
    delete store.actors[oldName];
    store.actors[to] = a;
    const maps = nameMaps();
    for (const [ja, ko] of Object.entries(maps.actors)) if (ko === oldName) maps.actors[ja] = to;
    if (from.ja) maps.actors[from.ja] = to;
    store.save(true);
    return { ok: true, merged, library: snapshot() };
  });

  // 배우 이름 지우기: 모든 영상의 출연 정보에서 이름을 빼고 배우 목록에서도 지운다 (영상 파일은 그대로)
  ipcMain.handle('actor:remove', (_e, name, opts = {}) => {
    let count = 0;
    for (const v of Object.values(store.videos)) {
      if (v.actors && v.actors.includes(name)) { v.actors = v.actors.filter((a) => a !== name); count++; }
    }
    delete store.actors[name];
    if (opts.block) {
      const list = new Set(store.settings.blockedActors || []);
      list.add(name);
      store.settings.blockedActors = [...list];
    }
    store.save(true);
    return { count, library: snapshot() };
  });

  // 막아 둔 이름 풀기
  ipcMain.handle('actor:unblock', (_e, name) => {
    store.settings.blockedActors = (store.settings.blockedActors || []).filter((x) => x !== name);
    store.save();
    return store.settings;
  });

  ipcMain.handle('actors:fetchPhotos', async () => {
    if (job.running) return { ok: false, message: '다른 작업(정리하기)이 끝난 뒤에 해 주세요' };
    job.running = true;
    job.cancelled = false;
    try { return { ok: true, ...(await fetchActorPhotos()) }; } finally { job.running = false; }
  });

  ipcMain.handle('actor:choosePhoto', async (_e, name) => {
    const a = store.ensureActor(name);
    const r = await dialog.showOpenDialog(win, {
      title: '배우 사진 선택', properties: ['openFile'],
      filters: [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (r.canceled) return a;
    fs.mkdirSync(actorPhotoDir(), { recursive: true });
    const file = path.join(actorPhotoDir(), name.replace(/[\\/:*?"<>|]/g, '_') + '-' + Date.now() + path.extname(r.filePaths[0]));
    fs.copyFileSync(r.filePaths[0], file);
    a.photo = file;
    store.save();
    return a;
  });

  // 이미 받은 표지를 지금 설정한 저장 위치로 옮긴다.
  // 이 프로그램이 만든 이름(품번.jpg)인 표지만 옮기고, 다른 이름의 이미지는 건드리지 않는다.
  ipcMain.handle('covers:relocate', async () => {
    const mode = store.settings.coverMode;
    let moved = 0, skipped = 0, failed = 0;
    const list = Object.values(store.videos).filter((v) => v.cover && v.code);
    for (const v of list) {
      const target = coverPathFor(v, mode, appCoversDir());
      const old = v.cover;
      if (path.resolve(old).toLowerCase() === path.resolve(target).toLowerCase()) continue;
      const ours = path.parse(old).name.toUpperCase() === v.code.replace(/[\\/:*?"<>|]/g, '_').toUpperCase();
      if (!ours || !fs.existsSync(old)) { skipped++; continue; }
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (!fs.existsSync(target)) {
          try { fs.renameSync(old, target); } catch (e) {
            if (e.code !== 'EXDEV') throw e;
            fs.copyFileSync(old, target); fs.unlinkSync(old); // 다른 드라이브로 옮길 때
          }
        }
        v.cover = target;
        v.coverVersion = Date.now();
        // 같은 표지를 쓰던 다른 영상도 새 위치를 가리키게
        for (const o of list) if (o !== v && o.cover === old) { o.cover = target; o.coverVersion = v.coverVersion; }
        if (fs.existsSync(old) && !Object.values(store.videos).some((o) => o.cover === old)) fs.unlinkSync(old);
        // 비게 된 covers 폴더 정리
        const oldDir = path.dirname(old);
        if (path.basename(oldDir).toLowerCase() === 'covers' && fs.readdirSync(oldDir).length === 0) fs.rmdirSync(oldDir);
        moved++;
      } catch (_) { failed++; }
    }
    store.save(true);
    return { moved, skipped, failed, library: snapshot() };
  });

  // 표지 규칙 직접 넣기: 예) 품번 ABC-123의 실제 표지 주소를 넣으면 규칙을 뽑아 기억
  ipcMain.handle('coverRules:addFromUrl', (_e, code, url) => {
    const c = String(code || '').trim().toUpperCase();
    if (!parseCode(c)) return { ok: false, message: '품번을 ABC-123 형태로 넣어 주세요' };
    const rule = learnRule(c, String(url || '').trim());
    if (!rule) return { ok: false, message: '주소에서 규칙을 읽지 못했어요. pics.dmm.co.jp/…/…pl.jpg 형태의 표지 주소를 넣어 주세요' };
    rememberRule(store.data.coverRules, c, String(url).trim());
    const list = store.data.coverRules[parseCode(c).label];
    const r = list.find((x) => x.path === rule.path && x.prefix === rule.prefix && x.width === rule.width && x.suffix === rule.suffix);
    if (r) { r.manual = true; r.hits = Math.max(r.hits || 0, 1000); } // 직접 넣은 규칙을 가장 먼저 시도
    store.save();
    return { ok: true, rules: coverRuleList() };
  });

  ipcMain.handle('coverRules:remove', (_e, label, index) => {
    const list = store.data.coverRules[label];
    if (list) { list.splice(index, 1); if (!list.length) delete store.data.coverRules[label]; }
    store.save();
    return coverRuleList();
  });

  ipcMain.handle('settings:update', (_e, patch) => {
    Object.assign(store.settings, patch);
    store.save();
    return store.settings;
  });


  ipcMain.handle('app:openDataDir', () => shell.openPath(dataDir()));
  // 표지 폴더 열기: 프로그램 폴더 저장이면 covers 폴더, 영상 옆·covers 폴더 저장이면 가장 최근에 받은 표지가 있는 폴더
  ipcMain.handle('covers:openDir', async () => {
    if (store.settings.coverMode === 'appdata') {
      fs.mkdirSync(appCoversDir(), { recursive: true });
      return shell.openPath(appCoversDir());
    }
    const latest = Object.values(store.videos)
      .filter((v) => v.cover && !v.cover.startsWith(appCoversDir()) && fs.existsSync(v.cover))
      .sort((a, b) => (b.fetchedAt || 0) - (a.fetchedAt || 0))[0];
    if (latest) { shell.showItemInFolder(latest.cover); return ''; }
    const folder = (store.data.folders || []).find((f) => fs.existsSync(f.path));
    return folder ? shell.openPath(folder.path) : shell.openPath(appCoversDir());
  });
  ipcMain.handle('app:openPath', (_e, p) => (p && p.startsWith(dataDir()) ? shell.openPath(p) : null));
}

// ---------------------------------------------------------------- 창

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0e1014',
    title: 'VidShelf',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('http://localhost')) e.preventDefault(); });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // 메인 창을 닫으면 프로그램을 완전히 끈다.
  // (품번기용 보이지 않는 창이 남아 있으면 'window-all-closed'가 오지 않아 뒤에서 계속 돌던 문제)
  win.on('closed', () => {
    win = null;
    if (store) store.save(true);
    poomki.destroy();
    app.quit();
  });
  if (process.env.VIDSHELF_SHOTS) require('./devshot.cjs')(win, app);
}

if (process.env.VIDSHELF_DATA_DIR) app.setPath('userData', process.env.VIDSHELF_DATA_DIR);

// 창은 하나만. 업데이트 도우미가 --vidshelf-restart로 부르면 켜져 있던 창이 새 버전으로 다시 켜지고,
// --vidshelf-quit로 부르면 (구성 요소를 바꾸기 전에) 켜져 있던 창이 닫힌다.
const QUIT_ONLY = process.argv.includes('--vidshelf-quit');
// 켜지자마자 꺼지는 원인을 실행 도우미가 볼 수 있게 표준 출력에 남긴다
const trace = (m) => { try { process.stdout.write(`[VidShelf] ${m}\n`); } catch (_) { /* 무시 */ } };
process.on('uncaughtException', (e) => { trace(`오류: ${e && e.stack ? e.stack : e}`); });
trace(`시작 electron=${process.versions.electron} argv=${JSON.stringify(process.argv.slice(1))}`);

const GOT_LOCK = process.env.VIDSHELF_SHOTS ? true : app.requestSingleInstanceLock();
if (!GOT_LOCK) {
  trace('VIDSHELF_ALREADY_RUNNING');
  app.quit(); // 이미 켜져 있음 → 그 창에 신호만 보내고 끝
} else {
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--vidshelf-quit')) {
      if (store) store.save(true);
      app.quit();
      return;
    }
    if (argv.includes('--vidshelf-restart')) {
      if (store) store.save(true);
      app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--vidshelf-restart') });
      app.exit(0);
      return;
    }
    // 창이 있으면 앞으로, 없으면(뒤에만 남아 있던 경우) 새로 연다
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    else if (app.isReady()) createWindow();
  });
}

app.whenReady().then(() => {
  if (!GOT_LOCK || QUIT_ONLY) { app.quit(); return; } // 신호만 보내는 실행이거나, 닫을 창이 없었으면 끝
  Menu.setApplicationMenu(null);
  store = new Store(dataDir());
  seedCoverRules(); // 예전에 받은 표지 기록으로 표지 규칙 미리 배우기

  // avdbs 기능을 없애면서, 예전에 VidShelf 안에서 로그인해 둔 avdbs 쿠키도 한 번 지운다
  if (!store.settings.avdbsCleared) {
    session.fromPartition('persist:avdbs').clearStorageData().catch(() => {});
    store.settings.avdbsCleared = true;
    store.save();
  }

  protocol.handle('vsmedia', (req) => handleMediaRequest(req, (p) => {
    const r = path.resolve(p).toLowerCase();
    return Object.values(store.videos).some((v) => path.resolve(v.path).toLowerCase() === r);
  }));

  protocol.handle('vsimg', (req) => {
    const p = new URL(req.url).searchParams.get('p') || '';
    if (!/\.(jpe?g|png|webp|gif)$/i.test(p) || !fs.existsSync(p)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(p).toString());
  });

  registerIpc();
  createWindow();
  trace('창 열림');
  win.webContents.on('render-process-gone', (_e, d) => trace(`화면 프로세스 종료: ${d.reason} (${d.exitCode})`));
  win.webContents.on('did-fail-load', (_e, code, desc) => trace(`화면 불러오기 실패: ${code} ${desc}`));

  // 켤 때 폴더를 다시 읽어서 새 파일을 목록에 올린다
  win.webContents.once('did-finish-load', () => {
    trace('VIDSHELF_READY'); // 실행 도우미(검은 창)는 이 줄을 보면 바로 닫힌다
    rescanAll().then(() => send('library:changed', snapshot())).catch(() => {});
  });
});

app.on('child-process-gone', (_e, d) => trace(`보조 프로세스 종료: ${d.type} ${d.reason} (${d.exitCode})`));

app.on('window-all-closed', () => {
  if (store) store.save(true);
  poomki.destroy();
  app.quit();
});
