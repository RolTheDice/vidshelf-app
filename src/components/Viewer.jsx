import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import Player from './Player.jsx';
import { fmtSize, fmtTime, imgUrl, STATUS_LABEL } from '../lib.js';

function Stars({ value, onChange }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? 'on' : ''} onClick={() => onChange(n === value ? 0 : n)} title={`${n}점`}>★</button>
      ))}
    </span>
  );
}

// 왼쪽 큰 표지 창(또는 플레이어) + 영상 정보
export default function Viewer({ video, emptyText, onUpdate, onGo, onEdit, onRefetch, busy, player, onPlay, onAddToPlaylist, onDelete }) {
  const [memo, setMemo] = useState(video?.memo || '');
  const [zoom, setZoom] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setMemo(video?.memo || ''); setBroken(false); }, [video?.id, video?.cover]);

  if (!video) {
    return <div className="empty"><Icon name="image" size={40} /><div>{emptyText || '오른쪽 목록에서 영상을 선택하세요'}</div></div>;
  }

  const v = video;
  const src = !broken && imgUrl(v.cover, v.coverVersion || v.fetchedAt);

  return (
    <div className="viewer">
      {player ? (
        <Player key={player.playKey || video.id} video={video} {...player} onCounted={onUpdate} />
      ) : (
      <div className="cover-box">
        {src ? (
          <img src={src} alt={v.code || v.fileName} onClick={() => setZoom(true)} onError={() => setBroken(true)} />
        ) : (
          <div className="cover-empty">
            <div className="code">{v.code || '품번 없음'}</div>
            <div>{v.code ? '표지가 아직 없어요' : '파일 이름에서 품번을 찾지 못했어요. 정보 수정에서 직접 입력하세요.'}</div>
            <div className="btns">
              {v.code && <button className="btn sm" onClick={() => onRefetch(v.id)} disabled={busy}><Icon name="wand" size={14} />정보·표지 받기</button>}
              <button className="btn sm" onClick={() => window.vs.chooseCover(v.id).then(onUpdate)}><Icon name="image" size={14} />표지 직접 지정</button>
            </div>
          </div>
        )}
        <button className="cover-play" onClick={() => onPlay(v.id)} title="재생"><Icon name="play" size={26} fill /></button>
      </div>
      )}

      <div className="v-head">
        <div className="v-code">{v.code || v.fileName}</div>
        <span className={`status ${v.status}`}>{STATUS_LABEL[v.status] || v.status}</span>
        <div className="spacer" />
        <Stars value={v.rating || 0} onChange={(rating) => window.vs.updateVideo(v.id, { rating }).then(onUpdate)} />
        <button className={`heart ${v.favorite ? 'on' : ''}`} title="즐겨찾기"
          onClick={() => window.vs.updateVideo(v.id, { favorite: !v.favorite }).then(onUpdate)}>
          <Icon name="heart" size={20} fill={v.favorite} />
        </button>
      </div>
      <div className="v-title">{v.title || (v.status === 'done'
        ? '제목 정보가 아직 없어요 — r18.dev에 올라오면 정리할 때 자동으로 채워요'
        : v.lastError ? `정보 없음 — ${v.lastError}` : '아직 정보를 가져오지 않았어요')}</div>
      {v.titleJa && v.titleJa !== v.title && <div className="v-title-ja" title="원제 (일본어)">{v.titleJa}</div>}

      <div className="info">
        <span className="k">출연</span>
        <span className="v">
          {v.actors?.length ? v.actors.map((a, i) => (
            <span key={a}>{i > 0 && ', '}<span className="link" onClick={() => onGo('actor', a)}>{a}</span></span>
          )) : <span style={{ color: 'var(--faint)' }}>배우 정보 없음</span>}
        </span>
        <span className="k">제작사</span>
        <span className="v">{v.maker ? <span className="link" onClick={() => onGo('maker', v.maker)}>{v.maker}</span> : '-'}</span>
        <span className="k">레이블</span>
        <span className="v">{v.label ? <span className="link" onClick={() => onGo('label', v.label)}>{v.label}</span> : '-'}</span>
        <span className="k">시리즈</span>
        <span className="v">{v.series || '-'}</span>
        <span className="k">감독</span><span className="v">{v.director || '-'}</span>
        <span className="k">발매일</span><span className="v">{v.releaseDate || '-'}</span>
        <span className="k">재생시간</span><span className="v">{v.runtime ? `${v.runtime}분` : '-'}</span>
        {v.genres?.length > 0 && (<>
          <span className="k">장르</span>
          <span className="v tags">{v.genres.map((g) => <span key={g} className="tag" onClick={() => onGo('genre', g)}>{g}</span>)}</span>
        </>)}
        <span className="k">파일</span>
        <span className="v" style={{ color: 'var(--muted)' }}>{v.path}{v.missing && <b style={{ color: 'var(--red)' }}> (파일 없음)</b>}</span>
        <span className="k">용량 · 재생</span>
        <span className="v" style={{ color: 'var(--muted)' }}>
          {fmtSize(v.size)} · {v.playCount || 0}회 재생
          <span className="pc-adj">
            <button className="btn xs ghost" title="재생 횟수 1 줄이기" disabled={!v.playCount}
              onClick={() => window.vs.changePlayCount(v.id, -1).then(onUpdate)}>−1</button>
            <button className="btn xs ghost" title="재생 횟수 1 늘리기 (다른 곳에서 본 경우 등)"
              onClick={() => window.vs.changePlayCount(v.id, 1).then(onUpdate)}>+1</button>
          </span>
          {v.lastPlayed ? ` · 마지막 재생 ${new Date(v.lastPlayed).toLocaleDateString('ko-KR')}` : ''}
          {v.lastPosition > 10 ? ` · ${fmtTime(v.lastPosition)}까지 봄` : ''}
          {v.hasSub ? ' · 자막 있음' : ''}
        </span>
      </div>

      <div className="actions">
        <button className="btn primary" onClick={() => onPlay(v.id)}><Icon name="play" size={14} fill />{v.lastPosition > 10 ? '이어 보기' : '재생'}</button>
        <button className="btn" onClick={() => window.vs.play(v.id).then(() => onUpdate({ ...v, playCount: (v.playCount || 0) + 1, lastPlayed: Date.now() }))}><Icon name="external" size={14} />기본 플레이어</button>
        <button className="btn" onClick={() => onAddToPlaylist([v.id])}><Icon name="listPlus" size={14} />재생목록에 추가</button>
        <button className="btn" onClick={() => window.vs.reveal(v.id)}><Icon name="folder" size={14} />폴더 열기</button>
        <button className="btn" onClick={() => onRefetch(v.id)} disabled={busy || !v.code}><Icon name="refresh" size={14} />정보 다시 받기</button>
        <button className="btn" onClick={() => window.vs.chooseCover(v.id).then(onUpdate)}><Icon name="image" size={14} />표지 지정</button>
        <button className="btn" onClick={() => onEdit(v)}><Icon name="edit" size={14} />정보 수정</button>
        <button className="btn danger" onClick={() => onDelete([v.id])}><Icon name="trash" size={14} />삭제</button>
      </div>

      <textarea className="memo" placeholder="메모" value={memo} onChange={(e) => setMemo(e.target.value)}
        onBlur={() => memo !== (v.memo || '') && window.vs.updateVideo(v.id, { memo }).then(onUpdate)} />
      {v.story && <div className="story">{v.story}</div>}

      {zoom && src && <div className="lightbox" onClick={() => setZoom(false)}><img src={src} alt="" /></div>}
    </div>
  );
}
