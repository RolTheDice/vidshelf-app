// Electron 안에서 정보 가져오기 흐름을 시험한다: r18.dev(JSON) → 품번기(검색 → 상세) → DMM 표지.
// 실제 사이트 대신 가짜 응답으로 답한다.
// 실행: npm run test:e2e   (리눅스 서버에서는 xvfb-run 필요)
const { app, session, net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'vidshelf-e2e-')));

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const html = (body) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function fakeJpeg(w, h) {
  const b = Buffer.alloc(64);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
}

app.whenReady().then(async () => {
  const { R18Client } = require('../electron/r18.cjs');
  const { PoomkiClient } = require('../electron/poomki.cjs');
  const { findCover } = require('../electron/cover.cjs');

  // r18.dev와 DMM 이미지 (기본 세션 = net.fetch)
  const r18Data = JSON.parse(fixture('r18-combined.json'));
  session.defaultSession.protocol.handle('https', (req) => {
    const u = new URL(req.url);
    if (u.hostname === 'r18.dev') {
      if (u.pathname.endsWith('/dvd_id=test101/json')) return json({ content_id: 'test00101' });
      if (u.pathname.endsWith('/combined=test00101/json')) return json({ ...r18Data, content_id: 'test00101', dvd_id: 'TEST-101' });
      if (u.pathname.endsWith('/dvd_id=block001/json')) return new Response('slow down', { status: 429 });
      return new Response('<h1>Not Found</h1>', { status: 404 });
    }
    if (req.url === 'https://pics.dmm.co.jp/digital/video/test00101/test00101pl.jpg') {
      return new Response(fakeJpeg(800, 538), { headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response('', { status: 404 });
  });

  // 품번기: 검색 → 상세 (가짜 페이지), BLOCK-001은 접속 차단 흉내
  session.fromPartition('persist:poomki').protocol.handle('https', (req) => {
    const u = new URL(req.url);
    if (u.hostname !== 'www.poomki.net') return new Response('', { status: 404 });
    if (u.pathname === '/search/') {
      const q = u.searchParams.get('q');
      if (q === 'BLOCK-001') return new Response('Access denied for this bot.', { status: 403 });
      if (q === 'ABCD-370') return html(fixture('poomki-search.html'));
      return html('<html><body><main>결과를 찾지 못했어요</main></body></html>');
    }
    if (u.pathname === '/movies/7654321/') return html(fixture('poomki-detail.html'));
    return new Response('', { status: 404 });
  });

  let failed = false;
  const check = async (name, fn) => {
    try { await fn(); console.log('  ✓', name); } catch (e) { failed = true; console.log('  ✗', name, '\n    ', e.stack); }
  };

  const r18 = new R18Client(async (url) => {
    const res = await net.fetch(url);
    let body = null;
    if (res.ok) { try { body = await res.json(); } catch (_) { /* JSON 아님 */ } }
    return { status: res.status, json: body };
  }, { guessGapMs: 0 });

  await check('r18.dev: 품번 → content_id → 상세 정보 (TEST-101)', async () => {
    const r = await r18.lookup('TEST-101');
    assert.strictEqual(r.found, true, JSON.stringify(r));
    assert.deepStrictEqual(r.data.actors.map((a) => a.name), ['야마다 하나코', '스즈키 유카']);
    assert.strictEqual(r.data.label, 'Test Label');
    assert.deepStrictEqual(r.data.genres, ['단독 작품', '거유', 'Something New']);
  });
  await check('r18.dev: 없는 품번 / 접속 제한은 구분해서 알려줌', async () => {
    const miss = await r18.lookup('ZZZZ-999');
    assert.strictEqual(miss.found, false);
    assert.ok(!miss.blocked);
    const blocked = await r18.lookup('BLOCK-001');
    assert.strictEqual(blocked.blocked, true, JSON.stringify(blocked));
  });

  const pk = new PoomkiClient();
  await check('품번기: 검색 → 상세 정보 읽기 (ABCD-370)', async () => {
    const r = await pk.lookup('ABCD-370', { gapMs: 10 });
    assert.strictEqual(r.found, true, JSON.stringify(r));
    assert.deepStrictEqual(r.data.actors.map((a) => a.name), ['하나 테스트', '둘 테스트']);
    assert.strictEqual(r.data.maker, 'テスト メーカー');
    assert.strictEqual(r.data.runtime, 150);
  });
  await check('품번기: 없는 품번 / 접속 차단은 구분해서 알려줌', async () => {
    const miss = await pk.lookup('ZZZZ-999', { gapMs: 10 });
    assert.strictEqual(miss.found, false);
    assert.ok(!miss.blocked, JSON.stringify(miss));
    const blocked = await pk.lookup('BLOCK-001', { gapMs: 10 });
    assert.strictEqual(blocked.found, false);
    assert.strictEqual(blocked.blocked, true, JSON.stringify(blocked));
  });
  pk.destroy();

  await check('DMM 표지 후보 중 실제 이미지를 찾아 받기', async () => {
    const fetchImage = async (url) => {
      const res = await net.fetch(url);
      return { ok: res.ok, status: res.status, url: res.url, buffer: res.ok ? Buffer.from(await res.arrayBuffer()) : null };
    };
    const found = await findCover('TEST-101', fetchImage);
    assert.ok(found, '표지를 찾아야 함');
    assert.strictEqual(found.url, 'https://pics.dmm.co.jp/digital/video/test00101/test00101pl.jpg');
  });

  console.log(failed ? '\n실패가 있어요' : '\n모두 통과');
  app.exit(failed ? 1 : 0);
});
