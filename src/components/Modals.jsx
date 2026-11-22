import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// 정리하기: 품번 읽기 → r18.dev(·품번기) 정보 → 표지 받기 (파일은 옮기지 않음)
export function OrganizeModal({ videos, settings = {}, progress, onStart, onCancel, onClose, dataDir }) {
  const logRef = useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [progress.logs.length]);

  const live = videos.filter((v) => !v.missing);
  const fresh = live.filter((v) => v.status === 'new' || (v.status === 'done' && !v.cover)).length;
  const failed = live.filter((v) => ['notfound', 'coveronly', 'error'].includes(v.status)).length;
  const noCode = live.filter((v) => !v.code).length;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const started = progress.running || progress.finished;

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 620 }}>
        <h3>정리하기</h3>
        <div className="sub">파일 이름에서 품번을 읽고, {[settings.useR18 !== false && 'r18.dev', settings.usePoomki && '품번기'].filter(Boolean).join('·') || '(정보 가져오기 꺼짐)'}에서 배우·레이블·장르 정보를, DMM에서 표지를 받아와요. <b>영상 파일은 옮기거나 바꾸지 않아요.</b></div>

        {!started && (<>
          <div className="stat-row">
            <div className="stat"><div className="l">새 영상</div><div className="n">{fresh}</div></div>
            <div className="stat"><div className="l">정보 못 찾은 영상</div><div className="n">{failed}</div></div>
            <div className="stat"><div className="l">품번 없음</div><div className="n">{noCode}</div></div>
          </div>
          <div className="sub" style={{ fontSize: 12 }}>
            시작하면 등록한 폴더를 먼저 다시 읽어서 새로 넣은 파일을 찾아요. 이미 정리한 영상은 건너뛰고, 같은 품번이 이미 정리돼 있으면 사이트에 다시 묻지 않고 그 정보를 그대로 써요.
          </div>

        </>)}

        {started && (<>
          <div className="inline" style={{ justifyContent: 'space-between' }}>
            <span>{progress.running ? `진행 중: ${progress.current || ''}` : progress.cancelled ? '중지했어요' : '끝났어요'}</span>
            <span style={{ color: 'var(--muted)' }}>{progress.done} / {progress.total}</span>
          </div>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
          <div className="logbox" ref={logRef}>
            {progress.logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </>)}

        <div className="foot">
          {!started && (<>
            <button className="btn ghost" onClick={onClose}>닫기</button>
            <button className="btn ghost" onClick={() => onStart('all')} title="이미 정리한 영상까지 전부 다시 받아요">전체 다시 받기</button>
            <button className="btn" onClick={() => onStart('retry')} disabled={!failed}><Icon name="refresh" size={14} />못 찾은 것 다시 시도 ({failed})</button>
            <button className="btn primary" onClick={() => onStart('new')}><Icon name="wand" size={14} />새 영상 정리</button>
          </>)}
          {progress.running && <button className="btn danger" onClick={onCancel}>중지</button>}
          {progress.finished && !progress.running && <button className="btn primary" onClick={onClose}>확인</button>}
        </div>
      </div>
    </div>
  );
}

const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function EditModal({ video, onSave, onClose }) {
  const [f, setF] = useState({
    code: video.code || '', title: video.title || '', actors: (video.actors || []).join(', '), maker: video.maker || '',
    label: video.label || '', series: video.series || '', director: video.director || '', releaseDate: video.releaseDate || '',
    runtime: video.runtime || '', genres: (video.genres || []).join(', '),
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => onSave({
    ...f, actors: split(f.actors), genres: split(f.genres), runtime: f.runtime ? Number(f.runtime) : null,
  });

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>정보 수정</h3>
        <div className="sub">{video.fileName}<br />직접 고친 영상은 "정리하기"를 다시 해도 덮어쓰지 않아요.</div>
        <div className="grid2">
          <div className="field"><label>품번</label><input value={f.code} onChange={set('code')} placeholder="ABC-123" /></div>
          <div className="field"><label>발매일</label><input value={f.releaseDate} onChange={set('releaseDate')} placeholder="2026-11-10" /></div>
        </div>
        <div className="field"><label>제목</label><input value={f.title} onChange={set('title')} /></div>
        <div className="field"><label>출연 배우 (쉼표로 구분)</label><input value={f.actors} onChange={set('actors')} /></div>
        <div className="grid2">
          <div className="field"><label>제작사</label><input value={f.maker} onChange={set('maker')} /></div>
          <div className="field"><label>레이블</label><input value={f.label} onChange={set('label')} /></div>
          <div className="field"><label>시리즈</label><input value={f.series} onChange={set('series')} /></div>
          <div className="field"><label>감독</label><input value={f.director} onChange={set('director')} /></div>
        </div>
        <div className="grid2">
          <div className="field"><label>장르 (쉼표로 구분)</label><input value={f.genres} onChange={set('genres')} /></div>
          <div className="field"><label>재생시간 (분)</label><input value={f.runtime} onChange={set('runtime')} type="number" /></div>
        </div>
        <div className="foot">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

// 삭제 확인 (기본: 휴지통)
export function DeleteModal({ videos, onConfirm, onClose }) {
  const [withCover, setWithCover] = useState(true);
  const [permanent, setPermanent] = useState(false);
  const [busy, setBusy] = useState(false);
  const one = videos.length === 1;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal">
        <h3>{one ? '이 영상을 삭제할까요?' : `영상 ${videos.length}개를 삭제할까요?`}</h3>
        <div className="sub">
          {permanent ? '휴지통을 거치지 않고 완전히 지워요. 되살릴 수 없어요.' : '휴지통으로 보내요. 휴지통에서 되살릴 수 있어요.'}
        </div>
        <div className="del-list">
          {videos.slice(0, 8).map((v) => <div key={v.id}>{v.code || v.fileName} <span style={{ color: 'var(--faint)' }}>— {v.path}</span></div>)}
          {videos.length > 8 && <div style={{ color: 'var(--faint)' }}>외 {videos.length - 8}개</div>}
        </div>
        <label className="check"><input type="checkbox" checked={withCover} onChange={(e) => setWithCover(e.target.checked)} /> 표지 이미지(jpg)도 함께 지우기</label>
        <label className="check danger"><input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} /> 휴지통을 거치지 않고 완전히 삭제</label>
        <div className="foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>취소</button>
          <button className={`btn ${permanent ? 'danger-fill' : 'primary'}`} disabled={busy}
            onClick={() => { setBusy(true); onConfirm({ withCover, permanent }); }}>
            <Icon name="trash" size={14} />{busy ? '삭제 중…' : permanent ? '완전 삭제' : '휴지통으로 보내기'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 재생목록에 추가
export function PlaylistPickerModal({ count, playlists, onPick, onCreate, onClose }) {
  const [name, setName] = useState('');
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 440 }}>
        <h3>재생목록에 추가</h3>
        <div className="sub">영상 {count}개를 넣을 재생목록을 고르세요. 이미 들어 있는 영상은 중복으로 넣지 않아요.</div>
        <div className="pl-pick">
          {playlists.length === 0 && <div style={{ color: 'var(--faint)', padding: 8 }}>아직 재생목록이 없어요. 아래에서 새로 만드세요.</div>}
          {playlists.map((p) => (
            <div key={p.id} className="gitem" onClick={() => onPick(p.id)}>
              <Icon name="list" size={15} /><span className="name">{p.name}</span><span className="cnt">{p.items.length}</span>
            </div>
          ))}
        </div>
        <div className="inline" style={{ marginTop: 12 }}>
          <input className="text-in" style={{ flex: 1 }} value={name} placeholder="새 재생목록 이름" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate(name.trim())} autoFocus />
          <button className="btn primary" disabled={!name.trim()} onClick={() => onCreate(name.trim())}><Icon name="plus" size={14} />만들고 추가</button>
        </div>
        <div className="foot"><button className="btn ghost" onClick={onClose}>닫기</button></div>
      </div>
    </div>
  );
}

// 이름 입력 (재생목록 만들기·이름 바꾸기)
export function PromptModal({ title, initial = '', okLabel = '확인', onOk, onClose }) {
  const [value, setValue] = useState(initial);
  const ok = () => value.trim() && onOk(value.trim());
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 400 }}>
        <h3>{title}</h3>
        <input className="text-in" style={{ width: '100%', marginTop: 8 }} value={value} autoFocus
          onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
        <div className="foot">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={ok} disabled={!value.trim()}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}

// 배우 이름 지우기
export function RemoveActorModal({ name, count, onConfirm, onClose }) {
  const [block, setBlock] = useState(true);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 460 }}>
        <h3>"{name}"을(를) 지울까요?</h3>
        <div className="sub">
          이 배우가 들어간 영상 {count}개의 출연 정보에서 이름만 빠지고, 배우 목록에서도 사라져요. 영상 파일은 그대로예요.
          다른 출연 배우가 없는 영상은 "배우 미상"으로 보여요.
        </div>
        <label className="check"><input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> 나중에 정보를 다시 받아도 이 이름은 넣지 않기</label>
        <div className="foot">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn danger-fill" onClick={() => onConfirm({ block })}><Icon name="trash" size={14} />지우기</button>
        </div>
      </div>
    </div>
  );
}
