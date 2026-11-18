// 등록한 폴더에서 영상 파일 목록을 읽는다. 파일은 절대 옮기거나 바꾸지 않는다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractCode } = require('./code.cjs');

const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'covers', 'node_modules']);

function videoId(filePath) {
  return crypto.createHash('sha1').update(path.resolve(filePath).toLowerCase()).digest('hex').slice(0, 16);
}

async function walk(root, exts, onFile) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) stack.push(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (exts.has(ext)) await onFile(full);
      }
    }
  }
}

/**
 * 폴더를 스캔해서 store.videos를 갱신한다.
 * @returns {{added:number, missing:number, total:number}}
 */
async function scanFolder(store, folder, findExistingCover, newIds = new Set()) {
  const exts = new Set(store.settings.extensions.map((x) => x.toLowerCase()));
  const seen = new Set();
  let added = 0;
  // folder.only가 있으면 그 파일들만 (끌어다 놓은 개별 파일), 없으면 폴더 전체
  const visit = folder.only
    ? async (cb) => { for (const f of folder.only) await cb(f); }
    : (cb) => walk(folder.path, exts, cb);
  await visit(async (file) => {
    let st;
    try { st = await fs.promises.stat(file); } catch { return; }
    if (st.size < 1024 * 1024) return; // 1MB 미만(샘플·깨진 파일) 제외
    const id = videoId(file);
    seen.add(id);
    let v = store.videos[id];
    if (!v) {
      const fileName = path.basename(file);
      v = {
        id, path: file, folderId: folder.id, fileName, size: st.size, mtime: st.mtimeMs,
        addedAt: Date.now(), code: extractCode(fileName), status: 'new',
        title: '', actors: [], maker: '', label: '', series: '', director: '', releaseDate: '', runtime: null,
        genres: [], story: '', cover: null, fetchedAt: null,
        rating: 0, favorite: false, memo: '', playCount: 0, lastPlayed: null, missing: false,
      };
      if (!v.code) v.status = 'nocode';
      store.videos[id] = v;
      newIds.add(id);
      added++;
    } else {
      v.size = st.size; v.mtime = st.mtimeMs; v.missing = false; v.folderId = folder.id;
    }
    if (!v.cover || !fs.existsSync(v.cover)) v.cover = findExistingCover(v);
  });
  let missing = 0;
  for (const v of Object.values(store.videos)) {
    if (v.folderId === folder.id && !seen.has(v.id)) { v.missing = true; missing++; }
  }
  store.save();
  return { added, missing, total: seen.size };
}

// 사용자가 남기는 값과 받아온 정보 (이름이 바뀌어도 이어 붙일 항목)
const CARRY = ['code', 'status', 'title', 'actors', 'maker', 'label', 'series', 'director', 'releaseDate', 'runtime',
  'genres', 'story', 'avdbsIdx', 'r18Id', 'poomkiId', 'infoSource', 'titleJa', 'titleKo', 'titleBy', 'titleEn', 'seriesJa', 'fetchedAt', 'rating', 'favorite', 'memo', 'playCount', 'lastPlayed', 'lastPosition',
  'duration', 'locked', 'addedAt', 'lastError', 'coverUrl'];

/**
 * 파일 이름을 바꾸거나 다른 폴더로 옮긴 경우: 새로 발견한 파일과 사라진 파일이
 * 크기가 같고 품번(또는 파일 이름)이 같으면 같은 영상으로 보고 정보를 옮긴다.
 * @returns {number} 이어 붙인 개수
 */
function reconcileMoves(store, newIds) {
  let moved = 0;
  const gone = Object.values(store.videos).filter((v) => !newIds.has(v.id) && (v.missing || !fs.existsSync(v.path)));
  for (const id of newIds) {
    const nv = store.videos[id];
    if (!nv) continue;
    const i = gone.findIndex((o) => o.size === nv.size && ((o.code && o.code === nv.code) || o.fileName === nv.fileName));
    if (i < 0) continue;
    const old = gone.splice(i, 1)[0];
    for (const k of CARRY) if (old[k] !== undefined) nv[k] = old[k];
    // 표지가 영상 옆에 있었다면 새 위치에서 다시 찾고, 없으면 예전 경로라도 유지
    if (!nv.cover && old.cover && fs.existsSync(old.cover)) nv.cover = old.cover;
    for (const pl of store.data.playlists || []) pl.items = pl.items.map((x) => (x === old.id ? nv.id : x));
    delete store.videos[old.id];
    moved++;
  }
  if (moved) store.save();
  return moved;
}

module.exports = { scanFolder, reconcileMoves, videoId };
