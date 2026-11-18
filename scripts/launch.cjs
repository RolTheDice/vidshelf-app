#!/usr/bin/env node
// VidShelf 실행·업데이트 도우미 (Node.js로 실행)
//
//   node scripts/launch.cjs            바탕화면 아이콘: 새 코드가 있으면 빌드한 뒤 VidShelf 실행
//   node scripts/launch.cjs --setup    처음 한 번: 자동 업데이트 연결 + 바탕화면 아이콘 만들기 + 빌드 + 실행
//   node scripts/launch.cjs --from-hook  GitHub Desktop [Pull origin] 직후 (git hook이 부름): 업데이트 창을 띄움
//   node scripts/launch.cjs --update   업데이트 창 안에서: 빌드 후 VidShelf 다시 켜기
//
// 이 파일은 외부 패키지 없이 동작해야 한다 (node_modules가 없을 때도 실행되므로).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GIT = path.join(ROOT, '.git');
const STATE = path.join(GIT, 'vidshelf-built.json'); // 마지막으로 빌드한 커밋 (git이 관리하지 않는 곳)
const HOOK_SRC = path.join(ROOT, 'scripts', 'hooks', 'post-merge');
const IS_WIN = process.platform === 'win32';
const args = process.argv.slice(2);

const say = (m) => console.log(m);
const sha = (file) => { try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };

// git 명령 없이 .git 폴더에서 현재 커밋을 읽는다
function headCommit() {
  try {
    const head = fs.readFileSync(path.join(GIT, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice(4).trim();
    const loose = path.join(GIT, ...ref.split('/'));
    if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
    const packed = fs.readFileSync(path.join(GIT, 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((l) => l.endsWith(' ' + ref));
    return line ? line.split(' ')[0] : null;
  } catch { return null; }
}

// GitHub Desktop의 [Pull origin] 뒤에 자동으로 실행되도록 git hook을 넣는다 (바뀌었으면 새로 씀)
function ensureHook() {
  if (!fs.existsSync(GIT) || !fs.existsSync(HOOK_SRC)) return false;
  const dst = path.join(GIT, 'hooks', 'post-merge');
  const src = fs.readFileSync(HOOK_SRC, 'utf8').replace(/\r\n/g, '\n');
  let cur = null;
  try { cur = fs.readFileSync(dst, 'utf8'); } catch { /* 없음 */ }
  if (cur !== src) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, src);
    try { fs.chmodSync(dst, 0o755); } catch { /* Windows에서는 필요 없음 */ }
  }
  return true;
}

// Electron 실행 파일까지 제대로 받아졌는지 (폴더만 있고 실행 파일이 없는 경우가 있음)
function electronReady() {
  try {
    const dir = path.join(ROOT, 'node_modules', 'electron');
    const exe = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim();
    return !!exe && fs.existsSync(path.join(dir, 'dist', exe));
  } catch { return false; }
}

// 실행 파일만 다시 받는다 (전체 재설치보다 빠름). 그래도 안 되면 전체 재설치.
function repairElectron() {
  if (electronReady()) return;
  const installer = path.join(ROOT, 'node_modules', 'electron', 'install.js');
  if (fs.existsSync(installer)) {
    say('\nVidShelf 엔진(Electron)을 내려받는 중이에요…\n');
    try { fs.rmSync(path.join(ROOT, 'node_modules', 'electron', 'dist'), { recursive: true, force: true }); } catch { /* 무시 */ }
    try { run(process.execPath, [installer], { cwd: path.dirname(installer) }); } catch (e) { say(`(다시 받기 실패: ${e.message})`); }
  }
  if (electronReady()) return;
  say('\n구성 요소를 처음부터 다시 설치하는 중이에요…\n');
  npmCi();
  if (!electronReady()) {
    throw new Error('Electron 실행 파일을 받지 못했어요. 인터넷 연결이나 백신 프로그램(실시간 감시)을 확인한 뒤, '
      + '이 폴더의 node_modules 폴더를 지우고 "VidShelf 설치.cmd"를 다시 실행해 주세요.');
  }
}

// npm ci: package-lock.json을 고치지 않는다. Windows에서 npm은 .cmd라서 shell로 실행.
// (npm 12부터는 package.json의 allowScripts에 있는 패키지만 설치 스크립트를 실행함 → electron·esbuild 허용해 둠)
function npmCi() {
  const r = spawnSync('npm ci --no-audit --no-fund', { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`npm ci 실패 (코드 ${r.status})`);
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${cmdArgs.join(' ')} 실패 (코드 ${r.status})`);
}

// 설치나 빌드를 새로 해야 하는지 (빠른 확인)
function needsBuild() {
  const state = readJson(STATE);
  const hasModules = fs.existsSync(path.join(ROOT, 'node_modules', 'electron')) && fs.existsSync(path.join(ROOT, 'node_modules', 'vite'));
  return !hasModules || state.lockHash !== sha(path.join(ROOT, 'package-lock.json'))
    || !fs.existsSync(path.join(ROOT, 'dist', 'index.html')) || state.commit !== headCommit();
}

// 필요할 때만 패키지 설치·화면 빌드
function ensureBuilt({ force = false } = {}) {
  const state = readJson(STATE);
  const commit = headCommit();
  const lockHash = sha(path.join(ROOT, 'package-lock.json'));
  const hasModules = fs.existsSync(path.join(ROOT, 'node_modules', 'electron')) && fs.existsSync(path.join(ROOT, 'node_modules', 'vite'));
  const needRepair = hasModules && !electronReady();
  const needInstall = force || !hasModules || state.lockHash !== lockHash;
  const needBuild = force || needInstall || !fs.existsSync(path.join(ROOT, 'dist', 'index.html')) || state.commit !== commit;
  if (!needInstall && !needBuild) {
    if (needRepair) repairElectron();
    return false;
  }

  if (needInstall) {
    say('\n[1/2] 필요한 구성 요소를 설치하는 중이에요 (처음에는 몇 분 걸릴 수 있어요)…\n');
    // 켜져 있는 VidShelf가 구성 요소 파일을 잡고 있으면 Windows에서 교체가 안 되므로 먼저 닫는다
    if (hasModules) quitRunningApp();
    // npm ci: package-lock.json을 절대 고치지 않는다 (고치면 GitHub Desktop에 '변경 사항'이 생겨 Pull이 막힘)
    // Windows에서 npm은 .cmd라서 shell로 실행해야 한다
    npmCi();
  }
  repairElectron();
  say('\n[2/2] 새 버전을 빌드하는 중이에요…\n');
  run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn']);
  fs.writeFileSync(STATE, JSON.stringify({ commit, lockHash, builtAt: new Date().toISOString() }, null, 2));
  return true;
}

// 켜져 있는 VidShelf에 '종료' 신호 (켜져 있지 않으면 아무것도 안 함)
function quitRunningApp() {
  try {
    const extra = (process.env.VIDSHELF_ELECTRON_ARGS || '').split(' ').filter(Boolean);
    spawnSync(electronPath(), [ROOT, ...extra, '--vidshelf-quit'], { cwd: ROOT, stdio: 'ignore', timeout: 20000 });
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},3000)']); // 완전히 꺼질 때까지 잠깐 기다림
  } catch (_) { /* 무시 */ }
}

function electronPath() {
  // node_modules/electron이 실행 파일 경로를 알려준다
  // eslint-disable-next-line global-require
  return require(path.join(ROOT, 'node_modules', 'electron'));
}

const LAUNCH_LOG = path.join(GIT, 'vidshelf-app.log'); // VidShelf가 남기는 출력 (켜지자마자 꺼질 때 원인 확인용)

// VidShelf 실행. restart=true면 이미 켜진 창을 새 버전으로 다시 켠다 (main.cjs가 처리)
// 출력은 로그 파일로 보낸다. waitMs를 주면 창이 뜰 때까지(로그에 VIDSHELF_READY)만 기다리고,
// 그 전에 꺼지면 그 이유를 돌려준다.
function launchApp(restart, { waitMs = 0 } = {}) {
  const extra = (process.env.VIDSHELF_ELECTRON_ARGS || '').split(' ').filter(Boolean); // 테스트용
  let out = 'ignore';
  let logStart = 0;
  try {
    if (fs.existsSync(LAUNCH_LOG) && fs.statSync(LAUNCH_LOG).size > 512 * 1024) fs.rmSync(LAUNCH_LOG, { force: true });
    fs.appendFileSync(LAUNCH_LOG, `\n===== ${new Date().toISOString()} 실행 ${restart ? '(새 버전으로 다시 켜기)' : ''}\n`);
    logStart = fs.statSync(LAUNCH_LOG).size;
    out = fs.openSync(LAUNCH_LOG, 'a');
  } catch { /* 로그 없이 실행 */ }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 이 값이 있으면 Electron이 창 없이 Node처럼 동작하다 바로 꺼진다
  delete env.NODE_OPTIONS; // Node용 옵션이 Electron에서는 지원되지 않아 문제를 일으킬 수 있다
  const child = spawn(electronPath(), [ROOT, ...extra, ...(restart ? ['--vidshelf-restart'] : [])], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: false, env,
  });
  child.unref();
  if (!waitMs) return Promise.resolve({ running: true });
  const readNew = () => {
    try {
      const buf = fs.readFileSync(LAUNCH_LOG);
      return buf.subarray(Math.min(logStart, buf.length)).toString('utf8');
    } catch { return ''; }
  };
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(r);
    };
    // 창이 뜨거나(READY) 이미 켜져 있던 창에 신호를 보냈으면(ALREADY_RUNNING) 바로 끝낸다
    timer = setInterval(() => {
      const t = readNew();
      if (t.includes('VIDSHELF_READY')) done({ running: true });
      else if (t.includes('VIDSHELF_ALREADY_RUNNING')) done({ running: false, alreadyRunning: true });
    }, 150);
    child.on('error', (e) => done({ running: false, error: e.message }));
    child.on('exit', (code) => {
      const t = readNew();
      if (t.includes('VIDSHELF_READY')) { done({ running: true }); return; } // 다른 창으로 넘겨 주고 끝난 경우 등
      const tail = t.split('\n').slice(-25).join('\n');
      done({ running: false, code, alreadyRunning: t.includes('VIDSHELF_ALREADY_RUNNING'), tail });
    });
    setTimeout(() => done({ running: true }), waitMs); // 너무 오래 걸리면 켜지는 중이라고 보고 닫는다
  });
}

// 바탕화면 바로가기 (Windows)
function makeShortcut() {
  if (!IS_WIN) return null;
  const q = (s) => s.replace(/'/g, "''");
  const ps = [
    "$d=[Environment]::GetFolderPath('Desktop')",
    "$p=Join-Path $d 'VidShelf.lnk'",
    '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($p)',
    `$s.TargetPath='${q(process.execPath)}'`,
    `$s.Arguments='"${q(path.join(ROOT, 'scripts', 'launch.cjs'))}"'`,
    `$s.WorkingDirectory='${q(ROOT)}'`,
    '$s.WindowStyle=7', // 최소화: 실행 도우미의 검은 창이 화면에 뜨지 않게
    `$s.IconLocation='${q(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'))},0'`,
    "$s.Description='VidShelf'",
    '$s.Save()',
    'Write-Output $p',
  ].join('; ');
  const enc = Buffer.from(ps, 'utf16le').toString('base64');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim() : null;
}

// git hook에서 불렸을 때: 보이는 업데이트 창을 따로 띄우고 바로 끝낸다 (GitHub Desktop을 붙잡지 않게)
function openUpdateWindow() {
  const script = path.join(ROOT, 'scripts', 'launch.cjs');
  if (IS_WIN) {
    spawn('cmd.exe', ['/c', 'start', 'VidShelf 업데이트', process.execPath, script, '--update'], {
      cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
  } else {
    spawn(process.execPath, [script, '--update'], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref();
  }
}

function waitKey(msg) {
  if (!process.stdin.isTTY) return Promise.resolve();
  say(msg);
  return new Promise((res) => { process.stdin.setRawMode?.(true); process.stdin.resume(); process.stdin.once('data', () => res()); });
}

// OneDrive 폴더 안에서는 구성 요소(수백 MB, 파일 수천 개)를 푸는 도중 OneDrive가 파일을 잡아서 설치가 깨진다
function oneDriveRoot() {
  if (!IS_WIN) return null;
  const roots = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean);
  const r = ROOT.toLowerCase();
  const hit = roots.find((o) => r.startsWith(path.resolve(o).toLowerCase() + path.sep));
  if (hit) return hit;
  return /\\onedrive( - [^\\]+)?\\/i.test(ROOT) ? 'OneDrive' : null;
}

async function main() {
  if (args.includes('--from-hook')) { openUpdateWindow(); return; }

  const od = oneDriveRoot();
  if (od) {
    say('✗ 이 폴더는 OneDrive 안에 있어서 설치할 수 없어요.');
    say(`  지금 위치: ${ROOT}\n`);
    say('OneDrive가 설치 파일을 푸는 도중에 동기화하면서 파일을 잡아 버려서 설치가 깨져요.');
    say('(구성 요소 수백 MB가 OneDrive에 올라가는 문제도 있어요)\n');
    say('이렇게 옮겨 주세요:');
    say('  1. GitHub Desktop → File → Clone repository → 이 저장소를 다시 받기');
    say('  2. Local path를 OneDrive 밖으로 바꿔요. 예: C:\\Users\\<이름>\\vidshelf');
    say('  3. Clone → 새 폴더의 "VidShelf 설치.cmd"를 실행해요');
    say('  4. 예전 저장소는 GitHub Desktop에서 Repository → Remove로 목록에서 빼요');
    await waitKey('\n아무 키나 누르면 이 창이 닫혀요.');
    process.exit(1);
  }

  try { process.title = 'VidShelf'; } catch { /* 무시 */ }

  if (args.includes('--setup')) {
    say('VidShelf 자동 업데이트 설정\n');
    say(ensureHook() ? '✓ GitHub Desktop [Pull origin] → 자동 업데이트 연결' : '! 이 폴더가 GitHub Desktop 저장소가 아니라서 자동 업데이트를 연결하지 못했어요');
    ensureBuilt({ force: !fs.existsSync(path.join(ROOT, 'node_modules', 'electron')) });
    const lnk = makeShortcut();
    if (lnk) say(`✓ 바탕화면 아이콘: ${lnk}`);
    launchApp(false);
    say('\n설정이 끝났어요. 앞으로는');
    say('  · GitHub Desktop에서 [Fetch origin] → [Pull origin]을 누르면 자동으로 업데이트돼요');
    say('  · 바탕화면 VidShelf 아이콘으로 켜면 새 버전이 있을 때 알아서 빌드한 뒤 켜져요');
    await waitKey('\n아무 키나 누르면 이 창이 닫혀요.');
    process.exit(0);
  }

  if (args.includes('--update')) {
    say('VidShelf 업데이트\n');
    ensureHook();
    ensureBuilt();
    // 바탕화면 아이콘을 지금 폴더 기준으로 다시 만든다 (폴더를 옮겼거나 아이콘이 깨졌을 때)
    const lnk = makeShortcut();
    if (lnk) say(`✓ 바탕화면 아이콘: ${lnk}`);
    launchApp(true);
    say('\n✓ 업데이트 완료. VidShelf를 새 버전으로 다시 켰어요. 이 창은 3초 뒤에 닫혀요.');
    setTimeout(() => process.exit(0), 3000);
    return;
  }

  if (args.includes('--report')) {
    // 아이콘으로 켰다가 실패했을 때 보이는 창으로 다시 띄워 이유를 보여 준다
    let tail = '';
    try { tail = fs.readFileSync(LAUNCH_LOG, 'utf8').split('\n').slice(-30).join('\n'); } catch { /* 없음 */ }
    say('✗ VidShelf가 켜지자마자 꺼졌어요.');
    say(`\n--- 마지막 기록 (${LAUNCH_LOG}) ---\n${tail || '(기록 없음)'}\n---`);
    say('\n이 창을 캡처해서 보내주세요.');
    await waitKey('\n아무 키나 누르면 이 창이 닫혀요.');
    process.exit(1);
  }

  // 기본: 바탕화면 아이콘(최소화된 창) / VidShelf 실행.cmd
  ensureHook();
  if (IS_WIN && needsBuild()) {
    // 새 버전 빌드는 시간이 걸리므로 진행 상황이 보이는 창에서 한다 (끝나면 그 창이 VidShelf를 켬)
    openUpdateWindow();
    return;
  }
  const built = ensureBuilt();
  if (built) makeShortcut(); // 새 버전을 빌드했으면 바탕화면 아이콘도 지금 폴더 기준으로 다시 만든다
  const r = await launchApp(built, { waitMs: 30000 });
  if (r.running) process.exit(0);
  if (r.alreadyRunning) process.exit(0); // 켜져 있던 창을 앞으로 가져옴
  if (IS_WIN) {
    spawn('cmd.exe', ['/c', 'start', 'VidShelf 오류', process.execPath, path.join(ROOT, 'scripts', 'launch.cjs'), '--report'], {
      cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
    process.exit(1);
  }
  say(`✗ VidShelf가 켜지자마자 꺼졌어요 (종료 코드 ${r.code ?? '-'}${r.error ? `, ${r.error}` : ''}).`);
  say(`\n--- 마지막 기록 (${LAUNCH_LOG}) ---\n${r.tail || '(기록 없음)'}\n---`);
  await waitKey('\n아무 키나 누르면 이 창이 닫혀요.');
  process.exit(1);
}

main().catch(async (e) => {
  console.error(`\n✗ 오류: ${e.message}`);
  console.error('이 창을 캡처해서 보내주세요.');
  await waitKey('\n아무 키나 누르면 이 창이 닫혀요.');
  process.exit(1);
});
