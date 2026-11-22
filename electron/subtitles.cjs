// 영상 옆의 자막 파일 찾기·읽기. 파일은 읽기만 하고 바꾸지 않는다.
// 같은 폴더에서 영상과 이름이 같은 자막: ABC-123.smi, ABC-123.srt, ABC-123.ko.srt, ABC-123.kor.ass …
// 형식: SMI(SAMI), SRT, VTT, ASS/SSA(글자만). 글자 인코딩: UTF-8(BOM 포함)·UTF-16, 아니면 한국어(CP949/EUC-KR)로 본다.
const fs = require('fs');
const path = require('path');

const SUB_EXTS = ['smi', 'srt', 'vtt', 'ass', 'ssa'];
const EXT_ORDER = { smi: 0, srt: 1, ass: 2, ssa: 3, vtt: 4 };

const isKo = (s) => /(^|[._\-\s])(ko|kor|kr|korean|한글|한국어)([._\-\s]|$)/i.test(s);

/** 영상과 이름이 같은 자막 파일 이름인지 (대소문자 무시). 맞으면 가운데 붙은 표시(예: ko)를 돌려준다 */
function subtitleTag(videoBase, fileName) {
  const lower = fileName.toLowerCase();
  const ext = path.extname(lower).slice(1);
  if (!SUB_EXTS.includes(ext)) return null;
  const base = videoBase.toLowerCase();
  const stem = lower.slice(0, -(ext.length + 1));
  if (stem === base) return '';
  if (stem.startsWith(base + '.')) return fileName.slice(base.length + 1, fileName.length - ext.length - 1);
  return null;
}

/** 이 폴더 안 파일 이름 목록에서, 이 영상의 자막이 있는지 */
function hasSubtitleIn(names, videoPath) {
  const base = path.basename(videoPath, path.extname(videoPath));
  return names.some((n) => subtitleTag(base, n) != null);
}

/** 영상의 자막 파일 목록 (한국어 표시가 있는 것 → SMI → SRT → ASS → VTT 순) */
function findSubtitles(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const out = [];
  for (const n of names) {
    const tag = subtitleTag(base, n);
    if (tag == null) continue;
    const ext = path.extname(n).slice(1).toLowerCase();
    out.push({ file: path.join(dir, n), name: n, ext, label: `${tag ? `${tag} ` : ''}${ext.toUpperCase()}`, ko: isKo(tag) });
  }
  out.sort((a, b) => (b.ko - a.ko) || (EXT_ORDER[a.ext] - EXT_ORDER[b.ext]) || a.name.localeCompare(b.name));
  return out;
}

/** 자막 파일 글자 읽기 */
function decodeText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString('utf8');
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.slice(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.slice(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { /* UTF-8이 아님 */ }
  try { return new TextDecoder('euc-kr').decode(buf); } catch (_) { return buf.toString('latin1'); }
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const decodeEntities = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);?/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k in ENTITIES) return ENTITIES[k];
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return m;
});
const cleanLines = (s) => s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');

/** 00:01:02,345 / 00:01:02.345 / 1:02.34 → 초 */
function parseClock(t) {
  const m = String(t).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) / 1000 : 0;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + frac;
}

function parseSrtLike(text) {
  const cues = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const s = parseClock(a);
    const e = parseClock(String(z).trim().split(/\s+/)[0]);
    if (s == null || e == null) continue;
    const t = cleanLines(decodeEntities(lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')));
    if (t) cues.push({ s, e, t });
  }
  return cues;
}

function parseSmi(text) {
  const body = text.replace(/\r/g, '');
  const syncs = [];
  const re = /<sync\s+start\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)(?=<sync\s|<\/body|$)/gi;
  let m;
  while ((m = re.exec(body))) {
    const start = Number(m[1]) / 1000;
    // 언어별 <P Class=KRCC> 덩어리
    const parts = {};
    const pre = /<p\b([^>]*)>([\s\S]*?)(?=<p\b|$)/gi;
    let p;
    let any = false;
    while ((p = pre.exec(m[2]))) {
      const cls = ((p[1].match(/class\s*=\s*["']?([\w-]+)/i) || [])[1] || '').toUpperCase();
      parts[cls] = p[2];
      any = true;
    }
    if (!any) parts[''] = m[2];
    syncs.push({ start, parts });
  }
  if (!syncs.length) return [];
  // 한국어 덩어리 우선 (KRCC 등), 없으면 처음 나온 것
  const classes = [...new Set(syncs.flatMap((x) => Object.keys(x.parts)))];
  const pick = classes.find((c) => /KR|KO/.test(c)) ?? classes[0];
  // 같은 시각의 SYNC는 합치고, 고른 언어가 없는 SYNC(다른 언어만 바뀌는 곳)는 건너뜀
  const merged = new Map();
  for (const x of syncs) merged.set(x.start, { ...(merged.get(x.start) || {}), ...x.parts });
  const list = [...merged.entries()].sort((a, b) => a[0] - b[0])
    .filter(([, parts]) => pick in parts || Object.keys(parts).length === 0);
  const cues = [];
  for (let i = 0; i < list.length; i++) {
    const [start, parts] = list[i];
    const raw = parts[pick] ?? '';
    const t = cleanLines(decodeEntities(raw.replace(/\n/g, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')));
    const next = list[i + 1] ? list[i + 1][0] : start + 5;
    if (t) cues.push({ s: start, e: Math.max(start + 0.1, next), t });
  }
  return cues;
}

function parseAss(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let fmt = null;
  let inEvents = false;
  const cues = [];
  for (const line of lines) {
    const l = line.trim();
    if (/^\[events\]/i.test(l)) { inEvents = true; continue; }
    if (/^\[/.test(l)) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (/^format:/i.test(l)) { fmt = l.slice(7).split(',').map((x) => x.trim().toLowerCase()); continue; }
    if (!/^dialogue:/i.test(l)) continue;
    const f = fmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const fields = l.slice(9).split(',');
    const textIdx = f.indexOf('text');
    const val = (k) => (fields[f.indexOf(k)] || '').trim();
    const s = parseClock(val('start'));
    const e = parseClock(val('end'));
    const t = cleanLines(fields.slice(textIdx).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '));
    if (s != null && e != null && t) cues.push({ s, e, t });
  }
  return cues;
}

/** 자막 글자 → [{s, e, t}] (시간순) */
function parseSubtitle(text, ext) {
  const x = String(ext || '').toLowerCase();
  let cues;
  if (x === 'smi' || /<sync\s/i.test(text.slice(0, 5000))) cues = parseSmi(text);
  else if (x === 'ass' || x === 'ssa' || /^\s*\[script info\]/i.test(text)) cues = parseAss(text);
  else cues = parseSrtLike(text);
  return cues.sort((a, b) => a.s - b.s);
}

function loadSubtitle(file) {
  const text = decodeText(fs.readFileSync(file));
  return parseSubtitle(text, path.extname(file).slice(1));
}

module.exports = { findSubtitles, hasSubtitleIn, loadSubtitle, parseSubtitle, decodeText, subtitleTag, SUB_EXTS };
