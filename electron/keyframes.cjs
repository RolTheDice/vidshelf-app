// MP4 파일의 "기준 화면(키프레임)" 시각 목록을 읽는다.
// 영상은 기준 화면부터 풀어야 그 뒤 화면을 보여 줄 수 있어서, 기준 화면이 아닌 곳으로 건너뛰면
// 앞의 기준 화면부터 다시 풀어야 해 느리다. ←/→ 건너뛰기를 기준 화면 위치에 맞추면 거의 바로 나온다.
// MP4/M4V/MOV만 읽고, 그 밖의 형식이나 읽지 못하면 null (그때는 정확한 위치로 건너뛴다).
const fs = require('fs');

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);

/** 파일에서 맨 위 상자들을 훑어 moov 상자 내용을 읽는다 (mdat가 커도 머리만 읽고 건너뜀) */
async function readMoov(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    let pos = 0;
    const head = Buffer.alloc(16);
    while (pos + 8 <= size) {
      await fh.read(head, 0, 16, pos);
      let boxSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let hdr = 8;
      if (boxSize === 1) { boxSize = Number(head.readBigUInt64BE(8)); hdr = 16; } else if (boxSize === 0) boxSize = size - pos;
      if (boxSize < hdr) return null;
      if (type === 'moov') {
        if (boxSize > 512 * 1024 * 1024) return null;
        const buf = Buffer.alloc(boxSize - hdr);
        await fh.read(buf, 0, buf.length, pos + hdr);
        return buf;
      }
      pos += boxSize;
    }
    return null;
  } finally {
    await fh.close();
  }
}

/** 상자 안의 자식 상자 목록 */
function children(buf, start = 0, end = buf.length) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type, start: p + hdr, end: p + size });
    p += size;
  }
  return out;
}

function find(buf, box, path) {
  let cur = box;
  for (const t of path) {
    cur = children(buf, cur.start, cur.end).find((c) => c.type === t);
    if (!cur) return null;
  }
  return cur;
}

/** moov 내용에서 영상 트랙의 기준 화면 시각(초) 목록 */
function keyframesFromMoov(buf) {
  const root = { start: 0, end: buf.length };
  for (const trak of children(buf).filter((c) => c.type === 'trak')) {
    const hdlr = find(buf, trak, ['mdia', 'hdlr']);
    if (!hdlr || buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue;
    const mdhd = find(buf, trak, ['mdia', 'mdhd']);
    const stbl = find(buf, trak, ['mdia', 'minf', 'stbl']);
    if (!mdhd || !stbl) continue;
    const v = buf.readUInt8(mdhd.start);
    const timescale = buf.readUInt32BE(mdhd.start + (v === 1 ? 20 : 12));
    if (!timescale) continue;
    const kids = children(buf, stbl.start, stbl.end);
    const get = (t) => kids.find((c) => c.type === t);
    const stts = get('stts');
    const stss = get('stss');
    if (!stts) continue;
    if (!stss) return null; // 모든 화면이 기준 화면이거나 정보 없음: 맞출 필요 없음

    // 편집 목록: 화면 표시 시각의 시작 위치
    let shift = 0;
    const elst = find(buf, trak, ['edts', 'elst']);
    if (elst) {
      const ev = buf.readUInt8(elst.start);
      const n = buf.readUInt32BE(elst.start + 4);
      let p = elst.start + 8;
      for (let i = 0; i < n; i++) {
        const mediaTime = ev === 1 ? Number(buf.readBigInt64BE(p + 8)) : buf.readInt32BE(p + 4);
        p += ev === 1 ? 20 : 12;
        if (mediaTime >= 0) { shift = mediaTime; break; } // -1은 빈 구간
      }
    }

    // 기준 화면 번호 (1부터)
    const syncN = buf.readUInt32BE(stss.start + 4);
    const sync = new Array(syncN);
    for (let i = 0; i < syncN; i++) sync[i] = buf.readUInt32BE(stss.start + 8 + i * 4);

    // 화면 번호 → 디코딩 시각 (stts)
    const dts = new Array(syncN);
    {
      const n = buf.readUInt32BE(stts.start + 4);
      let p = stts.start + 8;
      let sample = 1;
      let time = 0;
      let k = 0;
      for (let i = 0; i < n && k < syncN; i++) {
        const count = buf.readUInt32BE(p);
        const delta = buf.readUInt32BE(p + 4);
        p += 8;
        while (k < syncN && sync[k] < sample + count) {
          dts[k] = time + (sync[k] - sample) * delta;
          k++;
        }
        sample += count;
        time += count * delta;
      }
      if (k < syncN) dts.length = k;
    }

    // 표시 시각 보정 (ctts)
    const ctts = get('ctts');
    const off = new Array(dts.length).fill(0);
    if (ctts) {
      const cv = buf.readUInt8(ctts.start);
      const n = buf.readUInt32BE(ctts.start + 4);
      let p = ctts.start + 8;
      let sample = 1;
      let k = 0;
      for (let i = 0; i < n && k < dts.length; i++) {
        const count = buf.readUInt32BE(p);
        const o = cv === 1 ? buf.readInt32BE(p + 4) : buf.readUInt32BE(p + 4);
        p += 8;
        while (k < dts.length && sync[k] < sample + count) { off[k] = o; k++; }
        sample += count;
      }
    }

    const out = [];
    for (let i = 0; i < dts.length; i++) {
      const t = (dts[i] + off[i] - shift) / timescale;
      if (t >= 0) out.push(Math.round(t * 1000) / 1000);
    }
    out.sort((a, b) => a - b);
    return out;
  }
  void root;
  return null;
}

const cache = new Map(); // 경로|크기|수정시각 → 목록

/** @returns {Promise<number[]|null>} */
async function readKeyframes(file) {
  if (!/\.(mp4|m4v|mov)$/i.test(file)) return null;
  let st;
  try { st = await fs.promises.stat(file); } catch (_) { return null; }
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (cache.has(key)) return cache.get(key);
  let list = null;
  try {
    const moov = await readMoov(file);
    list = moov ? keyframesFromMoov(moov) : null;
    if (list && list.length < 2) list = null;
  } catch (_) { list = null; }
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  cache.set(key, list);
  return list;
}

module.exports = { readKeyframes, keyframesFromMoov };
