// 품번 → DMM 표지 후보 주소.
//
//  1) 이 PC에서 배운 규칙 (예: "SSIS 표지는 1ssis00123 형태였다")을 먼저 시도
//  2) ShowCover v1.1의 레이블 대응표로 만든 후보 (showcover.cjs)
//  3) 그다음 흔한 형태 몇 가지
//  표지를 찾으면 그 주소에서 규칙을 뽑아 기억 → 같은 레이블의 다음 작품은 첫 시도에 찾음
// 사용자가 설정에서 규칙을 직접 넣을 수도 있다.
const { makeImageURLs } = require('./showcover.cjs');

const HOST = 'https://pics.dmm.co.jp';
const PATHS = ['mono/movie', 'digital/video', 'mono/movie/adult'];
const GENERIC_PREFIXES = ['', '1', '118'];
const WIDTHS = [5, 3, 0]; // 숫자 자리수 (0 = 파일 이름 그대로)

/** "SSIS-123" → { label: 'ssis', num: '123' } */
function parseCode(code) {
  const m = String(code || '').trim().match(/^([A-Za-z0-9]+)-(\d+)$/);
  return m ? { label: m[1].toLowerCase(), num: m[2] } : null;
}

const pad = (num, width) => (width ? String(Number(num)).padStart(width, '0') : num);
const cidOf = (rule, p) => `${rule.prefix || ''}${p.label}${pad(p.num, rule.width || 0)}${rule.suffix || ''}`;
const urlOf = (path, cid) => `${HOST}/${path}/${cid}/${cid}pl.jpg`;

/**
 * 후보 주소 목록 (앞에 있을수록 먼저 시도)
 * @param {string} code
 * @param {Record<string, Array<{path:string,prefix:string,width:number,suffix:string,hits?:number}>>} rules 레이블별 배운 규칙
 */
function buildCandidates(code, rules = {}) {
  const p = parseCode(code);
  if (!p) return [];
  const out = [];
  const add = (path, rule) => out.push(urlOf(path, cidOf(rule, p)));

  // 1) 배운 규칙 (많이 맞은 순서)
  const learned = [...(rules[p.label] || [])].sort((a, b) => (b.hits || 0) - (a.hits || 0));
  for (const r of learned) add(r.path, r);

  // 2) ShowCover 대응표로 만든 후보
  out.push(...makeImageURLs(code));

  // 3) 흔한 형태: 접두어 × 자리수 × 경로, 그다음 끝에 r이 붙는 형태
  for (const suffix of ['', 'r']) {
    for (const prefix of GENERIC_PREFIXES) {
      for (const width of WIDTHS) {
        for (const path of PATHS) add(path, { prefix, width, suffix });
      }
    }
  }
  return [...new Set(out)];
}

/** 찾은 표지 주소에서 규칙을 뽑는다 (모르는 형태면 null) */
function learnRule(code, url) {
  const p = parseCode(code);
  if (!p) return null;
  const m = String(url).match(/^https:\/\/pics\.dmm\.(?:co\.jp|com)\/(.+)\/([a-z0-9_]+)\/\2pl\.jpg$/);
  if (!m) return null;
  const [, path, cid] = m;
  const parts = cid.match(new RegExp(`^([a-z0-9_]*?)${p.label}(\\d+)([a-z]?)$`));
  if (!parts || Number(parts[2]) !== Number(p.num)) return null;
  const digits = parts[2];
  const width = digits === p.num ? 0 : digits.length;
  return { path, prefix: parts[1], width, suffix: parts[3] };
}

const sameRule = (a, b) => a.path === b.path && (a.prefix || '') === (b.prefix || '')
  && (a.width || 0) === (b.width || 0) && (a.suffix || '') === (b.suffix || '');

/** 규칙 기억 (같은 규칙이면 맞은 횟수만 올림). 바뀌었으면 true */
function rememberRule(rules, code, url) {
  const p = parseCode(code);
  const rule = learnRule(code, url);
  if (!p || !rule) return false;
  const list = rules[p.label] || (rules[p.label] = []);
  const same = list.find((r) => sameRule(r, rule));
  if (same) same.hits = (same.hits || 0) + 1;
  else list.push({ ...rule, hits: 1 });
  return true;
}

/** 규칙을 사람이 읽을 수 있게: "1ssis00123 (mono/movie)" */
function describeRule(label, rule) {
  return `${cidOf(rule, { label, num: '123' })} · ${rule.path}`;
}

module.exports = { parseCode, buildCandidates, learnRule, rememberRule, describeRule, PATHS };
