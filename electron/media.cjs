// 내장 플레이어용 영상 스트리밍. 구간 이동(seek)을 위해 Range 요청을 직접 처리한다.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.ts': 'video/mp2t', '.ogv': 'video/ogg',
};

/**
 * @param {Request} req  vsmedia://video/?p=<경로>
 * @param {(p:string)=>boolean} isAllowed  등록된 영상만 재생 허용
 */
async function handleMediaRequest(req, isAllowed) {
  const filePath = new URL(req.url).searchParams.get('p') || '';
  if (!filePath || !isAllowed(filePath)) return new Response('forbidden', { status: 403 });
  let st;
  try { st = await fs.promises.stat(filePath); } catch { return new Response('not found', { status: 404 }); }

  const size = st.size;
  const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.get('range');
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : size - 1;
    if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; } // bytes=-500
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    }
    end = Math.min(end, size - 1);
    const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
    return new Response(stream, {
      status: 206,
      headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200, headers: { ...base, 'Content-Length': String(size) },
  });
}

module.exports = { handleMediaRequest };
