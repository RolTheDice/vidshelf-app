// 간단한 테스트: node tests/run.cjs
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');
const { extractCode } = require('../electron/code.cjs');
const { buildCandidates, learnRule, rememberRule, parseCode } = require('../electron/coverfinder.cjs');
const { parseCombined, contentIdGuesses, R18Client } = require('../electron/r18.cjs');
const { nameToHangul, kanaToHangul, nameSimilarity } = require('../electron/kana.cjs');
const { mapGenres } = require('../electron/genres-ko.cjs');
const { translateJaKo, translateDeepl, deeplUsage } = require('../electron/translate.cjs');
const { readKeyframes } = require('../electron/keyframes.cjs');
const { findMovieLinks, extractPoomkiDetail } = require('../electron/poomki-extract.cjs');
const { imageSize, isValidCover, findCover, coverPathFor, findExistingCover } = require('../electron/cover.cjs');
const { Store } = require('../electron/db.cjs');
const { scanFolder, reconcileMoves } = require('../electron/scanner.cjs');
const { handleMediaRequest } = require('../electron/media.cjs');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------- 품번 추출
test('파일 이름에서 품번 추출', () => {
  const cases = {
    'ABCD-370.mp4': 'ABCD-370',
    'wxyz244.mkv': 'WXYZ-244',
    '[site.com] HIJK-123-C.mp4': 'HIJK-123',
    'abc_045 1080p x264.avi': 'ABC-045',
    'MNOP-07.mp4': 'MNOP-007',
    'efg-1234_HD.mp4': 'EFG-1234',
    'hd-ABCD-370.mp4': 'ABCD-370',
    '휴가 영상 2024.mp4': null,
    'FHD-1080.mp4': null,
  };
  for (const [file, want] of Object.entries(cases)) assert.strictEqual(extractCode(file), want, file);
});

// ---------------------------------------------------------------- 품번기
const poomkiDoc = (name, url) => new JSDOM(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'), { url }).window.document;

test('품번기 검색: 품번이 정확히 같은 작품만 (옆 목록·비슷한 품번 제외)', () => {
  const doc = poomkiDoc('poomki-search.html', 'https://www.poomki.net/search/?q=ABCD-370');
  const links = findMovieLinks(doc, 'ABCD-370');
  assert.deepStrictEqual(links.map((l) => l.url), ['https://www.poomki.net/movies/7654321/']);
  assert.strictEqual(findMovieLinks(doc, 'abcd370').length, 1);
  assert.strictEqual(findMovieLinks(doc, 'ABCD-371').length, 0);
});

test('품번기 상세: 배우·레이블·제작사·발매일·재생시간·배우 사진', () => {
  const d = extractPoomkiDetail(poomkiDoc('poomki-detail.html', 'https://www.poomki.net/movies/7654321/'));
  assert.ok(d.isDetail);
  assert.strictEqual(d.source, 'poomki');
  assert.strictEqual(d.code, 'ABCD-370');
  assert.strictEqual(d.poomkiId, '7654321');
  assert.deepStrictEqual(d.actors.map((a) => a.name), ['하나 테스트', '둘 테스트']);
  assert.deepStrictEqual(d.actors.map((a) => a.photo), ['https://example.com/hana.jpg', 'https://example.com/dul.jpg']);
  assert.strictEqual(d.actors[0].poomkiIdx, '1000002');
  assert.strictEqual(d.label, 'テスト レーベル');
  assert.strictEqual(d.maker, 'テスト メーカー');
  assert.strictEqual(d.releaseDate, '2024-01-02');
  assert.strictEqual(d.runtime, 150);
});

test('품번기 상세: 구조화 데이터가 없어도 화면 글자로 읽기', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'poomki-detail.html'), 'utf8').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  const d = extractPoomkiDetail(new JSDOM(html, { url: 'https://www.poomki.net/movies/7654321/' }).window.document);
  assert.ok(d.isDetail);
  assert.strictEqual(d.code, 'ABCD-370');
  assert.deepStrictEqual(d.actors.map((a) => a.name), ['하나 테스트', '둘 테스트']);
  assert.strictEqual(d.label, 'テスト レーベル');
  assert.strictEqual(d.maker, 'テスト メーカー');
  assert.strictEqual(d.releaseDate, '2024-01-02');
  assert.strictEqual(d.runtime, 150);
});

test('설정: 예전 설정(avdbs)은 r18.dev + 품번기로 한 번 바꾼다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-set-'));
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ settings: { useAvdbs: true, requestDelayMs: 2000, usePoomki: false } }));
  const st = new Store(dir);
  assert.strictEqual(st.settings.useAvdbs, undefined);
  assert.strictEqual(st.settings.useR18, true);
  assert.strictEqual(st.settings.usePoomki, true);
  assert.strictEqual(st.settings.requestDelayMs, 2000);
  st.settings.usePoomki = false; st.save(true);
  assert.strictEqual(new Store(dir).settings.usePoomki, false, '사용자가 다시 끄면 그대로 둔다');
});

// ---------------------------------------------------------------- r18.dev
const r18Json = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'r18-combined.json'), 'utf8'));

test('가나 → 한글 이름 (거센소리, 장음 줄이기, ㅅ·ㄴ 받침, 성·이름 띄우기)', () => {
  const cases = [
    ['やまだはなこ', 'Hanako Yamada', '야마다 하나코'], ['すずきゆうか', 'Yuka Suzuki', '스즈키 유카'],
    ['いっしきもも', 'Momo Isshiki', '잇시키 모모'], ['しんじょうゆうり', 'Yuri Shinjo', '신조 유리'],
    ['おおつきひびき', 'Hibiki Otsuki', '오츠키 히비키'], ['かとうたかし', 'Takashi Kato', '카토 타카시'],
    ['チャンミナ', '', '찬미나'], ['りょうこ', 'Ryoko', '료코'],
  ];
  for (const [kana, romaji, want] of cases) assert.strictEqual(nameToHangul(kana, romaji), want, kana);
  assert.strictEqual(kanaToHangul('ほんごう'), '혼고');
  assert.ok(nameSimilarity('야마다 하나코', '야마다하나코') === 1);
  assert.ok(nameSimilarity('야마다 하나코', '스즈키 유카') < 0.5);
});

test('장르: 일본어 → 한국어 표, 판매·화질 표시는 빼고, 표에 없으면 영어', () => {
  assert.deepStrictEqual(mapGenres(r18Json().categories), ['단독 작품', '거유', 'Something New']);
});

test('r18.dev 응답 읽기: 배우(한자·한글·사진)·레이블·감독·시리즈·장르·큰 표지 주소', () => {
  const d = parseCombined(r18Json());
  assert.strictEqual(d.source, 'r18');
  assert.strictEqual(d.contentId, '1abcd00370');
  assert.deepStrictEqual(d.actors.map((a) => [a.name, a.ja]), [['야마다 하나코', '山田花子'], ['스즈키 유카', '鈴木優香']]);
  assert.strictEqual(d.actors[0].photo, 'https://pics.dmm.co.jp/mono/actjpgs/yamada_hanako.jpg');
  assert.strictEqual(d.label, 'Test Label');
  assert.strictEqual(d.maker, 'Test Maker');
  assert.strictEqual(d.series, 'Test Series');
  assert.strictEqual(d.director, '사토 타로');
  assert.strictEqual(d.title, 'A Made-up Test Title');
  assert.strictEqual(d.titleJa, 'テスト用の作品名');
  assert.strictEqual(d.releaseDate, '2024-01-02');
  assert.strictEqual(d.runtime, 150);
  assert.deepStrictEqual(d.coverUrls, [
    'https://pics.dmm.co.jp/mono/movie/adult/1abcd370/1abcd370pl.jpg', // 작은 ps 대신 큰 pl 먼저
    'https://pics.dmm.co.jp/mono/movie/adult/1abcd370/1abcd370ps.jpg',
  ]);
});

test('r18.dev content_id 추측: 5자리 먼저, 배운 표지 규칙(앞에 1 붙는 레이블)도 씀', () => {
  const g = contentIdGuesses('ABCD-370');
  assert.strictEqual(g[0], 'abcd00370');
  assert.ok(g.length <= 6);
  const rules = {};
  rememberRule(rules, 'ABCD-111', 'https://pics.dmm.co.jp/digital/video/1abcd00111/1abcd00111pl.jpg');
  assert.strictEqual(contentIdGuesses('ABCD-370', rules)[0], '1abcd00370');
});

test('r18.dev 찾기: dvd_id로 안 잡히면 content_id를 추측해서 찾고, 없으면 이유를 알려 줌', async () => {
  const calls = [];
  const client = new R18Client(async (url) => {
    calls.push(url);
    if (url.includes('combined=1abcd00370')) return { status: 200, json: r18Json() };
    return { status: 404, json: null };
  }, { guessGapMs: 0 });
  const rules = {};
  rememberRule(rules, 'ABCD-111', 'https://pics.dmm.co.jp/digital/video/1abcd00111/1abcd00111pl.jpg');
  const r = await client.lookup('ABCD-370', { rules });
  assert.strictEqual(r.found, true, JSON.stringify(r));
  assert.strictEqual(r.data.code, 'ABCD-370');
  assert.ok(calls[0].includes('dvd_id=abcd-370'));
  const miss = await client.lookup('ZZZZ-999');
  assert.strictEqual(miss.found, false);
  assert.ok(/없는 품번/.test(miss.reason));
  const blocked = await new R18Client(async () => ({ status: 403, json: null }), { guessGapMs: 0 }).lookup('ABCD-370');
  assert.strictEqual(blocked.blocked, true);
});

test('제목 번역: 배우 이름은 정해 둔 한국어로 바꿔 넣고, 응답 조각을 이어 붙임, 실패하면 null', async () => {
  let asked = '';
  const ok = await translateJaKo('山田花子の作品。続き', async (url) => {
    asked = decodeURIComponent(new URL(url).searchParams.get('q'));
    return { status: 200, json: [[['야마다 하나코의 작품.', 'x'], [' 계속', 'y']], null, 'ja'] };
  }, { names: [{ ja: '山田花子', ko: '야마다 하나코' }] });
  assert.ok(asked.includes('야마다 하나코') && !asked.includes('山田花子'), asked);
  assert.strictEqual(ok, '야마다 하나코의 작품. 계속');
  assert.strictEqual(await translateJaKo('テスト', async () => ({ status: 429, json: null })), null);
  assert.strictEqual(await translateJaKo('', async () => ({ status: 200, json: [] })), null);
});

test('DeepL 번역: 무료 키(:fx)는 api-free 주소, 일본어→한국어, 이름 보호, 키 오류·한도 초과 상태', async () => {
  let seen = null;
  const req = async (url, init) => {
    seen = { url, init, body: init.body ? JSON.parse(init.body) : null };
    if (init.headers.Authorization.includes('bad')) return { status: 403, json: { message: 'Forbidden' } };
    if (url.endsWith('/usage')) return { status: 200, json: { character_count: 1200, character_limit: 500000 } };
    return { status: 200, json: { translations: [{ text: '야마다 하나코의  작품' }] } };
  };
  const r = await translateDeepl('山田花子の作品', 'abc:fx', req, { names: [{ ja: '山田花子', ko: '야마다 하나코' }] });
  assert.strictEqual(r.text, '야마다 하나코의 작품');
  assert.ok(seen.url.startsWith('https://api-free.deepl.com/v2/translate'));
  assert.strictEqual(seen.init.headers.Authorization, 'DeepL-Auth-Key abc:fx');
  assert.deepStrictEqual([seen.body.source_lang, seen.body.target_lang], ['JA', 'KO']);
  assert.ok(seen.body.text[0].includes('야마다 하나코'));
  await translateDeepl('テスト', 'paidkey', req);
  assert.ok(seen.url.startsWith('https://api.deepl.com/'), '유료 키는 api.deepl.com');
  assert.strictEqual((await translateDeepl('テスト', 'bad:fx', req)).status, 403);
  assert.deepStrictEqual(await deeplUsage('abc:fx', req), { ok: true, used: 1200, limit: 500000 });
  assert.strictEqual((await deeplUsage('bad:fx', req)).ok, false);
});

test('MP4 기준 화면 시각 읽기 (B프레임·편집 목록 보정), MP4가 아니면 null', async () => {
  const k = await readKeyframes(path.join(__dirname, 'fixtures', 'keyframes.mp4'));
  assert.deepStrictEqual(k, [0, 1.32, 2.6, 3.92]); // ffprobe로 확인한 값 (25fps, 1.3초마다 강제 기준 화면)
  assert.strictEqual(await readKeyframes(path.join(__dirname, 'fixtures', 'poomki-detail.html')), null);
});

// ---------------------------------------------------------------- 표지 주소 (스스로 배우는 방식)
const U = (path, cid) => `https://pics.dmm.co.jp/${path}/${cid}/${cid}pl.jpg`;

test('표지 후보: 흔한 형태 (접두어 없음·1·118, 자리수 5·3·그대로, 끝에 r)', () => {
  const c = buildCandidates('ABCD-370');
  assert.ok(c.includes(U('digital/video', 'abcd00370')));
  assert.ok(c.includes(U('mono/movie', '1abcd370')));
  assert.ok(c.includes(U('mono/movie', '118abcd370r')));
  assert.ok(c.length <= 200, `후보가 너무 많음: ${c.length}`);
  assert.deepStrictEqual(buildCandidates('잘못된품번'), []);
});

test('표지 후보: ShowCover 대응표 (배운 규칙이 없을 때도 특이한 레이블)', () => {
  // ShowCover 표에서 h_086 접두어를 쓰는 레이블, 118…r 형태 레이블, 1 접두어 레이블
  assert.ok(buildCandidates('FERA-123').slice(0, 30).some((u) => u.includes('/h_086fera')), 'h_086 레이블');
  assert.strictEqual(buildCandidates('ABP-045')[0], U('mono/movie', '118abp045r'));
  assert.strictEqual(buildCandidates('SDMM-244')[0], U('mono/movie', '1sdmm244'));
  // 배운 규칙이 있으면 그게 먼저
  const rules = {};
  rememberRule(rules, 'ABP-001', U('digital/video', 'abp00001'));
  assert.strictEqual(buildCandidates('ABP-045', rules)[0], U('digital/video', 'abp00045'));
});

test('표지 규칙 배우기: 찾은 주소에서 형태를 뽑고, 다음 작품은 첫 시도에', () => {
  assert.deepStrictEqual(learnRule('WXYZ-244', U('mono/movie', '1wxyz244')), { path: 'mono/movie', prefix: '1', width: 0, suffix: '' });
  assert.deepStrictEqual(learnRule('ABCD-370', U('digital/video', 'abcd00370')), { path: 'digital/video', prefix: '', width: 5, suffix: '' });
  assert.deepStrictEqual(learnRule('QRS-045', U('mono/movie', 'h_999qrs045r')), { path: 'mono/movie', prefix: 'h_999', width: 0, suffix: 'r' });
  assert.strictEqual(learnRule('ABCD-370', U('mono/movie', 'abcd00371')), null, '번호가 다르면 배우지 않음');
  const rules = {};
  rememberRule(rules, 'QRS-045', U('mono/movie', 'h_999qrs045r'));
  rememberRule(rules, 'QRS-046', U('mono/movie', 'h_999qrs046r'));
  assert.strictEqual(rules.qrs.length, 1);
  assert.strictEqual(rules.qrs[0].hits, 2);
  // 흔한 형태에 없는 접두어(h_999)도 배운 뒤에는 첫 후보
  assert.ok(!buildCandidates('QRS-777').includes(U('mono/movie', 'h_999qrs777r')));
  assert.strictEqual(buildCandidates('QRS-777', rules)[0], U('mono/movie', 'h_999qrs777r'));
  assert.deepStrictEqual(parseCode('midv-007'), { label: 'midv', num: '007' });
});

// ---------------------------------------------------------------- 표지 이미지
function fakeJpeg(w, h) {
  const b = Buffer.alloc(40);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
}

test('JPEG 크기 읽기와 NOW PRINTING 거르기', () => {
  assert.deepStrictEqual(imageSize(fakeJpeg(800, 538)), { width: 800, height: 538 });
  assert.ok(isValidCover({ width: 800, height: 538 }, 'x'));
  assert.ok(!isValidCover({ width: 90, height: 122 }, 'x'));
  assert.ok(!isValidCover({ width: 800, height: 538 }, 'https://pics.dmm.co.jp/mono/movie/now_printing/now_printing.jpg'));
});

test('표지 후보를 차례로 시도해서 진짜 이미지를 찾음', async () => {
  const good = 'https://pics.dmm.co.jp/digital/video/abcd00370/abcd00370pl.jpg';
  const seen = [];
  const found = await findCover('ABCD-370', async (url) => {
    seen.push(url);
    if (url === good) return { ok: true, url, buffer: fakeJpeg(800, 538) };
    if (seen.length === 1) return { ok: true, url, buffer: fakeJpeg(90, 122) }; // NOW PRINTING
    return { ok: false, status: 404, url };
  });
  assert.strictEqual(found.url, good);
});

// ---------------------------------------------------------------- 스캔 (파일을 옮기지 않음)
test('폴더 스캔: 품번 인식, 기존 표지 인식, 파일 그대로', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidshelf-'));
  const media = path.join(tmp, 'media');
  fs.mkdirSync(path.join(media, 'sub'), { recursive: true });
  const big = Buffer.alloc(1024 * 1024 + 10);
  fs.writeFileSync(path.join(media, 'ABCD-370.mp4'), big);
  fs.writeFileSync(path.join(media, 'sub', 'wxyz244.mkv'), big);
  fs.writeFileSync(path.join(media, 'family trip.mp4'), big);
  fs.writeFileSync(path.join(media, 'tiny-001.mp4'), Buffer.alloc(100)); // 1MB 미만 → 무시
  fs.writeFileSync(path.join(media, 'ABCD-370.jpg'), fakeJpeg(800, 538)); // 이미 있는 표지
  const before = fs.readdirSync(media).sort();

  const store = new Store(path.join(tmp, 'data'));
  const folder = { id: 'f1', path: media };
  const appCovers = path.join(tmp, 'data', 'covers');
  const r = await scanFolder(store, folder, (v) => findExistingCover(v, appCovers));
  assert.strictEqual(r.total, 3);
  const vids = Object.values(store.videos);
  const abcd = vids.find((v) => v.code === 'ABCD-370');
  assert.ok(abcd.cover.endsWith('ABCD-370.jpg'));
  assert.ok(vids.find((v) => v.code === 'WXYZ-244'));
  assert.strictEqual(vids.find((v) => v.fileName === 'family trip.mp4').status, 'nocode');
  assert.deepStrictEqual(fs.readdirSync(media).sort(), before, '파일이 바뀌면 안 됨');

  // 표지 저장 위치
  const sd = vids.find((v) => v.code === 'WXYZ-244');
  assert.strictEqual(coverPathFor(sd, 'beside', appCovers), path.join(media, 'sub', 'WXYZ-244.jpg'));
  assert.strictEqual(coverPathFor(sd, 'subfolder', appCovers), path.join(media, 'sub', 'covers', 'WXYZ-244.jpg'));
  assert.strictEqual(coverPathFor(sd, 'appdata', appCovers), path.join(appCovers, 'WXYZ-244.jpg'));

  // 파일이 사라지면 missing 표시
  fs.unlinkSync(path.join(media, 'family trip.mp4'));
  const r2 = await scanFolder(store, folder, (v) => findExistingCover(v, appCovers));
  assert.strictEqual(r2.missing, 1);
  store.save(true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 이름·위치 바뀐 파일
test('파일 이름을 바꾸거나 옮겨도 정보·별점·재생 횟수가 이어짐', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidshelf-'));
  const media = path.join(tmp, 'media');
  fs.mkdirSync(path.join(media, 'moved'), { recursive: true });
  const big = Buffer.alloc(1024 * 1024 + 77);
  fs.writeFileSync(path.join(media, 'ABCD-370.mp4'), big);
  const store = new Store(path.join(tmp, 'data'));
  const folder = { id: 'f1', path: media };
  store.folders.push(folder);
  const scanAll = async () => {
    const ids = new Set();
    await scanFolder(store, folder, () => null, ids);
    return reconcileMoves(store, ids);
  };
  await scanAll();
  const v = Object.values(store.videos)[0];
  Object.assign(v, { status: 'done', actors: ['배우 A'], rating: 4, playCount: 3, memo: '좋음' });
  store.data.playlists.push({ id: 'p1', name: '목록', items: [v.id] });

  fs.renameSync(path.join(media, 'ABCD-370.mp4'), path.join(media, 'moved', 'abcd370_hd.mp4'));
  const moved = await scanAll();
  assert.strictEqual(moved, 1);
  const all = Object.values(store.videos);
  assert.strictEqual(all.length, 1, '예전 항목은 지워지고 새 항목 하나만 남아야 함');
  const nv = all[0];
  assert.ok(nv.path.endsWith('abcd370_hd.mp4'));
  assert.deepStrictEqual([nv.status, nv.actors, nv.rating, nv.playCount, nv.memo], ['done', ['배우 A'], 4, 3, '좋음']);
  assert.deepStrictEqual(store.data.playlists[0].items, [nv.id], '재생목록도 새 항목을 가리켜야 함');
  store.save(true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 플레이어 스트리밍
test('플레이어용 Range 응답 (구간 이동)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidshelf-'));
  const file = path.join(tmp, 'a.mp4');
  fs.writeFileSync(file, Buffer.from('0123456789'.repeat(100))); // 1000바이트
  const url = 'vsmedia://video/?p=' + encodeURIComponent(file);
  const allow = (p) => p === file;

  let r = await handleMediaRequest(new Request(url, { headers: { Range: 'bytes=100-199' } }), allow);
  assert.strictEqual(r.status, 206);
  assert.strictEqual(r.headers.get('content-range'), 'bytes 100-199/1000');
  assert.strictEqual((await r.text()), '0123456789'.repeat(10));

  r = await handleMediaRequest(new Request(url, { headers: { Range: 'bytes=990-' } }), allow);
  assert.strictEqual(r.headers.get('content-range'), 'bytes 990-999/1000');
  assert.strictEqual(await r.text(), '0123456789');

  r = await handleMediaRequest(new Request(url), allow);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'video/mp4');
  assert.strictEqual((await r.arrayBuffer()).byteLength, 1000);

  r = await handleMediaRequest(new Request(url, { headers: { Range: 'bytes=5000-' } }), allow);
  assert.strictEqual(r.status, 416);

  r = await handleMediaRequest(new Request('vsmedia://video/?p=' + encodeURIComponent('/etc/passwd')), allow);
  assert.strictEqual(r.status, 403, '등록되지 않은 파일은 거부');
  fs.rmSync(tmp, { recursive: true, force: true });
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log('  ✓', name);
    } catch (e) {
      console.log('  ✗', name, '\n    ', e.message);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} 통과`);
})();
