// 화면 확인용 가짜 데이터 만들기 (가짜 영상 파일 + 자리표시 표지 + 정보)
// 사용: node tests/make-demo.cjs <작업폴더>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../electron/db.cjs');
const { scanFolder } = require('../electron/scanner.cjs');
const { findExistingCover } = require('../electron/cover.cjs');

const root = path.resolve(process.argv[2] || 'tests/.tmp/demo');
const media = path.join(root, 'media');
const data = path.join(root, 'data');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(media, '새로 받은 영상'), { recursive: true });

const items = [
  ['SLVL-043.mp4', 'SLVL-043', ['아오바 세나'], 'Silverline', 'Silverline Prime', '2026-10-18', 137, '#3b5b9a', 4.0],
  ['mpfr025_hd.mp4', 'MPFR-025', ['미즈키 하루'], 'Maple Frame', 'Maple Red', '2026-10-16', 103, '#9a4b3b', 3.6],
  ['[site] BLHB-045.mkv', 'BLHB-045', ['토모나 리코', '아오바 세나'], 'Blue Harbor', 'Harbor', '2026-10-15', 80, '#2f7f74', 3.7],
  ['QTGD-031.mp4', 'QTGD-031', ['아오바 세나'], 'Quiet Garden', 'Garden', '2026-10-15', 73, '#6b5a9e', 4.7],
  ['PMNF-060.mp4', 'PMNF-060', [], 'Paper Moon', 'Paper Moon Films', '2026-10-13', 82, '#8a6d2f', 1.9],
  ['LMNS-031.mp4', 'LMNS-031', ['하나세 유이'], 'Studio Lumen', 'Lumen', '2026-10-12', 95, '#7a3f6b', 3.1],
  ['NWPX-049.mp4', 'NWPX-049', ['미즈키 하루'], 'Northwind', 'Northwind Pictures', '2026-10-10', 120, '#3f6b8a', 2.8],
  ['새로 받은 영상/crlr-048.mp4', 'CRLR-048', null, '', '', '', null, null, 3.7],
  ['새로 받은 영상/여행 브이로그.mp4', null, null, '', '', '', null, null, 1.2],
];

const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const REAL = ['SLVL-043', 'MPFR-025', 'QTGD-031'];
for (const [file, code, , , , , , color, gb] of items) {
  const p = path.join(media, file);
  if (REAL.includes(code)) {
    // 실제로 재생되는 30초짜리 mp4 (플레이어 확인용)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '30',
      '-c:v', 'libx264', '-b:v', '1500k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', p]);
  } else {
    fs.writeFileSync(p, Buffer.alloc(1024 * 1024 + 1));
    fs.truncateSync(p, Math.round(gb * 1024 ** 3)); // 빈 공간 파일(실제 용량 안 씀)
  }
  if (code && color) {
    const out = path.join(path.dirname(p), code + '.jpg');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${color}@1:s=800x538`,
      '-vf', `drawbox=x=0:y=0:w=400:h=538:color=black@0.45:t=fill,` +
        `drawbox=x=440:y=40:w=320:h=458:color=white@0.12:t=fill,` +
        `drawtext=fontfile=${font}:text='${code}':fontcolor=white:fontsize=46:x=600-text_w/2:y=230,` +
        `drawtext=fontfile=${font}:text='SAMPLE COVER':fontcolor=white@0.6:fontsize=18:x=600-text_w/2:y=300,` +
        `drawtext=fontfile=${font}:text='BACK':fontcolor=white@0.35:fontsize=22:x=200-text_w/2:y=260`,
      '-frames:v', '1', out]);
  }
}

(async () => {
  const store = new Store(data);
  const folder = { id: 'demo', path: media, addedAt: Date.now() };
  store.folders.push(folder);
  await scanFolder(store, folder, (v) => findExistingCover(v, path.join(data, 'covers')));
  let t = Date.now();
  for (const v of Object.values(store.videos)) {
    const it = items.find((x) => path.join(media, x[0]) === v.path);
    v.addedAt = t -= 60000;
    if (!it || !it[2]) continue;
    const [, , actors, maker, label, date, runtime] = it;
    Object.assign(v, {
      actors, maker, label, releaseDate: date, runtime, status: 'done', fetchedAt: Date.now(),
      title: '작품 제목이 여기에 표시돼요 (사이트에서 받은 제목)', series: label + ' 시리즈', director: '감독 이름',
      genres: ['단독작품', '드라마'], rating: actors.length ? 3 : 0,
    });
    actors.forEach((a) => store.ensureActor(a));
  }
  const crlr = Object.values(store.videos).find((v) => v.code === 'CRLR-048');
  if (crlr) { crlr.status = 'notfound'; crlr.lastError = '검색 결과 없음'; }
  store.save(true);
  console.log('demo ready:', root);
})();
