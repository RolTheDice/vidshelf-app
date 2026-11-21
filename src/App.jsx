import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './components/Icon.jsx';
import Viewer from './components/Viewer.jsx';
import FileList from './components/FileList.jsx';
import { OrganizeModal, EditModal, DeleteModal, PlaylistPickerModal, PromptModal, RemoveActorModal } from './components/Modals.jsx';
import { ActorsPage, SettingsPage } from './components/Pages.jsx';
import { GROUPINGS, SORTS, UNKNOWN, buildGroups, filterByGroup, searchVideos, sortVideos, imgUrl, isRecentUnwatched } from './lib.js';

const EMPTY_PROGRESS = { running: false, finished: false, done: 0, total: 0, current: '', logs: [] };
const loadPref = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const savePref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 무시 */ } };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export default function App() {
  const [lib, setLib] = useState(null);
  const [page, setPage] = useState('library');
  const [grouping, setGrouping] = useState('all');
  const [groupKey, setGroupKey] = useState(null);
  const [groupQ, setGroupQ] = useState('');
  const [q, setQ] = useState('');

  // 선택: 여러 개 선택 + 기준(primary) + Shift 범위 시작점(anchor)
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [primaryId, setPrimaryId] = useState(null);
  const [anchorId, setAnchorId] = useState(null);

  // 재생: 지금 재생 중인 영상과 재생 순서(queue)
  const [playing, setPlaying] = useState(null); // { id, queue, label, nonce }
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // off | all | one

  const [edit, setEdit] = useState(null);
  const [delIds, setDelIds] = useState(null);
  const [pickIds, setPickIds] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [toast, setToast] = useState('');
  const [rmActor, setRmActor] = useState(null); // { name, count }
  const [photoProgress, setPhotoProgress] = useState(null);
  const [dropActive, setDropActive] = useState(false); // 파일을 창 위로 끌고 있는 중

  // 화면 나누기: 왼쪽 묶음 칸·오른쪽 목록 칸 너비 (경계선을 끌어서 조절), 넓게 보기
  const [groupW, setGroupW] = useState(() => loadPref('vs.groupW', 230));
  const [listW, setListW] = useState(() => loadPref('vs.listW', 440));
  const [wide, setWide] = useState(() => loadPref('vs.wide', false));
  const [groupHidden, setGroupHidden] = useState(() => loadPref('vs.groupHidden', false)); // 왼쪽 칸 숨기기
  const toggleGroup = () => setGroupHidden((h) => { savePref('vs.groupHidden', !h); return !h; });
  const [dragging, setDragging] = useState(null);
  const startDrag = (which) => (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = which === 'group' ? groupW : listW;
    setDragging(which);
    document.body.classList.add('resizing');
    let last = w0;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (which === 'group') { last = Math.max(160, Math.min(460, w0 + dx)); setGroupW(last); }
      else { last = Math.max(260, Math.min(window.innerWidth - 520, w0 - dx)); setListW(last); }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      setDragging(null);
      savePref(which === 'group' ? 'vs.groupW' : 'vs.listW', last);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };


  useEffect(() => {
    window.vs.getLibrary().then(setLib);
    const offs = [
      window.vs.onVideoChanged((v) => setLib((l) => l && ({ ...l, videos: l.videos.map((x) => (x.id === v.id ? v : x)) }))),
      window.vs.onLibraryChanged((l) => setLib(l)),
      window.vs.onActorsProgress((p) => setPhotoProgress(p)),
      window.vs.onProgress((p) => setProgress((prev) => {
        if (p.reset) return { ...EMPTY_PROGRESS, ...p, logs: [] };
        if (p.log) return { ...prev, logs: [...prev.logs.slice(-800), p.log] };
        return { ...prev, ...p };
      })),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  const updateVideo = useCallback((v) => {
    if (!v || !v.id) return;
    setLib((l) => ({ ...l, videos: l.videos.map((x) => (x.id === v.id ? v : x)) }));
  }, []);

  const videos = lib?.videos || [];
  const playlists = lib?.playlists || [];
  const sort = lib?.settings.sort || 'added';
  const sortDir = lib?.settings.sortDir || 'desc';
  const byId = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);
  const activePlaylist = grouping === 'playlist' ? playlists.find((p) => p.id === groupKey) : null;

  const groups = useMemo(() => buildGroups(videos, grouping), [videos, grouping]);
  const visibleGroups = useMemo(() => {
    const s = groupQ.trim().toLowerCase();
    return s ? groups.filter((g) => g.name.toLowerCase().includes(s)) : groups;
  }, [groups, groupQ]);

  const shown = useMemo(() => {
    if (grouping === 'playlist') {
      const items = activePlaylist ? activePlaylist.items.map((id) => byId.get(id)).filter(Boolean) : [];
      return searchVideos(items, q); // 재생목록은 정한 순서 그대로
    }
    const recentDays = lib?.settings.recentDays ?? 30;
    const list = searchVideos(filterByGroup(videos, grouping, groupKey, { recentDays }), q);
    // 최근 추가는 항상 새로 들어온 순서
    return grouping === 'new' ? sortVideos(list, 'added', 'desc') : sortVideos(list, sort, sortDir);
  }, [videos, byId, grouping, groupKey, activePlaylist, q, sort, sortDir, lib?.settings.recentDays]);
  const recentCount = useMemo(
    () => videos.filter((v) => isRecentUnwatched(v, lib?.settings.recentDays ?? 30)).length,
    [videos, lib?.settings.recentDays],
  );

  // 목록이 바뀌었는데 선택한 영상이 없으면 첫 번째를 선택
  // 목록이 비면 선택도 비운다 (다른 분류에서 고른 영상이 계속 보이지 않게)
  useEffect(() => {
    if (shown.length && !shown.some((v) => v.id === primaryId)) {
      setPrimaryId(shown[0].id); setAnchorId(shown[0].id); setSelectedIds(new Set([shown[0].id]));
    } else if (!shown.length && (primaryId || selectedIds.size)) {
      setPrimaryId(null); setAnchorId(null); setSelectedIds(new Set());
    }
  }, [shown, primaryId, selectedIds.size]);

  const onSelect = (id, e = {}) => {
    if (e.shiftKey && anchorId) {
      const ids = shown.map((v) => v.id);
      const a = ids.indexOf(anchorId), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) setSelectedIds(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id) && next.size > 1) next.delete(id); else next.add(id);
        return next;
      });
      setAnchorId(id);
    } else {
      setSelectedIds(new Set([id]));
      setAnchorId(id);
    }
    setPrimaryId(id);
  };
  const selectedList = () => shown.filter((v) => selectedIds.has(v.id)).map((v) => v.id);

  const chooseGrouping = (id) => {
    setGrouping(id);
    setGroupQ('');
    if (id === 'playlist') { setGroupKey(playlists[0]?.id || null); return; }
    const g = buildGroups(videos, id);
    setGroupKey(g.length ? g[0].name : null);
  };
  const go = (gid, key) => { setPage('library'); setGrouping(gid); setGroupKey(key); setGroupQ(''); };

  const setSettings = (patch) => window.vs.updateSettings(patch).then((settings) => setLib((l) => ({ ...l, settings })));

  // ---------------------------------------------------------- 재생
  const startPlay = (id, queue, label) => {
    const qIds = queue && queue.length ? queue : shown.map((v) => v.id);
    setPlaying({ id, queue: qIds.includes(id) ? qIds : [id, ...qIds], label: label || (activePlaylist ? activePlaylist.name : '목록'), nonce: Date.now() });
    setPrimaryId(id); setSelectedIds(new Set([id])); setAnchorId(id);
    setPage('library');
  };
  const stepTo = (dir) => {
    if (!playing) return;
    const { queue, id } = playing;
    let i = queue.indexOf(id);
    if (shuffle && queue.length > 1) {
      let r = i;
      while (r === i) r = Math.floor(Math.random() * queue.length);
      i = r;
    } else {
      i += dir;
      if (i >= queue.length) { if (repeat === 'all') i = 0; else return false; }
      if (i < 0) { if (repeat === 'all') i = queue.length - 1; else return false; }
    }
    const nid = queue[i];
    setPlaying({ ...playing, id: nid, nonce: Date.now() });
    setPrimaryId(nid); setSelectedIds(new Set([nid])); setAnchorId(nid);
    return true;
  };
  const onEnded = () => {
    if (repeat === 'one') { setPlaying({ ...playing, nonce: Date.now() }); return; }
    if (!stepTo(1)) setPlaying(null);
  };
  const playingVideo = playing ? byId.get(playing.id) : null;
  const qIndex = playing ? playing.queue.indexOf(playing.id) : -1;

  // 숫자 키패드 3 = 다음 영상, 1 = 이전 영상 (재생 중일 때 어디서든)
  const stepRef = useRef(stepTo);
  stepRef.current = playing ? stepTo : null;
  useEffect(() => {
    const onKey = (e) => {
      if (!stepRef.current || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.code === 'Numpad3') { e.preventDefault(); stepRef.current(1); }
      else if (e.code === 'Numpad1') { e.preventDefault(); stepRef.current(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------- 재생목록
  const savePlaylists = (pls) => window.vs.savePlaylists(pls).then((saved) => setLib((l) => ({ ...l, playlists: saved })));
  const addToPlaylist = (plId, ids) => {
    const pl = playlists.find((p) => p.id === plId);
    if (!pl) return;
    const before = pl.items.length;
    const items = Array.from(new Set([...pl.items, ...ids]));
    savePlaylists(playlists.map((p) => (p.id === plId ? { ...p, items } : p)));
    flash(`"${pl.name}"에 ${items.length - before}개 추가했어요`);
  };
  const createPlaylist = (name, ids = []) => {
    const pl = { id: newId(), name, items: ids, createdAt: Date.now() };
    savePlaylists([...playlists, pl]);
    return pl.id;
  };
  const removeFromPlaylist = (plId, ids) =>
    savePlaylists(playlists.map((p) => (p.id === plId ? { ...p, items: p.items.filter((x) => !ids.includes(x)) } : p)));
  const reorder = (from, to) => {
    if (!activePlaylist) return;
    const items = shown.map((v) => v.id); // 검색 중이 아닐 때만 순서 변경 가능
    const [m] = items.splice(from, 1);
    items.splice(to, 0, m);
    savePlaylists(playlists.map((p) => (p.id === activePlaylist.id ? { ...p, items } : p)));
  };

  // ---------------------------------------------------------- 삭제
  const confirmDelete = (opts) => {
    const ids = delIds;
    window.vs.deleteVideos(ids, opts).then((r) => {
      setLib(r.library);
      setDelIds(null);
      if (playing && ids.includes(playing.id)) setPlaying(null);
      setSelectedIds(new Set());
      if (r.errors.length) flash(`${r.deleted}개 삭제, ${r.errors.length}개 실패: ${r.errors[0]}`);
      else flash(opts.permanent ? `${r.deleted}개를 완전히 삭제했어요` : `${r.deleted}개를 휴지통으로 보냈어요`);
    });
  };

  // ---------------------------------------------------------- 끌어다 놓기로 추가
  const addDropped = (paths) => {
    if (!paths.length) { flash('추가할 수 있는 파일이 아니에요'); return; }
    window.vs.addPaths(paths).then((r) => {
      setLib(r.library);
      if (!r.added) { flash(r.skipped ? '영상 파일이 아니거나 이미 있는 영상이에요' : '이미 목록에 있는 영상이에요'); return; }
      flash(`영상 ${r.added}개를 추가했어요${r.skipped ? ` (영상이 아닌 파일 ${r.skipped}개는 건너뜀)` : ''}`);
      setPage('library');
      setGrouping('new'); setGroupKey(null); setQ('');
      // 새로 들어온 영상은 바로 정보·표지 받기 시작
      if (!progressRef.current.running) {
        setProgress({ ...EMPTY_PROGRESS, running: true, current: '준비 중' });
        setOrganizeOpen(true);
        window.vs.organize({ ids: r.ids, mode: 'new' });
      }
    });
  };
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const dropRef = useRef(addDropped);
  dropRef.current = addDropped;
  useEffect(() => {
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    const over = (e) => { e.preventDefault(); if (hasFiles(e)) setDropActive(true); }; // 막지 않으면 창이 파일로 넘어가 버림
    const leave = (e) => { if (!e.relatedTarget || e.clientX <= 0 || e.clientY <= 0) setDropActive(false); };
    const drop = (e) => {
      e.preventDefault();
      setDropActive(false);
      if (!hasFiles(e)) return;
      const paths = Array.from(e.dataTransfer.files).map((f) => window.vs.pathForFile(f)).filter(Boolean);
      dropRef.current(paths);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);

  // ---------------------------------------------------------- 정리하기
  const startOrganize = (mode) => {
    setProgress({ ...EMPTY_PROGRESS, running: true, current: '준비 중' });
    window.vs.organize({ mode });
  };
  // 고른 영상들만 정보 받기 (정보 받기 전·못 찾음 묶음, 여러 개 선택)
  const organizeIds = (ids) => {
    if (!ids.length || progress.running) return;
    setProgress({ ...EMPTY_PROGRESS, running: true, current: '준비 중' });
    setOrganizeOpen(true);
    window.vs.organize({ ids, mode: 'retry' });
  };
  const refetch = (id) => {
    setProgress({ ...EMPTY_PROGRESS, running: true });
    setOrganizeOpen(true);
    window.vs.refetch(id);
  };

  if (!lib) return <div className="empty">불러오는 중…</div>;

  const groupDef = GROUPINGS.find((g) => g.id === grouping);
  const wideNow = wide && !!playingVideo; // 넓게 보기는 재생 중에만
  const groupColWanted = !wideNow && (!!groupDef?.keys || grouping === 'playlist');
  const hasGroupCol = groupColWanted && !groupHidden;
  const groupRail = groupColWanted && groupHidden; // 숨겼을 때 남는 얇은 띠 (눌러서 다시 펼치기)
  const gridCols = wideNow ? 'minmax(0, 1fr)'
    : `${hasGroupCol ? `${groupW}px 6px ` : groupRail ? '30px ' : ''}minmax(0, 1fr) 6px ${listW}px`;
  const hideBtn = (
    <button className="btn sm ghost icon-only" title="왼쪽 칸 숨기기" onClick={toggleGroup}><Icon name="panelL" size={16} /></button>
  );
  const multi = selectedIds.size > 1;
  // 재생 중이면 그 영상, 아니면 지금 목록에 있는 선택 영상만 보여준다
  const viewerVideo = playingVideo || (shown.some((v) => v.id === primaryId) ? byId.get(primaryId) : null) || null;

  const primaryVideo = shown.some((v) => v.id === primaryId) ? byId.get(primaryId) : null;
  const selIds = () => (multi ? selectedList() : primaryId ? [primaryId] : []);
  // 목록 맨 위 작업 줄: 하나만 골라도 재생목록 추가·정보 받기·삭제를 바로 할 수 있게
  const selectionActions = (
    <>
      <button className="btn sm" onClick={() => setPickIds(selIds())}><Icon name="listPlus" size={13} />재생목록에 추가</button>
      <button className="btn sm" onClick={() => organizeIds(selIds())} disabled={progress.running}><Icon name="refresh" size={13} />정보 받기</button>
      <button className="btn sm danger" onClick={() => setDelIds(selIds())}><Icon name="trash" size={13} />삭제</button>
    </>
  );
  const playExternal = (ids, name) => window.vs.playExternal(ids, name).then((r) => flash(r.ok ? `기본 앱에서 ${r.count}개를 재생목록으로 열었어요` : r.message));
  const bulkBar = (multi || activePlaylist || primaryVideo) && (
    <div className="bulk">
      {multi ? (<>
        <b>{selectedIds.size}개 선택</b>
        <button className="btn sm" onClick={() => { const ids = selectedList(); startPlay(ids[0], ids, `선택 ${ids.length}개`); }}><Icon name="play" size={13} fill />재생</button>
        <button className="btn sm" onClick={() => playExternal(selectedList(), `선택 ${selectedIds.size}개`)} title="곰플레이어·팟플레이어 등 기본 앱에서 재생목록으로 열기"><Icon name="external" size={13} />기본 앱으로</button>
        {selectionActions}
        {activePlaylist && <button className="btn sm" onClick={() => removeFromPlaylist(activePlaylist.id, selectedList())}>재생목록에서 빼기</button>}
        <button className="btn sm ghost" onClick={() => setSelectedIds(new Set([primaryId]))}>선택 해제</button>
      </>) : activePlaylist ? (<>
        <b>{activePlaylist.name}</b>
        <button className="btn sm primary" disabled={!shown.length} onClick={() => { setShuffle(false); startPlay(shown[0].id, shown.map((v) => v.id), activePlaylist.name); }}><Icon name="play" size={13} fill />전체 재생</button>
        <button className="btn sm" disabled={!shown.length} onClick={() => { setShuffle(true); const ids = shown.map((v) => v.id); startPlay(ids[Math.floor(Math.random() * ids.length)], ids, activePlaylist.name); }}><Icon name="shuffle" size={13} />셔플 재생</button>
        <button className="btn sm" disabled={!shown.length} onClick={() => playExternal(shown.map((v) => v.id), activePlaylist.name)} title="곰플레이어·팟플레이어 등 기본 앱에서 이 재생목록 그대로 열기"><Icon name="external" size={13} />기본 앱으로</button>
        {primaryVideo && shown.some((v) => v.id === primaryId) && (
          <button className="btn sm" onClick={() => removeFromPlaylist(activePlaylist.id, [primaryId])}>선택한 영상 빼기</button>
        )}
        <button className="btn sm ghost" onClick={() => setPrompt({ title: '재생목록 이름 바꾸기', initial: activePlaylist.name, onOk: (name) => { savePlaylists(playlists.map((p) => (p.id === activePlaylist.id ? { ...p, name } : p))); setPrompt(null); } })}>이름 바꾸기</button>
        <button className="btn sm ghost danger" onClick={() => {
          if (window.confirm(`"${activePlaylist.name}" 재생목록을 지울까요? (영상 파일은 그대로예요)`)) {
            savePlaylists(playlists.filter((p) => p.id !== activePlaylist.id)); setGroupKey(null);
          }
        }}>재생목록 지우기</button>
      </>) : (<>
        <b className="sel-code" title={primaryVideo.fileName}>{primaryVideo.code || primaryVideo.fileName}</b>
        {selectionActions}
      </>)}
    </div>
  );

  return (
    <div className="app">
      <header className="header">
        <div className="logo" title={`버전 ${lib.version}`}>VID<span>SHELF</span></div>
        <nav className="nav">
          <button className={page === 'library' ? 'on' : ''} onClick={() => setPage('library')}><Icon name="grid" />라이브러리</button>
          <button className={page === 'actors' ? 'on' : ''} onClick={() => setPage('actors')}><Icon name="user" />배우</button>
          <button className={page === 'settings' ? 'on' : ''} onClick={() => setPage('settings')}><Icon name="gear" />설정</button>
        </nav>
        <div className="spacer" />
        <button className="btn" onClick={() => window.vs.addFolder().then(setLib)}><Icon name="plus" size={15} />폴더 추가</button>
        <button className="btn primary" onClick={() => { if (!progress.running) setProgress(EMPTY_PROGRESS); setOrganizeOpen(true); }}>
          <Icon name="wand" size={15} />{progress.running ? `정리 중 ${progress.done}/${progress.total}` : '정리하기'}
        </button>
      </header>

      {page === 'library' && (videos.length === 0 ? (
        <div className="empty">
          <h2>영상 폴더를 추가하세요</h2>
          <div>폴더를 추가하거나, 영상 파일·폴더를 이 창에 끌어다 놓으세요. 파일은 옮기지 않아요.</div>
          <button className="btn primary" onClick={() => window.vs.addFolder().then(setLib)}><Icon name="plus" size={15} />폴더 추가</button>
        </div>
      ) : (<>
        <div className="toolbar">
          <div className="chips">
            {GROUPINGS.map((g) => (
              <button key={g.id} className={`chip ${grouping === g.id ? 'on' : ''}`} onClick={() => chooseGrouping(g.id)}>
                {g.label}{g.id === 'new' && recentCount > 0 && <span className="n">{recentCount}</span>}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <div className="search"><Icon name="search" size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품번, 배우, 제작사, 제목 검색" />
            {q && <button className="heart" onClick={() => setQ('')}><Icon name="x" size={14} /></button>}
          </div>
          {grouping !== 'playlist' && grouping !== 'new' && (<>
            <select className="sel" value={sort} onChange={(e) => setSettings({ sort: e.target.value })}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button className="btn ghost" title="정렬 방향" onClick={() => setSettings({ sortDir: sortDir === 'desc' ? 'asc' : 'desc' })}>
              <Icon name="sort" size={15} />{sortDir === 'desc' ? '내림차순' : '오름차순'}
            </button>
          </>)}
        </div>

        <div className={`lib ${wideNow ? 'wide' : ''}`} style={{ gridTemplateColumns: gridCols }}>
          {groupRail && (
            <div className="group-rail" onClick={toggleGroup} title={`${grouping === 'playlist' ? '재생목록' : groupDef.label} 칸 펼치기`}>
              <Icon name="panelR" size={16} />
              <span>{grouping === 'playlist' ? (activePlaylist?.name || '재생목록') : (groupKey || groupDef.label)}</span>
            </div>
          )}
          {hasGroupCol && grouping === 'playlist' && (
            <div className="col groups">
              <div className="group-top">
              <button className="btn sm" style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setPrompt({ title: '새 재생목록', okLabel: '만들기', onOk: (name) => { setGroupKey(createPlaylist(name)); setPrompt(null); } })}>
                <Icon name="plus" size={14} />새 재생목록
              </button>
              {hideBtn}
              </div>
              {playlists.length === 0 && <div className="hint">재생목록을 만들고, 영상에서 "재생목록에 추가"를 눌러 넣으세요.</div>}
              {playlists.map((p) => (
                <div key={p.id} className={`gitem ${groupKey === p.id ? 'on' : ''}`} onClick={() => setGroupKey(p.id)}>
                  <span className="avatar"><Icon name="list" size={13} /></span>
                  <span className="name" title={p.name}>{p.name}</span>
                  <span className="cnt">{p.items.length}</span>
                </div>
              ))}
            </div>
          )}
          {hasGroupCol && grouping === 'playlist' && <div className={`splitter ${dragging === 'group' ? 'drag' : ''}`} onMouseDown={startDrag('group')} title="끌어서 너비 조절" />}
          {hasGroupCol && grouping !== 'playlist' && (
            <div className="col groups">
              {(groupKey === UNKNOWN.pending || groupKey === UNKNOWN.failed) && shown.length > 0 && (
                <button className="btn sm primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
                  disabled={progress.running} onClick={() => organizeIds(shown.map((v) => v.id))}>
                  <Icon name="wand" size={14} />이 {shown.length}개 정보 받기
                </button>
              )}
              <div className="group-top">
                <div className="search gsearch"><Icon name="search" size={13} /><input value={groupQ} onChange={(e) => setGroupQ(e.target.value)} placeholder={`${groupDef.label.replace('별', '')} 찾기`} /></div>
                {hideBtn}
              </div>
              {visibleGroups.map((g) => (
                <div key={g.name} className={`gitem ${groupKey === g.name ? 'on' : ''} ${g.special ? 'special' : ''}`} onClick={() => setGroupKey(g.name)}>
                  {grouping === 'actor' && (lib.actors[g.name]?.photo
                    ? <img className="avatar" src={imgUrl(lib.actors[g.name].photo)} alt="" />
                    : <span className="avatar">{g.special ? '?' : g.name.slice(0, 1)}</span>)}
                  <span className="name" title={g.name}>{g.name}</span>
                  <span className="cnt">{g.count}</span>
                  {grouping === 'actor' && !g.special && (
                    <button className="rm" title="배우 이름 지우기" onClick={(e) => { e.stopPropagation(); setRmActor({ name: g.name, count: g.count }); }}>
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {hasGroupCol && grouping !== 'playlist' && <div className={`splitter ${dragging === 'group' ? 'drag' : ''}`} onMouseDown={startDrag('group')} title="끌어서 너비 조절" />}
          <div className="col">
            <Viewer video={viewerVideo} emptyText={shown.length ? null : (q ? '검색 결과가 없어요' : '이 분류에는 아직 영상이 없어요')} onUpdate={updateVideo} onGo={go} onEdit={setEdit} onRefetch={refetch} busy={progress.running}
              onPlay={(id) => startPlay(id)} onAddToPlaylist={setPickIds} onDelete={setDelIds}
              player={playingVideo ? {
                playKey: `${playing.id}-${playing.nonce}`,
                hasPrev: shuffle || repeat === 'all' ? playing.queue.length > 1 : qIndex > 0,
                hasNext: shuffle || repeat === 'all' ? playing.queue.length > 1 : qIndex < playing.queue.length - 1,
                onPrev: () => stepTo(-1), onNext: () => stepTo(1), onEnded, onClose: () => setPlaying(null),
                queueLabel: `${playing.label} ${qIndex + 1}/${playing.queue.length}`,
                shuffle, repeat, onShuffle: () => setShuffle((x) => !x),
                onRepeat: () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')),
                wide, onWide: () => setWide((w) => { savePref('vs.wide', !w); return !w; }),
              } : null} />
          </div>
          {!wideNow && <div className={`splitter ${dragging === 'list' ? 'drag' : ''}`} onMouseDown={startDrag('list')} title="끌어서 너비 조절 (재생 화면 크기)" />}
          {!wideNow && <FileList videos={shown} selectedIds={selectedIds} primaryId={primaryId} playingId={playing?.id}
            onSelect={onSelect} onSelectAll={() => setSelectedIds(new Set(shown.map((v) => v.id)))}
            onPlay={(id) => startPlay(id)} onDelete={() => setDelIds(selectedList())}
            reorderable={!!activePlaylist && !q} onReorder={reorder} bulkBar={bulkBar} />}
        </div>
      </>))}

      {page === 'actors' && (
        <ActorsPage videos={videos} actors={lib.actors} onOpen={(name) => go('actor', name)}
          onRemove={(name, count) => setRmActor({ name, count })}
          photoProgress={photoProgress}
          onFetchPhotos={() => {
            setPhotoProgress({ running: true, done: 0, total: 0 });
            window.vs.fetchActorPhotos().then((r) => { if (!r.ok) { setPhotoProgress(null); flash(r.message); } });
          }}
          onActorChange={(a) => setLib((l) => ({ ...l, actors: { ...l.actors, [a.name]: a } }))} />
      )}
      {page === 'settings' && (
        <SettingsPage lib={lib} onLib={setLib} onSettings={setSettings}
          onRetranslate={() => {
            if (progress.running) return;
            setProgress({ ...EMPTY_PROGRESS, running: true, current: '제목 번역 준비 중' });
            setOrganizeOpen(true);
            window.vs.retranslateTitles().then((r) => { if (!r.ok) flash(r.message); });
          }}
          onRelocate={() => window.vs.relocateCovers().then((r) => {
            setLib(r.library);
            flash(`표지 ${r.moved}개를 옮겼어요${r.skipped ? ` · 직접 넣은 이미지 ${r.skipped}개는 그대로 둠` : ''}${r.failed ? ` · ${r.failed}개 실패` : ''}`);
          })} />
      )}

      {organizeOpen && (
        <OrganizeModal videos={videos} settings={lib.settings} progress={progress} onStart={startOrganize} dataDir={lib.dataDir}
          onCancel={() => window.vs.cancelOrganize()} onClose={() => { setOrganizeOpen(false); if (!progress.running) setProgress(EMPTY_PROGRESS); }} />
      )}
      {edit && (
        <EditModal video={edit} onClose={() => setEdit(null)}
          onSave={(patch) => window.vs.updateVideo(edit.id, patch).then((v) => { updateVideo(v); setEdit(null); flash('저장했어요'); window.vs.getLibrary().then(setLib); })} />
      )}
      {delIds && delIds.length > 0 && (
        <DeleteModal videos={delIds.map((id) => byId.get(id)).filter(Boolean)} onConfirm={confirmDelete} onClose={() => setDelIds(null)} />
      )}
      {pickIds && (
        <PlaylistPickerModal count={pickIds.length} playlists={playlists} onClose={() => setPickIds(null)}
          onPick={(plId) => { addToPlaylist(plId, pickIds); setPickIds(null); }}
          onCreate={(name) => { createPlaylist(name, pickIds); flash(`"${name}" 재생목록을 만들고 ${pickIds.length}개 넣었어요`); setPickIds(null); }} />
      )}
      {prompt && <PromptModal {...prompt} onClose={() => setPrompt(null)} />}
      {rmActor && (
        <RemoveActorModal name={rmActor.name} count={rmActor.count} onClose={() => setRmActor(null)}
          onConfirm={(opts) => window.vs.removeActor(rmActor.name, opts).then((r) => {
            setLib(r.library);
            if (grouping === 'actor' && groupKey === rmActor.name) setGroupKey(null);
            flash(`"${rmActor.name}"을(를) 영상 ${r.count}개에서 지웠어요`);
            setRmActor(null);
          })} />
      )}
      {toast && <div className="toast">{toast}</div>}
      {dropActive && (
        <div className="drop-overlay">
          <div className="drop-box">
            <Icon name="plus" size={36} />
            <div className="t">여기에 놓으면 추가돼요</div>
            <div className="d">영상 파일 또는 폴더 · 파일은 옮기지 않고 목록에만 추가해요</div>
          </div>
        </div>
      )}
    </div>
  );
}
