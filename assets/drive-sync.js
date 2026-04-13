/* ═══════════════════════════════════════════════════════════
   DRIVE SYNC REAL — Base de datos compartida PC ↔ Android
   
   Estrategia: Drive es la fuente de verdad.
   
   Drive/Antalavera Arquitectura — ObraApp/
     ├── _index.json          ← índice de todos los eventos
     ├── _contacts.json       ← agenda de contactos
     ├── [Proyecto]/
     │    └── [ID_titulo]/
     │         ├── evento.json  ← metadatos completos
     │         ├── notas.txt
     │         ├── fotos/       ← imágenes con metadatos
     │         ├── audios/
     │         ├── archivos/
     │         └── firma.png
   
   Flujo:
   - Al abrir la app: pull desde Drive → IndexedDB local
   - Al guardar algo: push a Drive → IndexedDB local
   - Cambios en PC se ven en Android y viceversa
   ═══════════════════════════════════════════════════════════ */

const DriveDB = {
  CLIENT_ID: '',
  CLIENT_SECRET: '',
  SCOPES: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' '),

  accessToken: null,

  setStatus(state, msg) {
    // Actualizar indicador lateral
    const el = document.getElementById('drive-sidebar-status');
    const icons = { connected:'☁️', syncing:'🔄', disconnected:'☁️', error:'⚠️' };
    if (el) el.textContent = (icons[state]||'☁️') + ' Drive: ' + (msg||state);
    this.userEmail = (state === 'connected' && msg) ? msg : (this.userEmail || '');
  },
  userEmail: null,
  userName: null,
  rootId: null,
  dbFolderId: null,
  APP_FOLDER: 'Antalavera Arquitectura — ObraApp',

  isSyncing: false,
  pendingPush: new Set(),  // IDs de eventos con cambios pendientes

  /* ──────────────────────────────────────────
     AUTH
  ────────────────────────────────────────── */
  loadConfig() {
    this.CLIENT_ID     = localStorage.getItem('drive_client_id')     || '';
    this.CLIENT_SECRET = localStorage.getItem('drive_client_secret') || '';
    const expiresAt = parseInt(localStorage.getItem('drive_token_ts') || '0');
    if (expiresAt > Date.now()) {
      this.accessToken = localStorage.getItem('drive_token');
      this.userEmail   = localStorage.getItem('drive_user_email');
      this.userName    = localStorage.getItem('drive_user_name');
      this.rootId      = localStorage.getItem('drive_root_id');
      this.dbFolderId  = localStorage.getItem('drive_db_folder_id');
    }
    return !!this.accessToken;
  },

  isConnected() { return !!this.accessToken; },

  async login() {
    if (!this.CLIENT_ID) {
      Toast.show('Configura el Client ID en Perfil del estudio', 'error');
      return false;
    }

    const isElectron = !!(window.electronAPI?.isElectron);
    const OAUTH_PORT = 3737;

    // ── Generar PKCE (Proof Key for Code Exchange)
    const verifier  = this._generateVerifier();
    const challenge = await this._generateChallenge(verifier);

    // Para Desktop app de Google: localhost se acepta sin configurar
    const redirectUri = `http://127.0.0.1:${OAUTH_PORT}`;

    // Usamos response_type=code (auth code) con PKCE
    // Funciona con tipo "Aplicación de escritorio" en Google Cloud
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
      + `?client_id=${encodeURIComponent(this.CLIENT_ID)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&response_type=code`
      + `&scope=${encodeURIComponent(this.SCOPES)}`
      + `&code_challenge=${challenge}`
      + `&code_challenge_method=S256`
      + `&access_type=offline`
      + `&prompt=consent`;

    this.setStatus('syncing', 'Abriendo Google en el navegador...');

    return new Promise(async (resolve) => {
      const handleCode = async (code) => {
        if (!code) { this.setStatus('disconnected', 'No conectado'); resolve(false); return; }
        try {
          this.setStatus('syncing', 'Obteniendo token...');
          // Intercambiar código por token
          // Para Desktop app con PKCE no se necesita client_secret
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id:     this.CLIENT_ID,
              client_secret: this.CLIENT_SECRET || '',
              code,
              code_verifier: verifier,
              redirect_uri:  redirectUri,
              grant_type:    'authorization_code',
            })
          });
          const tokenData = await tokenRes.json();
          if (tokenData.error) {
            // Si falla sin secret, intentar sin él
            Toast.show('Error token: ' + tokenData.error_description, 'error');
            this.setStatus('error', tokenData.error);
            resolve(false);
            return;
          }
          const token = tokenData.access_token;
          this.accessToken = token;
          const expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000 - 60000;
          localStorage.setItem('drive_token',         token);
          localStorage.setItem('drive_token_ts',      expiresAt.toString());
          if (tokenData.refresh_token) {
            localStorage.setItem('drive_refresh_token', tokenData.refresh_token);
          }
          this.setStatus('syncing', 'Verificando cuenta...');
          const info = await this.apiFetch('GET', 'https://www.googleapis.com/oauth2/v2/userinfo');
          this.userEmail = info.email;
          this.userName  = info.name;
          localStorage.setItem('drive_user_email', info.email || '');
          localStorage.setItem('drive_user_name',  info.name  || '');
          this.setStatus('syncing', 'Preparando Drive...');
          await this.initFolders();
          this.setStatus('connected', info.email);
          Toast.show('Google Drive conectado ✓', 'success');
          resolve(true);
        } catch(e) {
          Toast.show('Error: ' + e.message, 'error');
          this.setStatus('error', e.message.slice(0,40));
          resolve(false);
        }
      };

      // Lanzar servidor OAuth y abrir navegador
      window.__oauthCode = handleCode;
      if (isElectron) {
        const result = await window.electronAPI.oauthStart({ authUrl });
        if (!result?.ok) {
          Toast.show('Error iniciando servidor OAuth', 'error');
          resolve(false);
          return;
        }
      } else {
        // Web: popup normal
        const popup = window.open(authUrl, 'google-auth', 'width=520,height=650,resizable=yes');
        if (!popup) { window.location.href = authUrl; return; }
        const check = setInterval(() => {
          try {
            if (popup?.location?.search?.includes('code=')) {
              clearInterval(check);
              const p = new URLSearchParams(popup.location.search.slice(1));
              popup.close();
              handleCode(p.get('code'));
            }
          } catch(e) {}
          if (popup?.closed && !this.accessToken) { clearInterval(check); resolve(false); }
        }, 500);
      }
      // Timeout 3 min
      setTimeout(() => { if (!this.accessToken) { this.setStatus('disconnected','No conectado'); resolve(false); } }, 180000);
    });
  },

  /* PKCE helpers */
  _generateVerifier() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  },
  async _generateChallenge(verifier) {
    const data   = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  },

  async apiFetch(method, url, body, rawBody) {
    if (!this.accessToken) throw new Error('No autenticado');
    const headers = { Authorization: `Bearer ${this.accessToken}` };
    let fetchBody;
    if (rawBody) { fetchBody = rawBody; }
    else if (body) { headers['Content-Type'] = 'application/json'; fetchBody = JSON.stringify(body); }
    const res = await fetch(url, { method, headers, body: fetchBody });
    if (res.status === 401) { this.logout(); throw new Error('Sesión expirada. Vuelve a conectar Google Drive.'); }
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${(await res.text()).slice(0,120)}`);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  },

  async findOrCreate(name, parentId) {
    const parentQ = parentId ? `and '${parentId}' in parents` : `and 'root' in parents`;
    const q = `name='${name.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false ${parentQ}`;
    const res = await this.apiFetch('GET', `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    if (res.files?.length) return res.files[0].id;
    const f = await this.apiFetch('POST', 'https://www.googleapis.com/drive/v3/files', {
      name, mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {})
    });
    return f.id;
  },

  async findFile(name, parentId) {
    const q = `name='${name.replace(/'/g,"\\'")}' and '${parentId}' in parents and trashed=false`;
    const res = await this.apiFetch('GET', `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)`);
    return res.files?.[0] || null;
  },

  async readJson(fileId) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
    if (!res.ok) return null;
    return res.json();
  },

  async writeJson(name, data, parentId, existingId) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const meta = { name, ...(existingId ? {} : { parents: [parentId] }) };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', blob);
    const method = existingId ? 'PATCH' : 'POST';
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`;
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${this.accessToken}` }, body: form });
    return res.json();
  },

  async uploadBinary(name, dataUrl, parentId) {
    const [header, b64] = dataUrl.split(',');
    const mime = header.split(':')[1].split(';')[0];
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name, parents: [parentId] })], { type: 'application/json' }));
    form.append('file', new Blob([arr], { type: mime }));
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST', headers: { Authorization: `Bearer ${this.accessToken}` }, body: form
    });
    return res.json();
  },

  /* ──────────────────────────────────────────
     INIT FOLDERS
  ────────────────────────────────────────── */
  async initFolders() {
    this.rootId = await this.findOrCreate(this.APP_FOLDER, null);
    this.dbFolderId = await this.findOrCreate('_db', this.rootId);
    localStorage.setItem('drive_root_id', this.rootId);
    localStorage.setItem('drive_db_folder_id', this.dbFolderId);
  },

  async ensureFolders() {
    if (!this.rootId) this.rootId = localStorage.getItem('drive_root_id');
    if (!this.dbFolderId) this.dbFolderId = localStorage.getItem('drive_db_folder_id');
    if (!this.rootId || !this.dbFolderId) await this.initFolders();
  },

  /* ──────────────────────────────────────────
     PULL — Descargar desde Drive a local
  ────────────────────────────────────────── */
  async pullAll(onProgress) {
    if (!this.isConnected()) return;
    await this.ensureFolders();
    this.setStatus('syncing', 'Descargando desde Drive...');

    try {
      // Pull index
      const idxFile = await this.findFile('_index.json', this.dbFolderId);
      if (!idxFile) { this.setStatus('connected', this.userEmail); return; }

      onProgress?.('Leyendo índice de eventos...');
      const index = await this.readJson(idxFile.id);
      if (!index?.events) { this.setStatus('connected', this.userEmail); return; }

      let pulled = 0;
      for (const ref of index.events) {
        onProgress?.(`Sincronizando evento ${++pulled}/${index.events.length}...`);
        await this.pullEvent(ref);
      }

      // Pull contacts
      const contactsFile = await this.findFile('_contacts.json', this.dbFolderId);
      if (contactsFile) {
        const contacts = await this.readJson(contactsFile.id);
        if (Array.isArray(contacts)) {
          for (const c of contacts) await DB.put('contacts', c);
        }
      }

      this.setStatus('connected', `${this.userEmail} · ${pulled} eventos`);
      Toast.show(`✓ Sincronizado: ${pulled} eventos desde Drive`, 'success');
    } catch(e) {
      this.setStatus('error', 'Error sync: ' + e.message.slice(0,30));
      console.error('Pull error:', e);
    }
  },

  async pullEvent(ref) {
    // Find event folder
    const projFolderId = await this.findOrCreate(ref.project || 'Sin proyecto', this.rootId);
    const evFolderId   = await this.findOrCreate(ref.folderId || ref.title, projFolderId);

    const evFile = await this.findFile('evento.json', evFolderId);
    if (!evFile) return;

    const evData = await this.readJson(evFile.id);
    if (!evData) return;

    // Check if local version is newer
    const localEv = await DB.get('events', evData.id);
    if (localEv?.updatedAt && evData.updatedAt && localEv.updatedAt > evData.updatedAt) return; // local is newer

    // Save event metadata
    await DB.put('events', { ...evData, _driveEvFolder: evFolderId });

    // Pull notes
    const notesFile = await this.findFile('notas.txt', evFolderId);
    if (notesFile) {
      const txt = await fetch(`https://www.googleapis.com/drive/v3/files/${notesFile.id}?alt=media`, {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      }).then(r => r.text());
      const existing = await DB.getAll('notes', 'eventId', evData.id);
      await DB.put('notes', { id: existing[0]?.id, eventId: evData.id, content: txt });
    }
  },

  /* ──────────────────────────────────────────
     PUSH — Subir evento a Drive
  ────────────────────────────────────────── */
  async pushEvent(eventId, onProgress) {
    if (!this.isConnected()) return;
    await this.ensureFolders();
    this.setStatus('syncing', 'Subiendo a Drive...');

    try {
      const ev      = await DB.get('events', eventId);
      if (!ev) return;
      const media   = await DB.getAll('media', 'eventId', eventId);
      const audios  = await DB.getAll('audios', 'eventId', eventId);
      const files   = await DB.getAll('files', 'eventId', eventId);
      const notes   = await DB.getAll('notes', 'eventId', eventId);

      onProgress?.('Preparando carpeta en Drive...');
      const projFolder = await this.findOrCreate(ev.project || 'Sin proyecto', this.rootId);
      const evSlug = `${ev.date || 'sin-fecha'}_${ev.id.slice(0,8)}`;
      const evFolder   = await this.findOrCreate(evSlug, projFolder);

      // Save folder reference
      await DB.put('events', { ...ev, _driveEvFolder: evFolder });

      // Upload evento.json
      onProgress?.('Guardando metadatos...');
      const existingEvJson = await this.findFile('evento.json', evFolder);
      await this.writeJson('evento.json', { ...ev, _driveEvFolder: evFolder }, evFolder, existingEvJson?.id);

      // Upload notes
      if (notes.length > 0 && notes[0]?.content) {
        onProgress?.('Guardando notas...');
        const noteTxt = notes.map(n => n.content).join('\n\n---\n\n');
        const existingNotes = await this.findFile('notas.txt', evFolder);
        if (existingNotes) {
          await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingNotes.id}?uploadType=media`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'text/plain' },
            body: noteTxt
          });
        } else {
          const form = new FormData();
          form.append('metadata', new Blob([JSON.stringify({ name:'notas.txt', parents:[evFolder] })], {type:'application/json'}));
          form.append('file', new Blob([noteTxt], {type:'text/plain'}));
          await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method:'POST', headers:{Authorization:`Bearer ${this.accessToken}`}, body:form
          });
        }
      }

      // Upload media (only new ones without driveId)
      const photosFolder = await this.findOrCreate('fotos', evFolder);
      let mediaCount = 0;
      for (const m of media) {
        if (m._driveId) continue; // already uploaded
        onProgress?.(`Subiendo foto ${++mediaCount}/${media.filter(x=>!x._driveId).length}...`);
        const ext = m.type?.includes('video') ? 'webm' : 'jpg';
        const res = await this.uploadBinary(`foto_${m.id.slice(0,8)}.${ext}`, m.dataUrl, photosFolder);
        await DB.put('media', { ...m, _driveId: res.id });
      }

      // Upload audios
      const audiosFolder = await this.findOrCreate('audios', evFolder);
      for (const a of audios) {
        if (a._driveId) continue;
        onProgress?.('Subiendo audio...');
        const res = await this.uploadBinary(`audio_${a.id.slice(0,8)}.webm`, a.dataUrl, audiosFolder);
        await DB.put('audios', { ...a, _driveId: res.id });
        // Save transcript separately if exists
        if (a.transcript) {
          const form = new FormData();
          form.append('metadata', new Blob([JSON.stringify({ name:`transcripcion_${a.id.slice(0,8)}.txt`, parents:[audiosFolder] })], {type:'application/json'}));
          form.append('file', new Blob([a.transcript], {type:'text/plain'}));
          await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method:'POST', headers:{Authorization:`Bearer ${this.accessToken}`}, body:form
          });
        }
      }

      // Upload files (PDFs, DWGs, etc.)
      const filesFolder = await this.findOrCreate('archivos', evFolder);
      for (const f of files) {
        if (f._driveId) continue;
        onProgress?.(`Subiendo ${f.name}...`);
        const res = await this.uploadBinary(f.name, f.dataUrl, filesFolder);
        await DB.put('files', { ...f, _driveId: res.id });
      }

      // Update global index
      await this.updateIndex(ev, evSlug);

      onProgress?.('✓ Sincronizado');
      this.setStatus('connected', `${this.userEmail} · guardado`);
      return `https://drive.google.com/drive/folders/${evFolder}`;

    } catch(e) {
      this.setStatus('error', e.message.slice(0,40));
      throw e;
    }
  },

  async updateIndex(ev, folderId) {
    const idxFile = await this.findFile('_index.json', this.dbFolderId);
    let index = { events: [], lastUpdate: '' };
    if (idxFile) {
      try { index = await this.readJson(idxFile.id) || index; } catch {}
    }
    const existing = index.events.findIndex(e => e.id === ev.id);
    const ref = { id: ev.id, title: ev.title, date: ev.date, type: ev.type, project: ev.project, folderId };
    if (existing >= 0) index.events[existing] = ref;
    else index.events.push(ref);
    index.lastUpdate = new Date().toISOString();
    await this.writeJson('_index.json', index, this.dbFolderId, idxFile?.id);
  },

  /* Push contacts to Drive */
  async pushContacts() {
    if (!this.isConnected()) return;
    await this.ensureFolders();
    const contacts = await DB.getAll('contacts');
    const existing = await this.findFile('_contacts.json', this.dbFolderId);
    await this.writeJson('_contacts.json', contacts, this.dbFolderId, existing?.id);
  },

  /* ──────────────────────────────────────────
     AUTO-SYNC — Push cuando hay cambios
  ────────────────────────────────────────── */
  queuePush(eventId) {
    this.pendingPush.add(eventId);
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.flushQueue(), 3000); // 3s debounce
  },
  _pushTimer: null,

  async flushQueue() {
    if (!this.isConnected() || this.isSyncing || this.pendingPush.size === 0) return;
    this.isSyncing = true;
    const ids = [...this.pendingPush];
    this.pendingPush.clear();
    try {
      for (const id of ids) {
        await this.pushEvent(id, () => {});
      }
    } catch(e) { console.warn('Auto-sync error:', e.message); }
    finally { this.isSyncing = false; }
  },

  /* ──────────────────────────────────────────
     GMAIL — Envío de email via API
  ────────────────────────────────────────── */
  async sendEmail({ to, cc, subject, body, attachments = [] }) {
    if (!this.isConnected()) throw new Error('Google no conectado');
    const estudio = Estudio.load();
    const fromName = estudio.nombre || 'Antalavera Arquitectura';
    const boundary = 'boundary_ob_' + Date.now();

    let mime = [
      `From: ${fromName} <${this.userEmail}>`,
      `To: ${[].concat(to).join(', ')}`,
      cc ? `Cc: ${[].concat(cc).join(', ')}` : '',
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      'MIME-Version: 1.0',
    ].filter(Boolean);

    if (!attachments.length) {
      mime.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
        btoa(unescape(encodeURIComponent(body))));
    } else {
      mime.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '');
      mime.push(`--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
        btoa(unescape(encodeURIComponent(body))), '');
      for (const att of attachments) {
        mime.push(`--${boundary}`);
        mime.push(`Content-Type: ${att.type || 'application/octet-stream'}`);
        mime.push(`Content-Disposition: attachment; filename="${att.name}"`);
        mime.push('Content-Transfer-Encoding: base64', '', att.b64, '');
      }
      mime.push(`--${boundary}--`);
    }

    const raw = btoa(unescape(encodeURIComponent(mime.join('\r\n'))))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    await this.apiFetch('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw });
  },

  /* ──────────────────────────────────────────
     CONFIG PANEL
  ────────────────────────────────────────── */
  renderPanel() {
    this.loadConfig();
    const ok = this.isConnected();
    return `
      <div class="card mb-3">
        <div class="section-title mb-3">☁️ Google Drive — Base de datos compartida</div>
        <div style="background:var(--surface2);border-radius:var(--radius);padding:12px;margin-bottom:14px;font-size:13px;color:var(--text2);border-left:3px solid var(--cyan)">
          Cuando Drive está conectado, <strong style="color:var(--white)">todos los cambios</strong> se sincronizan automáticamente entre el PC y el móvil. Ambos dispositivos comparten la misma base de datos en Drive.
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <div style="width:10px;height:10px;border-radius:50%;background:${ok?'var(--green)':'var(--text3)'}"></div>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--white)">${ok ? this.userEmail : 'No conectado'}</div>
            ${ok ? `<div style="font-size:11px;color:var(--text3)">Carpeta: ${this.APP_FOLDER}</div>` : ''}
          </div>
          ${ok
            ? `<button class="btn btn-danger btn-sm" onclick="DriveDB.logout();App.navigate('perfil')">Desconectar</button>
               <button class="btn btn-secondary btn-sm" onclick="DriveDB.pullAll(msg=>Toast.show(msg))">🔄 Sync ahora</button>`
            : `<button class="btn btn-primary" onclick="DriveDB.login().then(ok=>ok&&App.navigate('perfil'))">🔗 Conectar con Google</button>`}
        </div>
        <div class="form-group">
          <label class="form-label">Google OAuth 2.0 Client ID</label>
          <input id="drive-client-id" class="form-input" placeholder="XXXXXXXX.apps.googleusercontent.com" value="${this.CLIENT_ID}" style="font-size:12px;font-family:var(--mono)">
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Formato: 123456789-xxxx.apps.googleusercontent.com</div>
        </div>
        <div class="form-group">
          <label class="form-label">Client Secret (opcional para Desktop app)</label>
          <input id="drive-client-secret" type="password" class="form-input" placeholder="GOCSPX-..." value="${this.CLIENT_SECRET}" style="font-size:12px;font-family:var(--mono)">
          <div style="font-size:11px;color:var(--text3);margin-top:6px;line-height:1.7;padding:8px;background:var(--bg);border-radius:6px;border-left:2px solid var(--cyan)">
            <strong style="color:var(--white)">Configuración en Google Cloud Console:</strong><br>
            1. Ve a <a href="https://console.cloud.google.com" target="_blank" style="color:var(--cyan)">console.cloud.google.com</a>
            → APIs y servicios → Credenciales<br>
            2. Clic en <strong>+ Crear credenciales → ID de cliente OAuth 2.0</strong><br>
            3. Tipo de aplicación: <strong style="color:var(--yellow-corp)">Aplicación de escritorio</strong><br>
            4. Nombre: <em>Antalavera ObraApp</em> → Crear<br>
            5. Descarga el JSON o copia el Client ID y Client Secret<br>
            6. Activa en Biblioteca: <strong>Drive API</strong> y <strong>Gmail API</strong>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="
          DriveDB.CLIENT_ID=document.getElementById('drive-client-id').value.trim();
          DriveDB.CLIENT_SECRET=document.getElementById('drive-client-secret').value.trim();
          localStorage.setItem('drive_client_id',DriveDB.CLIENT_ID);
          localStorage.setItem('drive_client_secret',DriveDB.CLIENT_SECRET);
          Toast.show('Credenciales guardadas ✓','success')">
          Guardar credenciales
        </button>
        <details style="margin-top:14px">
          <summary style="font-size:12px;color:var(--cyan);cursor:pointer;font-family:var(--font-cond);letter-spacing:.05em;text-transform:uppercase">
            ▸ Diagnóstico — ver URL que se envía a Google
          </summary>
          <div style="margin-top:8px;padding:10px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">
            <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Copia esta URL exactamente en "URIs de redireccionamiento" de Google Cloud:</div>
            <code style="font-size:11px;color:var(--yellow-corp);word-break:break-all">http://127.0.0.1:3737</code>
            <div style="font-size:11px;color:var(--text3);margin-top:8px;margin-bottom:4px">Tipo de aplicación en Google Cloud:</div>
            <code style="font-size:11px;color:var(--cyan)">Aplicación de escritorio</code>
          </div>
        </details>
      </div>
    `;
  }
};

/* ──────────────────────────────────────────
   PATCH: auto-push cuando se guarda algo
────────────────────────────────────────── */
/* DB.put override deshabilitado — sync.js gestiona el push */
/* El doble override causaba conflictos y doble sincronización */

/* ──────────────────────────────────────────
   BOOT: pull desde Drive al iniciar
────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  if (DriveDB.loadConfig() && DriveDB.isConnected()) {
    // Mostrar estado conectado inmediatamente en sidebar
    setTimeout(() => {
      DriveDB.setStatus('connected', DriveDB.userEmail || 'conectado');
    }, 500);

    // Pull automático deshabilitado — usar botón manual en Perfil
    // (el pull automático causaba que datos borrados volvieran a aparecer)
    setTimeout(() => {
      DriveDB.setStatus('connected', DriveDB.userEmail || 'conectado');
    }, 1500);
  }
});

/* DriveDB es el módulo principal de sincronización */
