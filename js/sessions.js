/**
 * sessions.js — Biswas Lab session persistence
 * Uses IndexedDB to save/restore app state + uploaded files.
 *
 * Per-app integration:
 *   1. Add <script src="/js/sessions.js"></script> before closing </body>
 *   2. Call SessionManager.mount(appId, getState, loadState) after DOMContentLoaded
 *      where:
 *        getState()  → { stateJson: string, files: [{slot, fileName, data: ArrayBuffer}] }
 *        loadState(stateJson, files)  → void  (files = { slot → {fileName, data} })
 */

const SessionManager = (() => {
  /* ─── IndexedDB ─────────────────────────────────────────── */
  const DB_NAME = 'biswas_lab_sessions';
  const DB_VER  = 1;
  let _db = null;

  function _openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('app', 'app', { unique: false });
        }
        if (!db.objectStoreNames.contains('session_files')) {
          const f = db.createObjectStore('session_files', { keyPath: 'id' });
          f.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  }

  function _tx(stores, mode, fn) {
    return _openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(stores, mode);
      tx.onerror = e => rej(e.target.error);
      res(fn(tx));
    }));
  }

  function _uuid() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  }

  /* ─── Public API ─────────────────────────────────────────── */

  /**
   * Save a session.
   * @param {string} app        App identifier (e.g. 'maser', 'tribe')
   * @param {string} name       Session name (user-provided)
   * @param {string} desc       Optional description
   * @param {string} stateJson  JSON string of app state
   * @param {Array}  files      [{slot, fileName, data: ArrayBuffer}]
   * @param {Function} onProgress  optional callback(pct 0-100) during file writes
   * @returns {Promise<string>} session id
   */
  function save(app, name, desc, stateJson, files = [], onProgress) {
    const id = _uuid();
    const fileRefs = files.map(f => ({ slot: f.slot, fileName: f.fileName, size: f.data ? f.data.byteLength : 0 }));
    const session = { id, app, name, description: desc || '', timestamp: Date.now(), stateJson, fileRefs };

    return _tx(['sessions', 'session_files'], 'readwrite', tx => {
      return new Promise((res, rej) => {
        tx.objectStore('sessions').put(session);
        const store = tx.objectStore('session_files');
        let done = 0;
        if (!files.length) { tx.oncomplete = () => res(id); return; }
        files.forEach((f, i) => {
          const rec = { id: id + '_' + f.slot, sessionId: id, slot: f.slot, fileName: f.fileName, data: f.data };
          const r = store.put(rec);
          r.onsuccess = () => {
            done++;
            if (onProgress) onProgress(Math.round(done / files.length * 100));
            if (done === files.length) tx.oncomplete = () => res(id);
          };
          r.onerror = e => rej(e.target.error);
        });
        tx.oncomplete = () => res(id);
        tx.onerror    = e => rej(e.target.error);
      });
    });
  }

  /**
   * List sessions for an app, newest first.
   */
  function list(app) {
    return _tx(['sessions'], 'readonly', tx => new Promise((res, rej) => {
      const idx = tx.objectStore('sessions').index('app');
      const req = idx.getAll(IDBKeyRange.only(app));
      req.onsuccess = e => res((e.target.result || []).sort((a, b) => b.timestamp - a.timestamp));
      req.onerror   = e => rej(e.target.error);
    }));
  }

  /**
   * Load a session and all its files.
   * @returns {Promise<{session, files: {slot→{fileName, data}}}>}
   */
  function load(id) {
    return _tx(['sessions', 'session_files'], 'readonly', tx => new Promise((res, rej) => {
      const sReq = tx.objectStore('sessions').get(id);
      sReq.onsuccess = e => {
        const session = e.target.result;
        if (!session) return rej(new Error('Session not found'));
        const idx  = tx.objectStore('session_files').index('sessionId');
        const fReq = idx.getAll(IDBKeyRange.only(id));
        fReq.onsuccess = fe => {
          const filesArr = fe.target.result || [];
          const files = {};
          filesArr.forEach(f => { files[f.slot] = { fileName: f.fileName, data: f.data }; });
          res({ session, files });
        };
        fReq.onerror = e => rej(e.target.error);
      };
      sReq.onerror = e => rej(e.target.error);
    }));
  }

  /**
   * Delete a session and its files.
   */
  function remove(id) {
    return _tx(['sessions', 'session_files'], 'readwrite', tx => new Promise((res, rej) => {
      tx.objectStore('sessions').delete(id);
      const idx  = tx.objectStore('session_files').index('sessionId');
      const fReq = idx.getAll(IDBKeyRange.only(id));
      fReq.onsuccess = fe => {
        const store = tx.objectStore('session_files');
        (fe.target.result || []).forEach(f => store.delete(f.id));
        tx.oncomplete = () => res();
        tx.onerror    = e => rej(e.target.error);
      };
      fReq.onerror = e => rej(e.target.error);
    }));
  }

  /**
   * Estimate total IndexedDB storage used (bytes).
   */
  async function storageUsed() {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      return est.usage || 0;
    }
    return 0;
  }

  /**
   * Export a session as a downloadable .json bundle (files base64-encoded).
   */
  async function exportSession(id) {
    const { session, files } = await load(id);
    const bundle = { version: 1, session: { ...session }, files: {} };
    for (const [slot, f] of Object.entries(files)) {
      const bytes = new Uint8Array(f.data);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      bundle.files[slot] = { fileName: f.fileName, dataB64: btoa(bin) };
    }
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${session.app}_${session.name.replace(/\s+/g,'_')}_${new Date(session.timestamp).toISOString().slice(0,10)}.session.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /**
   * Import a session from a .session.json bundle text.
   * @returns {Promise<string>} new session id
   */
  async function importSession(jsonText) {
    const bundle = JSON.parse(jsonText);
    if (!bundle.version || !bundle.session) throw new Error('Invalid session file');
    const files = [];
    for (const [slot, f] of Object.entries(bundle.files || {})) {
      const bin  = atob(f.dataB64);
      const buf  = new ArrayBuffer(bin.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
      files.push({ slot, fileName: f.fileName, data: buf });
    }
    const s = bundle.session;
    return save(s.app, s.name + ' (imported)', s.description, s.stateJson, files);
  }

  /* ─── Drawer UI ──────────────────────────────────────────── */

  const CSS = `
#_sm-btn{background:none;border:1px solid #E2DDD8;border-radius:6px;color:#44403C;cursor:pointer;
  font-family:"IBM Plex Sans",sans-serif;font-size:12px;font-weight:600;padding:5px 12px;
  display:flex;align-items:center;gap:5px;transition:background .15s;margin-left:auto}
#_sm-btn:hover{background:#F0EDE9}
#_sm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.18);z-index:9998;opacity:0;
  pointer-events:none;transition:opacity .2s}
#_sm-overlay.open{opacity:1;pointer-events:all}
#_sm-drawer{position:fixed;top:0;right:0;width:380px;max-width:100vw;height:100vh;
  background:#fff;border-left:1px solid #E2DDD8;z-index:9999;display:flex;flex-direction:column;
  transform:translateX(100%);transition:transform .25s cubic-bezier(.4,0,.2,1);box-shadow:-4px 0 24px rgba(0,0,0,.08)}
#_sm-drawer.open{transform:translateX(0)}
#_sm-hdr{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #E2DDD8;flex-shrink:0}
#_sm-hdr-title{font-size:14px;font-weight:700;flex:1}
#_sm-close{background:none;border:none;cursor:pointer;color:#78716C;font-size:18px;padding:2px 6px;line-height:1}
#_sm-close:hover{color:#1C1917}
#_sm-storage{font-size:10px;color:#78716C;padding:6px 16px 6px;border-bottom:1px solid #F0EDE9;flex-shrink:0}
#_sm-save-bar{padding:10px 16px;border-bottom:1px solid #E2DDD8;flex-shrink:0;display:flex;flex-direction:column;gap:6px}
#_sm-save-bar input{border:1px solid #E2DDD8;border-radius:5px;font-family:"IBM Plex Sans",sans-serif;font-size:12px;
  padding:5px 9px;width:100%;outline:none;transition:border-color .15s}
#_sm-save-bar input:focus{border-color:#C2185B}
#_sm-save-row{display:flex;gap:6px}
._sm-pbtn{background:#C2185B;border:none;border-radius:6px;color:#fff;cursor:pointer;
  font-family:"IBM Plex Sans",sans-serif;font-size:12px;font-weight:700;padding:7px 16px;
  transition:background .15s;white-space:nowrap}
._sm-pbtn:hover{background:#A3144E}
._sm-pbtn:disabled{background:#E2DDD8;color:#78716C;cursor:default}
._sm-sbtn{background:#FAFAF9;border:1px solid #E2DDD8;border-radius:6px;color:#44403C;cursor:pointer;
  font-family:"IBM Plex Sans",sans-serif;font-size:12px;font-weight:600;padding:7px 12px;
  transition:background .15s;white-space:nowrap}
._sm-sbtn:hover{background:#F0EDE9}
._sm-sbtn:disabled{opacity:.5;cursor:default}
#_sm-progress{height:3px;background:#E2DDD8;border-radius:2px;overflow:hidden;display:none}
#_sm-progress-bar{height:100%;background:#C2185B;width:0%;transition:width .15s}
#_sm-list-wrap{flex:1;overflow-y:auto;padding:8px 0}
#_sm-empty{padding:32px 16px;text-align:center;color:#78716C;font-size:12px}
._sm-item{padding:10px 16px;border-bottom:1px solid #F0EDE9;display:flex;flex-direction:column;gap:4px}
._sm-item:hover{background:#FAFAF9}
._sm-item-name{font-size:13px;font-weight:600;color:#1C1917}
._sm-item-meta{font-size:10px;color:#78716C;font-family:"IBM Plex Mono",monospace}
._sm-item-btns{display:flex;gap:5px;margin-top:2px}
._sm-ib{background:none;border:1px solid #E2DDD8;border-radius:5px;cursor:pointer;
  font-family:"IBM Plex Sans",sans-serif;font-size:11px;font-weight:600;padding:3px 10px;
  transition:background .15s;color:#44403C}
._sm-ib:hover{background:#F0EDE9}
._sm-ib.danger{color:#9F1239;border-color:#FECDD3}
._sm-ib.danger:hover{background:#FFF1F2}
._sm-ib.primary{background:#C2185B;color:#fff;border-color:#C2185B}
._sm-ib.primary:hover{background:#A3144E}
#_sm-footer{padding:10px 16px;border-top:1px solid #E2DDD8;display:flex;gap:6px;flex-shrink:0}
#_sm-import-input{display:none}
._sm-msg{padding:5px 9px;border-radius:5px;font-size:11px;margin:4px 0}
._sm-msg.ok{background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0}
._sm-msg.err{background:#FFF1F2;color:#9F1239;border:1px solid #FECDD3}
`;

  function _injectCSS() {
    if (document.getElementById('_sm-css')) return;
    const s = document.createElement('style');
    s.id = '_sm-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function _fmt(ts) {
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric',
      year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function _fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    return (b/1024/1024).toFixed(1) + ' MB';
  }

  let _app, _getState, _loadState, _drawerOpen = false;

  async function _refreshList() {
    const wrap = document.getElementById('_sm-list-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div id="_sm-empty">Loading…</div>';
    try {
      const sessions = await list(_app);
      const used = await storageUsed();
      const stor = document.getElementById('_sm-storage');
      if (stor) stor.textContent = `Storage used (all apps): ${_fmtBytes(used)}`;
      if (!sessions.length) {
        wrap.innerHTML = '<div id="_sm-empty">No saved sessions yet.<br>Enter a name above and click Save.</div>';
        return;
      }
      wrap.innerHTML = sessions.map(s => {
        const files = s.fileRefs || [];
        const fileTxt = files.length ? files.map(f => `${f.slot}: ${f.fileName} (${_fmtBytes(f.size)})`).join(', ') : 'no files';
        return `<div class="_sm-item" data-id="${s.id}">
  <div class="_sm-item-name">${_esc(s.name)}</div>
  <div class="_sm-item-meta">${_fmt(s.timestamp)}${s.description ? ' · ' + _esc(s.description) : ''}</div>
  <div class="_sm-item-meta">${_esc(fileTxt)}</div>
  <div class="_sm-item-btns">
    <button class="_sm-ib primary" onclick="_smLoad('${s.id}')">Load</button>
    <button class="_sm-ib" onclick="_smExport('${s.id}')">Export</button>
    <button class="_sm-ib danger" onclick="_smDelete('${s.id}')">Delete</button>
  </div>
</div>`;
      }).join('');
    } catch(e) {
      wrap.innerHTML = `<div id="_sm-empty" style="color:#9F1239">Error: ${_esc(e.message)}</div>`;
    }
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _showMsg(txt, type) {
    const bar = document.getElementById('_sm-save-bar');
    if (!bar) return;
    const old = bar.querySelector('._sm-msg');
    if (old) old.remove();
    const d = document.createElement('div');
    d.className = `_sm-msg ${type}`;
    d.textContent = txt;
    bar.appendChild(d);
    setTimeout(() => d.remove && d.remove(), 3500);
  }

  async function _smSave() {
    const nameEl = document.getElementById('_sm-name');
    const descEl = document.getElementById('_sm-desc');
    const btn     = document.getElementById('_sm-save-btn');
    const prog    = document.getElementById('_sm-progress');
    const progBar = document.getElementById('_sm-progress-bar');
    const name = (nameEl && nameEl.value.trim()) || '';
    if (!name) { _showMsg('Please enter a session name.', 'err'); return; }

    if (btn) btn.disabled = true;
    if (prog) { prog.style.display = 'block'; progBar.style.width = '0%'; }
    try {
      const state = await Promise.resolve(_getState());
      const stateJson = state.stateJson || '{}';
      const files = state.files || [];
      await save(_app, name, descEl ? descEl.value.trim() : '', stateJson, files, pct => {
        if (progBar) progBar.style.width = pct + '%';
      });
      if (nameEl) nameEl.value = '';
      if (descEl) descEl.value = '';
      _showMsg('Session saved.', 'ok');
      _refreshList();
    } catch(e) {
      _showMsg('Save failed: ' + e.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
      if (prog) prog.style.display = 'none';
    }
  }

  async function _smLoad(id) {
    try {
      const { session, files } = await load(id);
      _loadState(session.stateJson, files);
      _closeDrawer();
    } catch(e) {
      _showMsg('Load failed: ' + e.message, 'err');
    }
  }

  async function _smDelete(id) {
    if (!confirm('Delete this session?')) return;
    try {
      await remove(id);
      _refreshList();
    } catch(e) {
      _showMsg('Delete failed: ' + e.message, 'err');
    }
  }

  async function _smExport(id) {
    try { await exportSession(id); }
    catch(e) { _showMsg('Export failed: ' + e.message, 'err'); }
  }

  function _smImportClick() {
    const el = document.getElementById('_sm-import-input');
    if (el) el.click();
  }

  async function _smImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importSession(text);
      _showMsg('Session imported.', 'ok');
      _refreshList();
    } catch(err) {
      _showMsg('Import failed: ' + err.message, 'err');
    }
    e.target.value = '';
  }

  function _openDrawer()  { _drawerOpen = true;  document.getElementById('_sm-drawer').classList.add('open'); document.getElementById('_sm-overlay').classList.add('open'); _refreshList(); }
  function _closeDrawer() { _drawerOpen = false; document.getElementById('_sm-drawer').classList.remove('open'); document.getElementById('_sm-overlay').classList.remove('open'); }

  function _buildDrawer() {
    const overlay = document.createElement('div');
    overlay.id = '_sm-overlay';
    overlay.addEventListener('click', _closeDrawer);

    const drawer = document.createElement('div');
    drawer.id = '_sm-drawer';
    drawer.innerHTML = `
<div id="_sm-hdr">
  <span id="_sm-hdr-title">&#128190; Saved Sessions</span>
  <button id="_sm-close" title="Close" onclick="SessionManager._close()">&#10005;</button>
</div>
<div id="_sm-storage">Computing storage…</div>
<div id="_sm-save-bar">
  <input type="text" id="_sm-name" placeholder="Session name (required)" maxlength="80" />
  <input type="text" id="_sm-desc" placeholder="Description (optional)" maxlength="200" />
  <div id="_sm-save-row">
    <button id="_sm-save-btn" class="_sm-pbtn" onclick="SessionManager._save()">Save current state</button>
  </div>
  <div id="_sm-progress"><div id="_sm-progress-bar"></div></div>
</div>
<div id="_sm-list-wrap"></div>
<div id="_sm-footer">
  <button class="_sm-sbtn" onclick="SessionManager._importClick()">&#8682; Import .session.json</button>
  <input type="file" id="_sm-import-input" accept=".json,.session.json" onchange="SessionManager._importFile(event)" />
</div>`;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
  }

  /**
   * Mount the session UI into the app.
   * @param {string}   appId      Short identifier, e.g. 'maser'
   * @param {Function} getState   () → {stateJson, files:[{slot,fileName,data}]}
   * @param {Function} loadState  (stateJson, files:{slot→{fileName,data}}) → void
   */
  function mount(appId, getState, loadState) {
    _app = appId;
    _getState  = getState;
    _loadState = loadState;

    _injectCSS();
    _buildDrawer();

    // Insert button into topbar
    const topbar = document.querySelector('.topbar');
    if (topbar) {
      const btn = document.createElement('button');
      btn.id = '_sm-btn';
      btn.innerHTML = '&#128190; Sessions';
      btn.title = 'Save / load sessions';
      btn.addEventListener('click', _openDrawer);
      topbar.appendChild(btn);
    }
  }

  // Expose private helpers as public for inline onclick handlers
  return {
    mount,
    save, list, load, remove,
    exportSession, importSession, storageUsed,
    // Internal — used by inline onclick attributes in drawer
    _save:        _smSave,
    _close:       _closeDrawer,
    _importClick: _smImportClick,
    _importFile:  _smImportFile,
  };
})();
