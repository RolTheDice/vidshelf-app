// 품번기(poomki.net)에서 품번으로 작품 정보를 가져온다. 로그인은 필요 없다.
// 화면에 보이지 않는 브라우저 창 하나로 검색 → 상세 페이지를 연다.
// 사이트에 부담을 주지 않도록 요청 사이에 충분히 쉰다 (main.cjs의 정리하기 흐름).
const { BrowserWindow } = require('electron');
const { findMovieLinks, extractPoomkiDetail } = require('./poomki-extract.cjs');
const { sameCode } = require('./code.cjs');

const BASE = 'https://www.poomki.net';
const PARTITION = 'persist:poomki';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class PoomkiClient {
  constructor() {
    this.win = null;
  }

  _getWin() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, images: false },
    });
    this.win.webContents.setAudioMuted(true);
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return this.win;
  }

  async _load(url, timeoutMs = 25000) {
    const win = this._getWin();
    let status = 200;
    const onNav = (_e, _url, code) => { if (code) status = code; };
    win.webContents.on('did-navigate', onNav);
    try {
      const p = win.loadURL(url).catch((e) => {
        if (!String(e && e.message).includes('ERR_ABORTED')) throw e;
      });
      await Promise.race([p, sleep(timeoutMs).then(() => { throw new Error('페이지 응답 시간 초과'); })]);
    } finally {
      win.webContents.removeListener('did-navigate', onNav);
    }
    return status;
  }

  async _run(fn, ...args) {
    const call = `(${fn.toString()})(document${args.map((a) => ',' + JSON.stringify(a)).join('')})`;
    return this._getWin().webContents.executeJavaScript(call, true);
  }

  async _blockedText() {
    const t = await this._getWin().webContents.executeJavaScript('(document.body && document.body.innerText || "").slice(0, 200)', true).catch(() => '');
    return /access denied|bot|차단/i.test(t) ? t.trim() : '';
  }

  /**
   * 품번으로 작품 정보를 찾는다.
   * @returns {Promise<{found:boolean, data?:object, reason?:string, blocked?:boolean}>}
   * @param {string} code
   * @param {{gapMs?:number}} [opt] 검색과 상세 페이지 사이에 쉴 시간
   */
  async lookup(code, { gapMs = 1500 } = {}) {
    const status = await this._load(`${BASE}/search/?q=${encodeURIComponent(code)}`);
    if (status === 403 || status === 429) {
      return { found: false, blocked: true, reason: `품번기가 접속을 막았어요 (HTTP ${status})` };
    }
    let links = [];
    for (let i = 0; i < 6 && !links.length; i++) {
      links = (await this._run(findMovieLinks, code).catch(() => [])) || [];
      if (!links.length) await sleep(400);
    }
    if (!links.length) {
      const blocked = await this._blockedText();
      if (blocked) return { found: false, blocked: true, reason: `품번기가 접속을 막았어요 (${blocked.slice(0, 60)})` };
      return { found: false, reason: '품번기에 없는 품번' };
    }
    await sleep(gapMs);
    const st2 = await this._load(links[0].url);
    if (st2 === 403 || st2 === 429) return { found: false, blocked: true, reason: `품번기가 접속을 막았어요 (HTTP ${st2})` };
    const data = await this._run(extractPoomkiDetail);
    if (!data || !data.isDetail) return { found: false, reason: '상세 페이지를 읽지 못함' };
    if (data.code && !sameCode(data.code, code)) return { found: false, reason: `품번 불일치 (${data.code})` };
    return { found: true, data };
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { PoomkiClient };
