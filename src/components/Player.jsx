import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { fmtTime, mediaUrl } from '../lib.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 돼도 재생엔 문제없음 */ } };

// 표지 창 자리에서 재생하는 가벼운 플레이어
export default function Player({
  video, hasPrev, hasNext, onPrev, onNext, onEnded, onClose, onCounted, queueLabel,
  shuffle, repeat, onShuffle, onRepeat, wide, onWide,
}) {
  const wrap = useRef(null);
  const vid = useRef(null);
  const watched = useRef(0);
  const lastT = useRef(0);
  const counted = useRef(false);
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
  const [error, setError] = useState('');
  const [resumeAt, setResumeAt] = useState(0);

  // 영상이 바뀌면 상태 초기화
  useEffect(() => {
    watched.current = 0; lastT.current = 0; counted.current = false;
    setError(''); setResumeAt(0); setTime(0);
    wrap.current?.focus();
  }, [video.id]);

  useEffect(() => { if (vid.current) { vid.current.volume = volume; vid.current.muted = muted; } keep('vs.volume', volume); }, [volume, muted]);
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
      if (v && v.currentTime > 0) window.vs.savePosition(id, v.ended ? 0 : v.currentTime, v.duration);
    };
  }, [video.id]);

  const poke = () => {
    setShowUi(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowUi(false), 2500);
  };

  const toggle = () => { const v = vid.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); };
  const seek = (t) => { const v = vid.current; if (v) v.currentTime = Math.max(0, Math.min(t, v.duration || t)); };
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
    if (Date.now() - lastSave.current > 5000) { lastSave.current = Date.now(); window.vs.savePosition(video.id, t, v.duration); }
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
      n: () => hasNext && onNext(), p: () => hasPrev && onPrev(),
      t: () => onWide && onWide(), T: () => onWide && onWide(),
    }[k];
    if (!handled) return;
    e.preventDefault(); e.stopPropagation(); handled();
    if (k !== 'ArrowLeft' && k !== 'ArrowRight') poke(); // 앞뒤 이동은 조작 막대를 띄우지 않는다
  };
  const seekBy = (d) => {
    const v = vid.current;
    if (!v) return;
    const to = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
    seek(to);
    setSeekOsd(`${d > 0 ? '▶▶' : '◀◀'} ${Math.abs(d) >= 60 ? `${Math.abs(d) / 60}분` : `${Math.abs(d)}초`} · ${fmtTime(to)}`);
    clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => setSeekOsd(null), 900);
  };

  const pct = dur ? (time / dur) * 100 : 0;

  return (
    <div ref={wrap} className={`player ${full ? 'full' : ''} ${showUi || !playing ? '' : 'hide-ui'}`} tabIndex={0}
      onKeyDown={onKey} onMouseMove={poke} onMouseLeave={() => playing && setShowUi(false)}>
      <video ref={vid} src={mediaUrl(video.path)} onClick={toggle} onDoubleClick={fullscreen}
        onLoadedMetadata={onMeta} onTimeUpdate={onTime}
        onPlay={() => { setPlaying(true); poke(); }} onPause={() => { setPlaying(false); setShowUi(true); window.vs.savePosition(video.id, vid.current.currentTime, vid.current.duration); }}
        onEnded={() => { window.vs.savePosition(video.id, 0, vid.current.duration); onEnded(); }}
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
