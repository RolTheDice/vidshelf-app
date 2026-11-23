import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { imgUrl } from '../lib.js';

export function ActorsPage({ videos, actors, onOpen, onActorChange, onRemove, onRename, photoProgress, onFetchPhotos }) {
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(null); // 오른쪽 클릭 메뉴 {x, y, a}
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', close); };
  }, [menu]);
  const [sort, setSort] = useState('count');
  const list = useMemo(() => {
    const counts = {};
    videos.forEach((v) => (v.actors || []).forEach((a) => { counts[a] = (counts[a] || 0) + 1; }));
    let out = Object.keys(counts).map((name) => ({ ...(actors[name] || { name }), count: counts[name] }));
    const s = q.trim().toLowerCase();
    if (s) out = out.filter((a) => [a.name, ...(a.aliases || [])].some((n) => n.toLowerCase().includes(s)));
    out.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ko') : (a, b) => (b.favorite - a.favorite) || b.count - a.count);
    return out;
  }, [videos, actors, q, sort]);

  return (
    <div className="page">
      <div className="inline">
        <div className="search"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="배우 이름 (한·일·영 모두)" /></div>
        <select className="sel" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="count">작품 많은 순</option>
          <option value="name">이름순</option>
        </select>
        <span style={{ color: 'var(--muted)' }}>{list.length}명</span>
        <div className="spacer" />
        {!photoProgress?.running && (
          <button className="btn sm" onClick={onFetchPhotos} disabled={!list.some((a) => !a.photo)}>
            <Icon name="image" size={14} />사진 없는 배우 {list.filter((a) => !a.photo).length}명 사진 받기
          </button>
        )}
      </div>
      {photoProgress && (photoProgress.running || photoProgress.finished) && (
        <div className="photo-progress">
          {photoProgress.running ? (<>
            <span>배우 사진 받는 중 {photoProgress.done}/{photoProgress.total}{photoProgress.current ? ` · ${photoProgress.current}` : ''}</span>
            <div className="progress" style={{ flex: 1, margin: 0 }}><div style={{ width: `${photoProgress.total ? (photoProgress.done / photoProgress.total) * 100 : 0}%` }} /></div>
            <button className="btn sm danger" onClick={() => window.vs.cancelOrganize()}>중지</button>
          </>) : (
            <span>
              사진 {photoProgress.got}명 받음{photoProgress.failed ? ` · ${photoProgress.failed}명은 사이트에 사진이 없거나 찾지 못했어요 (카드의 사진 버튼으로 직접 넣을 수 있어요)` : ''}
              {photoProgress.cancelled ? ' · 중지했어요' : ''}
            </span>
          )}
        </div>
      )}
      {menu && (
        <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 190) }}
          onMouseDown={(e) => e.stopPropagation()}>
          <div className="ctx-title">{menu.a.name}</div>
          <button onClick={() => { setMenu(null); onRename(menu.a.name); }}><Icon name="edit" size={14} />이름 바꾸기 / 합치기</button>
          <button onClick={() => { setMenu(null); onOpen(menu.a.name); }}><Icon name="grid" size={14} />작품 보기 ({menu.a.count}편)</button>
          <button onClick={() => { setMenu(null); window.vs.updateActor(menu.a.name, { favorite: !menu.a.favorite }).then(onActorChange); }}>
            <Icon name="heart" size={14} fill={menu.a.favorite} />{menu.a.favorite ? '즐겨찾기 빼기' : '즐겨찾기'}</button>
          <button onClick={() => { setMenu(null); window.vs.chooseActorPhoto(menu.a.name).then(onActorChange); }}><Icon name="image" size={14} />사진 바꾸기</button>
          <button className="danger" onClick={() => { setMenu(null); onRemove(menu.a.name, menu.a.count); }}><Icon name="x" size={14} />배우 이름 지우기</button>
        </div>
      )}
      {list.length === 0 && <div className="empty" style={{ height: 300 }}>아직 배우 정보가 없어요. "정리하기"로 정보를 가져와 보세요.</div>}
      <div className="actor-grid">
        {list.map((a) => (
          <div key={a.name} className="acard" onClick={() => onOpen(a.name)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, a }); }}>
            <div className="ph">
              {a.photo ? <img src={imgUrl(a.photo)} alt={a.name} /> : <Icon name="user" size={40} />}
            </div>
            <div className="meta">
              <div className="nm" title={[a.name, ...(a.aliases || [])].join(' / ')}>{a.name}</div>
              <div className="meta-row">
              <span className="cnt">{a.count}편</span>
              <span className="spacer" />
              <button className={`heart ${a.favorite ? 'on' : ''}`} title="즐겨찾는 배우"
                onClick={(e) => { e.stopPropagation(); window.vs.updateActor(a.name, { favorite: !a.favorite }).then(onActorChange); }}>
                <Icon name="heart" size={15} fill={a.favorite} />
              </button>
              <button className="heart" title="사진 바꾸기"
                onClick={(e) => { e.stopPropagation(); window.vs.chooseActorPhoto(a.name).then(onActorChange); }}>
                <Icon name="image" size={15} />
              </button>
              <button className="heart" title="배우 이름 지우기"
                onClick={(e) => { e.stopPropagation(); onRemove(a.name, a.count); }}>
                <Icon name="x" size={15} />
              </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const COVER_MODES = [
  { id: 'appdata', t: '프로그램 폴더에 따로 저장 (기본)', d: <>영상 폴더에는 아무것도 만들지 않아요. 표지는 <code>%APPDATA%\VidShelf\covers</code>에 모아서 관리해요.</> },
  { id: 'beside', t: '영상 옆에 저장', d: <>영상과 같은 폴더에 <code>ABC-123.jpg</code>로 저장해요. 탐색기에서도 표지를 볼 수 있어요.</> },
  { id: 'subfolder', t: 'covers 폴더에 저장', d: <>영상 폴더 안의 <code>covers\ABC-123.jpg</code>로 저장해요. 영상 옆이 깔끔해요.</> },
];

export function SettingsPage({ lib, onLib, onSettings, onRelocate, onRetranslate }) {
  const s = lib.settings;
  const [ext, setExt] = useState(s.extensions.join(', '));
  const [moving, setMoving] = useState(false);
  const [ruleCode, setRuleCode] = useState('');
  const [ruleUrl, setRuleUrl] = useState('');
  const [ruleMsg, setRuleMsg] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [deeplKey, setDeeplKey] = useState(s.deeplKey || '');
  const [deeplMsg, setDeeplMsg] = useState('');
  const googleTitles = lib.videos.filter((v) => (v.titleJa || v.titleEn) && v.titleBy === 'google' && !v.locked).length;
  const saveDeepl = async () => {
    const key = deeplKey.trim();
    if (!key) { onSettings({ deeplKey: '' }); setDeeplMsg('키를 지웠어요. 구글 번역을 써요.'); return; }
    setDeeplMsg('확인 중…');
    const r = await window.vs.testDeepl(key);
    if (r.ok) {
      onSettings({ deeplKey: key });
      setDeeplMsg(`✓ 연결됨 · 이번 달 ${r.used.toLocaleString()} / ${r.limit.toLocaleString()}자 사용`);
    } else setDeeplMsg(`✗ ${r.message || '연결 안 됨'}`);
  };
  const rules = lib.coverRules || [];
  const addRule = () => window.vs.addCoverRule(ruleCode, ruleUrl).then((r) => {
    if (!r.ok) { setRuleMsg(r.message); return; }
    onLib({ ...lib, coverRules: r.rules }); setRuleCode(''); setRuleUrl(''); setRuleMsg('규칙을 넣었어요. 이 품번 앞부분은 이제 이 형태부터 찾아요.');
  });
  const covers = lib.videos.filter((v) => v.cover).length;
  return (
    <div className="page"><div className="settings">
      <div className="sec">
        <h4>표지 저장 위치</h4>
        <div className="desc">새로 받는 표지는 여기서 고른 곳에 저장돼요. 이미 받은 표지도 아래 버튼으로 한 번에 옮길 수 있어요.</div>
        {COVER_MODES.map((m) => (
          <div key={m.id} className={`radio ${s.coverMode === m.id ? 'on' : ''}`} onClick={() => onSettings({ coverMode: m.id })}>
            <input type="radio" readOnly checked={s.coverMode === m.id} />
            <div><div className="t">{m.t}</div><div className="d">{m.d}</div></div>
          </div>
        ))}
        <div className="inline" style={{ marginTop: 10 }}>
          <button className="btn sm" disabled={moving || !covers} onClick={() => { setMoving(true); Promise.resolve(onRelocate()).finally(() => setMoving(false)); }}>
            <Icon name="folder" size={14} />{moving ? '옮기는 중…' : `이미 받은 표지를 이 위치로 옮기기 (${covers}개)`}
          </button>
          <button className="btn sm" onClick={() => window.vs.openCoversDir()}
            title={s.coverMode === 'appdata' ? '%APPDATA%\\VidShelf\\covers 폴더를 열어요' : '가장 최근에 받은 표지가 있는 폴더를 열어요'}>
            <Icon name="external" size={14} />표지 폴더 열기
          </button>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>이 프로그램이 받은 <code>품번.jpg</code>만 옮겨요. 직접 넣어 둔 다른 이름의 이미지는 그대로 둬요.</span>
        </div>
      </div>

      <div className="sec">
        <h4>표지 찾기 규칙</h4>
        <div className="desc">
          표지를 찾으면 그 주소 형태를 품번 앞부분별로 기억해서, 같은 레이블의 다음 작품은 바로 찾아요.
          지금까지 받은 표지로 미리 배운 규칙 {rules.length}개가 있어요.
          계속 못 찾는 레이블은 그 레이블 작품 하나의 실제 표지 주소를 아래에 넣어 주세요.
        </div>
        <div className="inline" style={{ marginBottom: 8 }}>
          <input type="text" placeholder="품번 (예: ABC-123)" value={ruleCode} onChange={(e) => { setRuleCode(e.target.value); setRuleMsg(''); }} style={{ width: 150 }} />
          <input type="text" placeholder="표지 주소 (https://pics.dmm.co.jp/…pl.jpg)" value={ruleUrl} onChange={(e) => { setRuleUrl(e.target.value); setRuleMsg(''); }} style={{ flex: 1, minWidth: 260 }} />
          <button className="btn sm" onClick={addRule} disabled={!ruleCode.trim() || !ruleUrl.trim()}><Icon name="plus" size={14} />규칙 넣기</button>
        </div>
        {ruleMsg && <div className="desc" style={{ marginBottom: 8 }}>{ruleMsg}</div>}
        {rules.length > 0 && <span className="link" onClick={() => setShowRules((x) => !x)}>{showRules ? '규칙 목록 접기' : `규칙 ${rules.length}개 보기`}</span>}
        {showRules && (
          <div className="rule-list">
            {rules.map((r) => (
              <div key={`${r.label}-${r.index}`} className="rule-row">
                <b>{r.label.toUpperCase()}</b>
                <span className="mono">{r.example}</span>
                <span style={{ color: 'var(--faint)' }}>{r.manual ? '직접 넣음' : `${r.hits}번 맞음`}</span>
                <button className="heart" title="이 규칙 지우기" onClick={() => window.vs.removeCoverRule(r.label, r.index).then((list) => onLib({ ...lib, coverRules: list }))}><Icon name="x" size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sec">
        <h4>최근 추가</h4>
        <div className="desc">이 기간 안에 들어온 영상 중 아직 안 본 것을 "최근 추가"에 보여줘요. 한 번 보면(재생 횟수 1회) 빠져요.</div>
        <div className="inline">
          <select className="sel" value={s.recentDays ?? 30} onChange={(e) => onSettings({ recentDays: Number(e.target.value) })}>
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>최근 {d}일</option>)}
            <option value={0}>기간 상관없이 (안 본 영상 전부)</option>
          </select>
        </div>
      </div>

      <div className="sec">
        <h4>정보 가져올 곳</h4>
        <div className="desc">정리할 때 품번으로 작품 정보를 가져와요. 로그인이나 키는 필요 없어요.</div>
        <div className="inline" style={{ marginBottom: 6 }}>
          <label><input type="checkbox" checked={s.useR18 !== false} onChange={(e) => onSettings({ useR18: e.target.checked })} /> r18.dev — 주 정보원</label>
        </div>
        <div className="desc" style={{ marginTop: 0 }}>배우·레이블·제작사·시리즈·감독·장르·발매일·재생시간·제목과 정확한 표지 주소를 받아요. 장르는 한국어로 바꿔요. 배우 이름은 일본어 읽는 법을 한글로 바꿔요(예: やまぎしあいか → 야마기시 아이카).</div>
        <div className="inline" style={{ marginBottom: 6 }}>
          <label><input type="checkbox" checked={!!s.usePoomki} onChange={(e) => onSettings({ usePoomki: e.target.checked })} /> 품번기 (poomki.net) — 보조</label>
        </div>
        <div className="desc" style={{ marginTop: 0 }}>처음 보는 배우가 있을 때만 품번기의 한국어 이름과 맞춰 봐요. 한 번 정한 이름은 기억해서 다음부터는 묻지 않아요. r18.dev에 없는 작품도 품번기에서 찾아요.</div>
        <div className="desc" style={{ marginTop: 0 }}>제작사·레이블은 같은 품번 앞글자(예: SONE)로 이미 정리한 작품이 있으면 그 한국어 이름을 그대로 써요.</div>
        <div className="inline" style={{ marginBottom: 6 }}>
          <label><input type="checkbox" checked={s.translateTitles !== false} onChange={(e) => onSettings({ translateTitles: e.target.checked })} /> 제목을 한국어로 번역</label>
        </div>
        <div className="desc" style={{ marginTop: 0 }}>일본어 원제를 번역해서 제목으로 저장하고, 원제는 아래에 작게 남겨요. 시리즈 이름도 번역해요. 기계 번역이라 어색할 수 있고, 이미 한국어로 된 제목은 그대로 둬요. 번역이 안 되면 영어 제목으로 두고 다음 정리 때 다시 시도해요.</div>
        <div className="desc" style={{ marginTop: 0 }}>DeepL API 키를 넣으면 DeepL로 번역해요 (무료 키는 한 달 50만 자). 키가 없거나 DeepL이 안 되면 구글 번역을 써요. 키는 이 PC의 프로그램 폴더에만 저장돼요.</div>
        <div className="inline" style={{ marginBottom: 6 }}>
          <input type="password" placeholder="DeepL API 키 (예: xxxxxxxx-xxxx-…:fx)" value={deeplKey} style={{ flex: 1, minWidth: 260 }}
            onChange={(e) => setDeeplKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveDeepl(); }} />
          <button className="btn sm" onClick={saveDeepl}>저장하고 확인</button>
          {s.deeplKey && <button className="btn sm ghost" onClick={() => { setDeeplKey(''); onSettings({ deeplKey: '' }); setDeeplMsg('키를 지웠어요. 구글 번역을 써요.'); }}>지우기</button>}
        </div>
        {deeplMsg && <div className="desc" style={{ marginTop: 0 }}>{deeplMsg}</div>}
        {s.deeplKey && googleTitles > 0 && (
          <div className="inline" style={{ marginBottom: 6 }}>
            <button className="btn sm" onClick={onRetranslate}>구글로 번역한 제목 {googleTitles}개를 DeepL로 다시 번역</button>
          </div>
        )}
        <div className="inline">
          <span style={{ color: 'var(--muted)' }}>요청 간격</span>
          <input type="number" min="500" step="250" value={s.requestDelayMs} style={{ width: 90 }}
            onChange={(e) => onSettings({ requestDelayMs: Math.max(500, Number(e.target.value) || 1500) })} />
          <span style={{ color: 'var(--muted)' }}>ms — 품번기에 물을 때 쉬는 간격 (최소 1.5초). r18.dev·번역은 따로 짧게 쉬어요</span>
        </div>
      </div>

      <div className="sec">
        <h4>영상 폴더</h4>
        <div className="desc">폴더를 빼도 목록에서만 사라지고 실제 파일은 그대로예요. 영상 파일이나 폴더를 창에 끌어다 놓아도 추가돼요.</div>
        {lib.folders.map((f) => (
          <div key={f.id} className="folder-row">
            <Icon name="folder" />
            <span className="p" title={f.path}>{f.path}</span>
            <span style={{ color: 'var(--faint)' }}>{f.only ? `끌어다 놓은 파일 ${f.only.length}개` : `${lib.videos.filter((v) => v.folderId === f.id).length}개`}</span>
            <button className="btn sm ghost" onClick={() => window.vs.removeFolder(f.id).then(onLib)}>빼기</button>
          </div>
        ))}
        <div className="inline" style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => window.vs.addFolder().then(onLib)}><Icon name="plus" size={14} />폴더 추가</button>
          <button className="btn sm" onClick={() => window.vs.rescan().then(onLib)}><Icon name="refresh" size={14} />다시 읽기</button>
        </div>
      </div>

      {(s.blockedActors || []).length > 0 && (
        <div className="sec">
          <h4>지운 배우 이름</h4>
          <div className="desc">정보를 다시 받아도 넣지 않는 이름이에요. "다시 허용"을 누르면 다음 정보 받기부터 다시 들어가요.</div>
          <div className="tags">
            {s.blockedActors.map((n) => (
              <span key={n} className="tag" style={{ cursor: 'default' }}>
                {n} <span className="link" onClick={() => window.vs.unblockActor(n).then((settings) => onLib({ ...lib, settings }))}>다시 허용</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="sec">
        <h4>영상 확장자</h4>
        <div className="inline">
          <input type="text" style={{ flex: 1 }} value={ext} onChange={(e) => setExt(e.target.value)}
            onBlur={() => onSettings({ extensions: ext.split(',').map((x) => x.trim().replace(/^\./, '').toLowerCase()).filter(Boolean) })} />
        </div>
      </div>

      <div className="sec">
        <h4>데이터</h4>
        <div className="desc">버전 {lib.version} · 정리한 정보(library.json), 배우 사진, 표지, 설정이 저장된 폴더예요: {lib.dataDir}</div>
        <button className="btn sm" onClick={() => window.vs.openDataDir()}><Icon name="folder" size={14} />데이터 폴더 열기</button>
      </div>
    </div></div>
  );
}
