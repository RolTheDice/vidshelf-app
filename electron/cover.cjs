// 표지 찾기·저장
const fs = require('fs');
const path = require('path');
const { buildCandidates } = require('./coverfinder.cjs');

// JPEG/PNG 헤더에서 가로·세로 크기를 읽는다 (외부 라이브러리 없이)
function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// "NOW PRINTING" 같은 빈 이미지(작은 세로 이미지)를 걸러낸다
function isValidCover(size, finalUrl) {
  if (!size) return false;
  if (finalUrl && /now_printing|noimage/i.test(finalUrl)) return false;
  const nowPrinting = (size.width === 90 && size.height === 122) || (size.width === 590 && size.height === 800);
  return size.width > 100 && size.height > 100 && !nowPrinting;
}

/**
 * 품번으로 표지를 찾는다.
 * @param {string} code
 * @param {(url:string)=>Promise<{ok:boolean,status:number,url:string,buffer:Buffer}>} fetchImage
 * @param {{signal?:{cancelled:boolean}, maxTries?:number, extraUrls?:string[], rules?:object}} opts
 *   rules: 이 PC에서 배운 레이블별 규칙 (coverfinder.cjs)
 */
async function findCover(code, fetchImage, opts = {}) {
  const urls = [...(opts.extraUrls || []), ...buildCandidates(code, opts.rules || {})];
  const max = opts.maxTries || 220;
  let tried = 0;
  for (const url of urls) {
    if (opts.signal && opts.signal.cancelled) return null;
    if (tried++ >= max) break;
    try {
      const res = await fetchImage(url);
      if (!res || !res.ok) continue;
      const size = imageSize(res.buffer);
      if (isValidCover(size, res.url)) return { url, buffer: res.buffer, size, tried };
    } catch (_) { /* 다음 후보 */ }
  }
  return null;
}

// 설정에 따라 표지 저장 경로를 정한다
function coverPathFor(video, mode, appCoversDir) {
  const base = (video.code || path.parse(video.fileName).name).replace(/[\\/:*?"<>|]/g, '_');
  const dir = path.dirname(video.path);
  if (mode === 'subfolder') return path.join(dir, 'covers', base + '.jpg');
  if (mode === 'appdata') return path.join(appCoversDir, base + '.jpg');
  return path.join(dir, base + '.jpg'); // 'beside' (기본)
}

// 이미 있는 표지 파일을 찾는다 (어떤 저장 방식으로 만들었든)
function findExistingCover(video, appCoversDir) {
  const dir = path.dirname(video.path);
  const stem = path.parse(video.fileName).name;
  const names = [];
  if (video.code) names.push(video.code);
  names.push(stem);
  const cands = [];
  for (const n of names) {
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      cands.push(path.join(dir, n + ext), path.join(dir, n + '-poster' + ext), path.join(dir, n + '-fanart' + ext),
        path.join(dir, 'covers', n + ext), path.join(appCoversDir, n + ext));
    }
  }
  return cands.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

function saveCover(buffer, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // 같은 이름 파일이 있으면 덮어쓰지 않는다
  if (fs.existsSync(filePath)) return filePath;
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = { imageSize, isValidCover, findCover, coverPathFor, findExistingCover, saveCover };
