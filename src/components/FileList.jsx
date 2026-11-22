import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { fmtSize, imgUrl, STATUS_LABEL } from '../lib.js';

const ROW = 58;
const HEAD = 37;

// 오른쪽 파일 목록 (많아도 빠르게: 보이는 줄만 그린다)
// 클릭: 하나 선택 / Ctrl+클릭: 추가·빼기 / Shift+클릭: 범위 선택 / 더블클릭·Enter: 재생 / Delete: 삭제
export default function FileList({
  videos, selectedIds, primaryId, playingId, onSelect, onSelectAll, onPlay, onDelete,
  reorderable, onReorder, bulkBar,
}) {
  const ref = useRef(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(800);
  const [drag, setDrag] = useState(null); // { from, over }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 선택한 줄이 화면 밖이면 스크롤
  useEffect(() => {
    const el = ref.current;
    const i = videos.findIndex((v) => v.id === primaryId);
    if (!el || i < 0) return;
    const top = i * ROW;
    const head = HEAD + (bulkBar ? 44 : 0);
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW + head > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW + head - el.clientHeight;
  }, [primaryId, videos, bulkBar]);

  const onKey = (e) => {
    const i = videos.findIndex((v) => v.id === primaryId);
    if (e.key === 'ArrowDown' && i < videos.length - 1) { e.preventDefault(); onSelect(videos[i + 1].id, e); }
    else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); onSelect(videos[i - 1].id, e); }
    else if (e.key === 'Enter' && i >= 0) onPlay(videos[i].id);
    else if (e.key === 'Delete') onDelete();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); onSelectAll(); }
  };

  const start = Math.max(0, Math.floor(scroll / ROW) - 5);
  const end = Math.min(videos.length, Math.ceil((scroll + height) / ROW) + 5);

  return (
    <div className="col" ref={ref} tabIndex={0} onKeyDown={onKey} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} style={{ outline: 'none' }}>
      <div className="list-sticky">
        <div className="list-head">
          <span>{videos.length.toLocaleString()}개{selectedIds.size > 1 ? ` · ${selectedIds.size}개 선택` : ''}</span>
          <span>{reorderable ? '끌어서 순서 바꾸기 · ' : ''}Ctrl·Shift 여러 개 선택 · Enter 재생</span>
        </div>
        {bulkBar}
      </div>
      <div style={{ height: videos.length * ROW, position: 'relative' }}>
        {videos.slice(start, end).map((v, k) => {
          const i = start + k;
          const sel = selectedIds.has(v.id);
          return (
            <div key={v.id}
              className={`row ${sel ? 'sel' : ''} ${v.id === primaryId ? 'primary' : ''} ${v.missing ? 'missing' : ''} ${drag && drag.over === i ? 'drop' : ''}`}
              style={{ position: 'absolute', top: i * ROW, left: 0, right: 0 }}
              onMouseDown={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault(); }}
              onClick={(e) => onSelect(v.id, e)} onDoubleClick={() => onPlay(v.id)}
              draggable={!!reorderable}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ from: i, over: i }); }}
              onDragOver={(e) => { if (drag) { e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); } }}
              onDrop={(e) => { e.preventDefault(); if (drag && drag.from !== i) onReorder(drag.from, i); setDrag(null); }}
              onDragEnd={() => setDrag(null)}>
              {reorderable && <span className="grip"><Icon name="grip" size={14} /></span>}
              <div className="thumb">{v.cover ? <img src={imgUrl(v.cover, v.coverVersion || v.fetchedAt)} alt="" loading="lazy" draggable={false} /> : '표지 없음'}</div>
              <div className="main">
                <div className="c">
                  {v.id === playingId && <span className="now"><Icon name="play" size={10} fill /></span>}
                  {v.code || v.fileName}
                </div>
                <div className="s">
                  {(v.actors?.length ? v.actors.join(', ') : '배우 정보 없음')} · {v.maker || '-'} · {fmtSize(v.size)}
                  {v.playCount ? ` · ${v.playCount}회 재생` : ''}
                  {v.hasSub ? <span className="sub-tag" title="자막 파일 있음">자막</span> : null}
                </div>
              </div>
              <span className={`sdot ${v.status}`} title={STATUS_LABEL[v.status]} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
