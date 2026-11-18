const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('vs', {
  getLibrary: () => ipcRenderer.invoke('lib:get'),
  addFolder: () => ipcRenderer.invoke('folder:add'),
  // 끌어다 놓은 파일의 실제 경로 (Electron 32부터 File.path 대신 이걸 써야 함)
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  addPaths: (paths) => ipcRenderer.invoke('files:add', paths),
  removeFolder: (id) => ipcRenderer.invoke('folder:remove', id),
  rescan: () => ipcRenderer.invoke('lib:rescan'),
  organize: (opts) => ipcRenderer.invoke('organize:start', opts),
  cancelOrganize: () => ipcRenderer.invoke('organize:cancel'),
  retranslateTitles: () => ipcRenderer.invoke('titles:retranslate'),
  testDeepl: (key) => ipcRenderer.invoke('deepl:test', key),
  updateVideo: (id, patch) => ipcRenderer.invoke('video:update', id, patch),
  play: (id) => ipcRenderer.invoke('video:play', id), // 외부(기본) 플레이어
  markPlayed: (id) => ipcRenderer.invoke('video:played', id),
  savePosition: (id, pos, dur) => ipcRenderer.invoke('video:position', id, pos, dur),
  deleteVideos: (ids, opts) => ipcRenderer.invoke('video:delete', ids, opts),
  savePlaylists: (pls) => ipcRenderer.invoke('playlists:save', pls),
  reveal: (id) => ipcRenderer.invoke('video:reveal', id),
  refetch: (id) => ipcRenderer.invoke('video:refetch', id),
  chooseCover: (id) => ipcRenderer.invoke('video:chooseCover', id),
  updateActor: (name, patch) => ipcRenderer.invoke('actor:update', name, patch),
  chooseActorPhoto: (name) => ipcRenderer.invoke('actor:choosePhoto', name),
  removeActor: (name, opts) => ipcRenderer.invoke('actor:remove', name, opts),
  fetchActorPhotos: () => ipcRenderer.invoke('actors:fetchPhotos'),
  onActorsProgress: on('actors:progress'),
  unblockActor: (name) => ipcRenderer.invoke('actor:unblock', name),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  relocateCovers: () => ipcRenderer.invoke('covers:relocate'),
  addCoverRule: (code, url) => ipcRenderer.invoke('coverRules:addFromUrl', code, url),
  removeCoverRule: (label, index) => ipcRenderer.invoke('coverRules:remove', label, index),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  onProgress: on('organize:progress'),
  onVideoChanged: on('video:changed'),
  onLibraryChanged: on('library:changed'),
});
