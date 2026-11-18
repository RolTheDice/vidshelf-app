// 개발용: VIDSHELF_SHOTS 환경변수에 적힌 순서대로 화면을 조작하고 캡처한 뒤 종료한다.
// 예) VIDSHELF_SHOTS='[{"wait":2000,"file":"a.png"},{"js":"...","wait":800,"file":"b.png"}]'
const fs = require('fs');

module.exports = function runShots(win, app) {
  const steps = JSON.parse(process.env.VIDSHELF_SHOTS);
  win.webContents.once('did-finish-load', async () => {
    for (const s of steps) {
      if (s.js) {
        const r = await win.webContents.executeJavaScript(s.js, true).catch((e) => `js error: ${e.message}`);
        if (r !== undefined) console.log('[shot]', s.file || '', JSON.stringify(r));
      }
      await new Promise((r) => setTimeout(r, s.wait || 800));
      if (s.file) fs.writeFileSync(s.file, (await win.webContents.capturePage()).toPNG());
    }
    app.quit();
  });
};
