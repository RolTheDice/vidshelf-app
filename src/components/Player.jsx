import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { fmtTime, mediaUrl } from '../lib.js';
const SNAP_RANGE = 2; // ←/→ 기준 화면 맞춤 허용 범위(초): 10초 → 8~12초

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
// 소리 크기 자동 맞춤: 영상마다 소리가 크고 작은 걸 비슷하게. 들어오는 소리 크기를 재서 천천히 키우거나 줄이고,
// 갑자기 큰 소리는 압축기로 눌러 준다. 영상마다 잰 크기는 기억해서 다음에 열면 처음부터 맞춘다.
const TARGET_DB = -20; // 맞출 평균 소리 크기 (dBFS)
const MAX_BOOST_DB = 15;
const MAX_CUT_DB = -12;
const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 돼도 재생엔 문제없음 */ } };

// 표지 창 자리에서 재생하는 가벼운 플레이어
const gainFor = (loud) => Math.pow(10, Math.max(MAX_CUT_DB, Math.min(MAX_BOOST_DB, TARGET_DB - loud)) / 20);

export default function Player({
  video, hasPrev, hasNext, onPrev, onNext, onEnded, onClose, onCounted, queueLabel,
  shuffle, repeat, onShuffle, onRepeat, wide, onWide,
}) {
  const wrap = useRef(null);
  const vid = useRef(null);
  const watched = useRef(0);
  const lastT = useRef(0);
  const counted = useRef(false);
  // 아직 횟수로 세지 않은 시청 시간(초). 이번에 이미 1회 셌으면 0
  const pending = () => (counted.current ? 0 : Math.round(watched.current));
  const lastSave = useRef(0);
  const hideTimer = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(video.duration || 0);
  const [volume, setVolume] = useState(load('vs.volume', 0.8));
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [full, setFull] = useState(false);
  const [showUi, setShowUi] = useState(true);
  const [seekOsd, setSeekOsd] = useState(null); // 방향키로 이동했을 때 잠깐 보이는 작은 표시 (아래 조작 막대는 띄우지 않음)
  const osdTimer = useRef(null);
  const seekTarget = useRef(null); // ←/→로 가려는 위치 (건너뛰는 중에 더 누르면 여기만 바뀜)
  const keyframes = useRef(null); // 기준 화면 시각 목록 (MP4). 여기에 맞춰 건너뛰면 거의 바로 나온다
  const [autoLevel, setAutoLevel] = useState(load('vs.autoLevel', true));
  const audio = useRef(null); // Web Audio 연결 (처음 재생할 때 만들고 계속 씀)
  const [error, setError] = useState('');
  const [resumeAt, setResumeAt] = useState(0);

  // 영상이 바뀌면 상태 초기화
  useEffect(() => {
    // 재생 횟수: 이번에 본 시간만이 아니라, 전에 보다 만 시간까지 합쳐서 1분이 되면 1회
    watched.current = 0; lastT.current = 0; counted.current = false;
    window.vs.watchPending(video.id).then((p) => { watched.current += Number(p) || 0; }).catch(() => {});
    keyframes.current = null; seekTarget.current = null;
    window.vs.keyframes(video.id).then((k) => { keyframes.current = Array.isArray(k) && k.length > 1 ? k : null; }).catch(() => {});
    setError(''); setResumeAt(0); setTime(0);
    wrap.current?.focus();
  }, [video.id]);

  // 소리 크기: 자동 맞춤 연결이 있으면 영상 자체 소리는 그대로(1) 두고 맨 끝에서 줄인다 (자동 맞춤이 내 볼륨까지 되돌리지 않게)
  const applyVolume = () => {
    const v = vid.current;
    if (!v) return;
    const a = audio.current;
    if (a) { v.volume = 1; v.muted = false; a.out.gain.value = muted ? 0 : volume; }
    else { v.volume = volume; v.muted = muted; }
  };
  useEffect(() => { applyVolume(); keep('vs.volume', volume); }, [volume, muted]);

  const ensureAudio = () => {
    if (audio.current || !vid.current) return audio.current;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(vid.current);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      const agc = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 8; comp.attack.value = 0.005; comp.release.value = 0.25;
      const out = ctx.createGain();
      src.connect(an);
      src.connect(agc);
      out.connect(ctx.destination);
      audio.current = { ctx, an, agc, comp, out, buf: new Float32Array(an.fftSize), loud: null, lastKeep: 0 };
      route();
      applyVolume();
    } catch (_) { audio.current = null; }
    return audio.current;
  };
  // 자동 맞춤 켜짐: 소리 → 크기 조절 → 압축기 → 볼륨, 꺼짐: 소리 → 볼륨
  const route = () => {
    const a = audio.current;
    if (!a) return;
    try { a.agc.disconnect(); a.comp.disconnect(); } catch (_) { /* 처음엔 연결 없음 */ }
    if (autoLevelRef.current) { a.agc.connect(a.comp); a.comp.connect(a.out); }
    else { a.agc.gain.cancelScheduledValues(0); a.agc.gain.value = 1; a.agc.connect(a.out); }
  };
  const autoLevelRef = useRef(autoLevel);
  useEffect(() => { autoLevelRef.current = autoLevel; keep('vs.autoLevel', autoLevel); route(); }, [autoLevel]);

  // 영상이 바뀌면 전에 재 둔 소리 크기로 시작
  useEffect(() => {
    const a = audio.current;
    const saved = load('vs.loudness', {})[video.id];
    if (a) {
      a.loud = typeof saved === 'number' ? saved : null;
      if (autoLevelRef.current && a.loud != null) a.agc.gain.value = gainFor(a.loud);
      else a.agc.gain.value = 1;
    }
  }, [video.id]);

  // 재생 중에 소리 크기를 재서 천천히 맞추기
  useEffect(() => {
    if (!playing) return undefined;
    const tick = setInterval(() => {
      const a = audio.current;
      if (!a || !autoLevelRef.current) return;
      a.an.getFloatTimeDomainData(a.buf);
      let sum = 0;
      for (let i = 0; i < a.buf.length; i++) sum += a.buf[i] * a.buf[i];
      const db = 10 * Math.log10(sum / a.buf.length + 1e-12);
      if (db < -60) return; // 조용한 구간은 재지 않음 (거기에 맞춰 키우면 다음 소리가 너무 큼)
      a.loud = a.loud == null ? db : a.loud + (db - a.loud) * 0.04; // 몇 초에 걸쳐 천천히
      a.agc.gain.setTargetAtTime(gainFor(a.loud), a.ctx.currentTime, 0.8);
      if (wrap.current) wrap.current.dataset.level = `${a.loud.toFixed(1)}dB→${(TARGET_DB - a.loud).toFixed(1)}`;
      if (Date.now() - a.lastKeep > 5000) {
        a.lastKeep = Date.now();
        const all = load('vs.loudness', {});
        all[video.id] = Math.round(a.loud * 10) / 10;
        const ids = Object.keys(all);
        if (ids.length > 3000) delete all[ids[0]];
        keep('vs.loudness', all);
      }
    }, 200);
    return () => clearInterval(tick);
  }, [playing, video.id]);
  useEffect(() => { if (vid.current) vid.current.playbackRate = speed; }, [speed, video.id]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // 닫거나 다른 영상으로 넘어갈 때 위치 저장
  useEffect(() => {
    const id = video.id;
    return () => {
      const v = vid.current;
      if (v && v.currentTime > 0) window.vs.savePosition(id, v.ended ? 0 : v.currentTime, v.duration, pending());
    };
  }, [video.id]);

  const poke = () => {
    setShowUi(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowUi(false), 2500);
  };

  const toggle = () => { const v = vid.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); };
  const seek = (t) => { const v = vid.current; seekTarget.current = null; if (v) v.currentTime = Math.max(0, Math.min(t, v.duration || t)); };
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else wrap.current?.requestFullscreen().catch(() => {}); };

  const onMeta = () => {
    const v = vid.current;
    setDur(v.duration);
    const pos = video.lastPosition || 0;
    // 이어 보기: 10초 이상 봤고 끝나기 30초 전이면 그 자리부터
    if (pos > 10 && pos < v.duration - 30) { v.currentTime = pos; setResumeAt(pos); setTimeout(() => setResumeAt(0), 5000); }
    v.play().catch(() => {});
  };

  const onTime = () => {
    const v = vid.current;
    const t = v.currentTime;
    setTime(t);
    const d = t - lastT.current;
    if (d > 0 && d < 2) watched.current += d; // 건너뛰기는 시청 시간에 넣지 않음
    lastT.current = t;
    // 재생 횟수: 1분 이상(짧은 영상은 절반 이상) 보면 1회
    if (!counted.current && v.duration && watched.current >= Math.min(60, v.duration * 0.5)) {
      counted.current = true;
      window.vs.markPlayed(video.id).then((nv) => nv && onCounted(nv));
    }
    if (Date.now() - lastSave.current > 5000) { lastSave.current = Date.now(); window.vs.savePosition(video.id, t, v.duration, pending()); }
  };

  const onKey = (e) => {
    const k = e.key;
    const handled = {
      ' ': toggle, k: toggle,
      ArrowRight: () => seekBy(e.shiftKey ? 60 : 10),
      ArrowLeft: () => seekBy(e.shiftKey ? -60 : -10),
      ArrowUp: () => { setMuted(false); setVolume((x) => Math.min(1, +(x + 0.05).toFixed(2))); },
      ArrowDown: () => setVolume((x) => Math.max(0, +(x - 0.05).toFixed(2))),
      f: fullscreen, F: fullscreen, m: () => setMuted((x) => !x),
      l: () => setAutoLevel((x) => !x), L: () => setAutoLevel((x) => !x),
      n: () => hasNext && onNext(), p: () => hasPrev && onPrev(),
      t: () => onWide && onWide(), T: () => onWide && onWide(),
    }[k];
    if (!handled) return;
    e.preventDefault(); e.stopPropagation(); handled();
    if (k !== 'ArrowLeft' && k !== 'ArrowRight') poke(); // 앞뒤 이동은 조작 막대를 띄우지 않는다
  };
  // ←/→ 건너뛰기: 이전 건너뛰기가 아직 끝나지 않았으면 목표만 바꿔 두고, 끝나면 마지막 목표로 한 번에 간다.
  // (키를 꾹 누르거나 빠르게 여러 번 눌러도 건너뛰기가 쌓여서 화면이 멈춰 있지 않게)
  const seekStart = useRef(0);
  const seekInfo = useRef('');
  const showOsd = (text, ms = 900) => {
    setSeekOsd(text);
    clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => setSeekOsd(null), ms);
  };
  const seekBy = (d) => {
    const v = vid.current;
    if (!v) return;
    const base = seekTarget.current != null ? seekTarget.current : v.currentTime;
    let to = Math.max(0, Math.min(v.duration || 0, base + d));
    // 가까운 기준 화면으로 맞추기: 기준 화면은 바로 보여 줄 수 있어서 빠르다.
    // 앞으로 갈 땐 지금보다 뒤, 뒤로 갈 땐 지금보다 앞의 것 중 목표에서 가장 가까운 것.
    // 이동 거리가 들쭉날쭉하지 않게 목표에서 2초 이내일 때만 맞춘다 (10초 → 8~12초)
    const kf = keyframes.current;
    let snapped = false;
    if (kf) {
      let lo = 0, hi = kf.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (kf[mid] < to) lo = mid + 1; else hi = mid; }
      const cands = [kf[lo - 2], kf[lo - 1], kf[lo], kf[lo + 1]]
        .filter((x) => x != null && (d > 0 ? x > base + 0.5 : x < base - 0.5) && Math.abs(x - to) <= SNAP_RANGE);
      const best = cands.sort((a, b) => Math.abs(a - to) - Math.abs(b - to))[0];
      if (best != null) { to = best + 0.01; snapped = true; } // 반올림 오차로 앞 화면을 잡지 않게 살짝 뒤
    }
    seekTarget.current = to;
    setTime(to);
    if (!v.seeking) { v.currentTime = to; seekStart.current = performance.now(); }
    seekInfo.current = `${d > 0 ? '▶▶' : '◀◀'} ${fmtTime(to)}`;
    showOsd(seekInfo.current + (snapped || !/\.(mp4|m4v|mov)$/i.test(video.path) ? '' : ' · 정확한 위치로 (느릴 수 있음)'));
  };
  const onSeeked = () => {
    const v = vid.current;
    const t = seekTarget.current;
    if (v && t != null && Math.abs(v.currentTime - t) > 0.05) { v.currentTime = t; return; } // 그사이 더 누른 곳으로
    seekTarget.current = null;
    // 화면이 나오기까지 오래 걸렸으면 얼마나 걸렸는지 잠깐 보여 준다 (느린 파일 확인용)
    const ms = seekStart.current ? performance.now() - seekStart.current : 0;
    seekStart.current = 0;
    if (ms > 250 && seekInfo.current) showOsd(`${seekInfo.current} · ${(ms / 1000).toFixed(1)}초 걸림`, 1500);
  };

  const pct = dur ? (time / dur) * 100 : 0;

  return (
    <div ref={wrap} className={`player ${full ? 'full' : ''} ${showUi || !playing ? '' : 'hide-ui'}`} tabIndex={0}
      onKeyDown={onKey} onMouseMove={poke} onMouseLeave={() => playing && setShowUi(false)}>
      <video ref={vid} src={mediaUrl(video.path)} crossOrigin="anonymous" onClick={toggle} onDoubleClick={fullscreen}
        onLoadedMetadata={onMeta} onTimeUpdate={onTime} onSeeked={onSeeked}
        onPlay={() => { const a = ensureAudio(); if (a && a.ctx.state !== 'running') a.ctx.resume().catch(() => {}); setPlaying(true); poke(); }} onPause={() => { setPlaying(false); setShowUi(true); window.vs.savePosition(video.id, vid.current.currentTime, vid.current.duration, pending()); }}
        onEnded={() => { window.vs.savePosition(video.id, 0, vid.current.duration, pending()); onEnded(); }}
        onError={() => setError('이 파일은 내장 플레이어로 재생할 수 없어요.')} />

      {seekOsd && <div className="p-seek-osd">{seekOsd}</div>}

      {error && (
        <div className="p-error">
          <div>{error}</div>
          <button className="btn sm" onClick={() => window.vs.play(video.id)}><Icon name="external" size={14} />기본 플레이어로 열기</button>
        </div>
      )}
      {resumeAt > 0 && (
        <div className="p-toast">{fmtTime(resumeAt)}부터 이어서 재생 <span className="link" onClick={() => { seek(0); setResumeAt(0); }}>처음부터</span></div>
      )}

      <div className="p-top">
        <span className="p-title">{video.code || video.fileName}{queueLabel ? <span className="p-queue"> · {queueLabel}</span> : null}</span>
        <button className="p-btn" title="닫기 (표지 보기)" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>

      <div className="p-bar">
        <input className="p-seek" type="range" min="0" max={dur || 0} step="0.1" value={time}
          style={{ '--pct': `${pct}%` }} onChange={(e) => seek(Number(e.target.value))} />
        <div className="p-row">
          <button className="p-btn" onClick={onPrev} disabled={!hasPrev} title="이전 (P 또는 숫자 키패드 1)"><Icon name="prev" size={18} /></button>
          <button className="p-btn big" onClick={toggle} title="재생/일시정지 (Space)"><Icon name={playing ? 'pause' : 'play'} size={20} fill /></button>
          <button className="p-btn" onClick={onNext} disabled={!hasNext} title="다음 (N 또는 숫자 키패드 3)"><Icon name="next" size={18} /></button>
          <button className={`p-btn ${shuffle ? 'on' : ''}`} onClick={onShuffle} title="셔플"><Icon name="shuffle" size={17} /></button>
          <button className={`p-btn ${repeat !== 'off' ? 'on' : ''}`} onClick={onRepeat}
            title={repeat === 'one' ? '한 영상 반복' : repeat === 'all' ? '전체 반복' : '반복 안 함'}>
            <Icon name="repeat" size={17} />{repeat === 'one' && <span className="p-one">1</span>}
          </button>
          <span className="p-time">{fmtTime(time)} / {fmtTime(dur)}</span>
          <div className="spacer" />
          <button className="p-btn" onClick={() => setMuted((x) => !x)} title="음소거 (M)"><Icon name={muted || volume === 0 ? 'mute' : 'volume'} size={18} /></button>
          <input className="p-vol" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume}
            onChange={(e) => { setMuted(false); setVolume(Number(e.target.value)); }} />
          <button className={`p-btn p-text ${autoLevel ? 'on' : ''}`} onClick={() => setAutoLevel((x) => !x)}
            title={autoLevel ? '소리 크기 자동 맞춤 켜짐: 영상마다 다른 소리 크기를 비슷하게 맞춰요 (L)' : '소리 크기 자동 맞춤 꺼짐 (L)'}>음량 맞춤</button>
          <select className="p-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="재생 속도">
            {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
          <button className="p-btn" onClick={() => window.vs.play(video.id)} title="기본 플레이어로 열기"><Icon name="external" size={17} /></button>
          {onWide && (
            <button className={`p-btn ${wide ? 'on' : ''}`} onClick={onWide} title={wide ? '목록 다시 보기 (T)' : '넓게 보기: 양옆 목록 숨기기 (T)'}>
              <Icon name={wide ? 'narrow' : 'wide'} size={18} />
            </button>
          )}
          <button className="p-btn" onClick={fullscreen} title="전체 화면 (F)"><Icon name={full ? 'shrink' : 'expand'} size={18} /></button>
        </div>
      </div>
    </div>
  );
}
