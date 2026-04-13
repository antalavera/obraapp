/* ═══════════════════════════════════════════════
   DRIVE SYNC — Sincronización con Google Drive
   Usa Google Drive API v3 con OAuth2 PKCE
   El usuario configura su propio Client ID de
   Google Cloud Console (uso privado/estudio)
   ═══════════════════════════════════════════════ */
const Drive = {
  accessToken: null,
  rootFolderId: null,
  appFolderName: 'Antalavera Arquitectura — ObraApp',
  CLIENT_ID: '',      // se configura en perfil del estudio
  SCOPES: 'https://www.googleapis.com/auth/drive.file',

  /* ─── Configurar client ID ─── */
  setClientId(id) { this.CLIENT_ID = id; localStorage.setItem('drive_client_id', id); },
  loadClientId() { this.CLIENT_ID = localStorage.getItem('drive_client_id') || ''; return this.CLIENT_ID; },

  /* ─── OAuth2 login con PKCE ─── */
  async login() {
    if (!this.CLIENT_ID) {
      Toast.show('Configura tu Google Client ID en el Perfil del estudio', 'error');
      return false;
    }
    const redirectUri = window.location.origin + window.location.pathname;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(this.CLIENT_ID)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=token&scope=${encodeURIComponent(this.SCOPES)}&` +
      `include_granted_scopes=true&state=drive_auth`;
    const popup = window.open(authUrl, 'google-auth', 'width=500,height=600,resizable=yes');
    return new Promise(resolve => {
      const check = setInterval(() => {
        try {
          if (popup?.location?.hash?.includes('access_token')) {
            const params = new URLSearchParams(popup.location.hash.slice(1));
            this.accessToken = params.get('access_token');
            localStorage.setItem('drive_token', this.accessToken);
            localStorage.setItem('drive_token_ts', Date.now());
            popup.close();
            clearInterval(check);
            Toast.show('Conectado con Google Drive ✓', 'success');
            resolve(true);
          }
          if (popup?.closed && !this.accessToken) { clearInterval(check); resolve(false); }
        } catch {}
      }, 500);
    });
  },

  loadToken() {
    const ts = parseInt(localStorage.getItem('drive_token_ts') || '0');
    if (Date.now() - ts < 3500 * 1000) { // ~1 hora de validez
      this.accessToken = localStorage.getItem('drive_token');
    }
    return !!this.accessToken;
  },

  logout() {
    this.accessToken = null;
    localStorage.removeItem('drive_token');
    localStorage.removeItem('drive_token_ts');
    Toast.show('Desconectado de Google Drive');
  },

  async ensureAuth() {
    if (this.loadToken()) return true;
    return this.login();
  },

  /* ─── API helpers ─── */
  async apiGet(url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (r.status === 401) { this.logout(); throw new Error('Sesión expirada, vuelve a conectar'); }
    return r.json();
  },

  async apiPost(url, body, contentType = 'application/json') {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': contentType },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    if (r.status === 401) { this.logout(); throw new Error('Sesión expirada'); }
    return r.json();
  },

  /* ─── Gestión de carpetas ─── */
  async getOrCreateFolder(name, parentId = null) {
    const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentId ? ` and '${parentId}' in parents` : ''}`;
    const res = await this.apiGet(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    if (res.files?.length > 0) return res.files[0].id;
    const folder = await this.apiPost('https://www.googleapis.com/drive/v3/files', {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {})
    });
    return folder.id;
  },

  async ensureRootFolder() {
    if (this.rootFolderId) return this.rootFolderId;
    this.rootFolderId = await this.getOrCreateFolder(this.appFolderName);
    return this.rootFolderId;
  },

  /* ─── Subir archivo a Drive ─── */
  async uploadFile(name, dataUrl, parentId) {
    const base64 = dataUrl.split(',')[1];
    const mimeType = dataUrl.split(':')[1].split(';')[0];
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    const blob = new Blob([array], { type: mimeType });

    const metadata = { name, parents: [parentId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form
    });
    if (r.status === 401) { this.logout(); throw new Error('Sesión expirada'); }
    return r.json();
  },

  /* ─── Sincronizar evento completo ─── */
  async syncEvent(eventId, onProgress) {
    if (!(await this.ensureAuth())) return;

    const ev = await DB.get('events', eventId);
    const media = await DB.getAll('media', 'eventId', eventId);
    const audios = await DB.getAll('audios', 'eventId', eventId);
    const files = await DB.getAll('files', 'eventId', eventId);
    const notes = await DB.getAll('notes', 'eventId', eventId);

    onProgress?.('Creando carpeta en Drive...');
    const rootId = await this.ensureRootFolder();
    const projectFolder = await this.getOrCreateFolder(ev.project || 'Sin proyecto', rootId);
    const evDate = ev.date || 'sin-fecha';
    const evFolderName = `${evDate}_${(ev.title || 'evento').replace(/[<>:"/\\|?*]/g, '_').slice(0,40)}`;
    const evFolderId = await this.getOrCreateFolder(evFolderName, projectFolder);

    let uploaded = 0;
    const total = 1 + media.length + audios.length + files.length + (notes.length > 0 ? 1 : 0);

    // info.txt
    const info = `EVENTO: ${ev.title}\nTipo: ${ev.type === 'obra' ? 'Visita de obra' : 'Reunión'}\nFecha: ${ev.date||'—'}\nLugar: ${ev.location||'—'}\nProyecto: ${ev.project||'—'}\nParticipantes: ${(ev.participants||[]).join(', ')||'—'}\nDescripción: ${ev.description||'—'}\nUbicación GPS: ${ev.lat ? `${ev.lat}, ${ev.lng}` : '—'}\nCreado: ${ev.createdAt}`;
    await this.uploadFile('info.txt', 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(info))), evFolderId);
    uploaded++; onProgress?.(`${uploaded}/${total} archivos...`);

    // Notas
    if (notes.length > 0) {
      const noteTxt = notes.map(n => n.content).join('\n\n---\n\n');
      await this.uploadFile('notas.txt', 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(noteTxt))), evFolderId);
      uploaded++; onProgress?.(`${uploaded}/${total} archivos...`);
    }

    // Subcarpetas
    const photosFId = await this.getOrCreateFolder('fotos', evFolderId);
    const audiosFId = await this.getOrCreateFolder('audios', evFolderId);
    const filesFId  = await this.getOrCreateFolder('archivos', evFolderId);

    for (let i = 0; i < media.length; i++) {
      const m = media[i];
      const ext = m.type?.includes('video') ? 'webm' : 'jpg';
      await this.uploadFile(`foto_${String(i+1).padStart(3,'0')}.${ext}`, m.dataUrl, photosFId);
      uploaded++; onProgress?.(`${uploaded}/${total} — Fotos: ${i+1}/${media.length}`);
    }
    for (let i = 0; i < audios.length; i++) {
      await this.uploadFile(`audio_${String(i+1).padStart(3,'0')}.webm`, audios[i].dataUrl, audiosFId);
      uploaded++; onProgress?.(`${uploaded}/${total} — Audios: ${i+1}/${audios.length}`);
    }
    for (const f of files) {
      await this.uploadFile(f.name, f.dataUrl, filesFId);
      uploaded++; onProgress?.(`${uploaded}/${total} — Archivos: ${f.name}`);
    }

    // Guardar link en evento
    const evData = await DB.get('events', eventId);
    await DB.put('events', { ...evData, driveFolder: evFolderName, driveSynced: new Date().toISOString() });

    return `https://drive.google.com/drive/folders/${evFolderId}`;
  },

  /* ─── Panel de configuración Drive ─── */
  desconectar() {
    ['drive_token','drive_token_ts','drive_user_email','drive_user_name','drive_root_id','drive_db_folder_id'].forEach(k => localStorage.removeItem(k));
    if (typeof DriveDB !== 'undefined') { DriveDB.accessToken = null; DriveDB.rootId = null; }
    Toast.show('Desconectado de Google Drive');
    App.navigate('perfil');
  },

  renderDrivePanel() {
    const clientId     = localStorage.getItem('drive_client_id')     || '';
    const clientSecret = localStorage.getItem('drive_client_secret') || '';
    const token        = localStorage.getItem('drive_token');
    const tokenTs      = parseInt(localStorage.getItem('drive_token_ts') || '0');
    const isAuth       = !!(token && tokenTs > Date.now());
    const userEmail    = localStorage.getItem('drive_user_email') || '';

    return `
      <div class="card mb-3">
        <div class="section-title mb-3">☁️ Google Drive — Sincronización compartida</div>

        <div style="background:var(--surface2);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--text2);border-left:3px solid var(--cyan)">
          PC y Android compartirán la misma carpeta en Drive. Los cambios en uno se ven en el otro.
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <div style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${isAuth ? '#22c55e' : '#5c6370'}"></div>
          <span style="font-size:13px;color:var(--text2)">${isAuth ? 'Conectado como ' + userEmail : 'No conectado'}</span>
          ${isAuth ? '<button class=\'btn btn-secondary btn-sm\' onclick=\'Drive.desconectar()\'>Desconectar</button>' : ''}
        </div>

        <div class="form-group">
          <label class="form-label">Client ID</label>
          <input id="drive-client-id" class="form-input" placeholder="154717978042-xxxx.apps.googleusercontent.com" value="${clientId}" style="font-size:12px;font-family:var(--mono)">
        </div>

        <div class="form-group">
          <label class="form-label">Client Secret</label>
          <input id="drive-client-secret" type="password" class="form-input" placeholder="GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx" value="${clientSecret}" style="font-size:12px;font-family:var(--mono)">
          <div style="font-size:11px;color:var(--text3);margin-top:4px">El Client Secret lo encuentras en Google Cloud Console → Credenciales → tu app → Secretos del cliente</div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="
            localStorage.setItem('drive_client_id',     document.getElementById('drive-client-id').value.trim());
            localStorage.setItem('drive_client_secret', document.getElementById('drive-client-secret').value.trim());
            Toast.show('Credenciales guardadas ✓', 'success');
          ">💾 Guardar credenciales</button>

          <button class="btn btn-primary btn-sm" onclick="
            var cid = document.getElementById('drive-client-id').value.trim();
            var cs  = document.getElementById('drive-client-secret').value.trim();
            if(!cid){ Toast.show('Introduce el Client ID primero','error'); return; }
            if(!cs){  Toast.show('Introduce el Client Secret primero','error'); return; }
            localStorage.setItem('drive_client_id', cid);
            localStorage.setItem('drive_client_secret', cs);
            if(typeof DriveDB !== 'undefined'){ DriveDB.CLIENT_ID=cid; DriveDB.CLIENT_SECRET=cs; DriveDB.login(); }
            else { Toast.show('Recarga la app y vuelve a intentarlo','error'); }
          ">🔗 Conectar con Google</button>
        </div>

        <details>
          <summary style="font-size:12px;color:var(--cyan);cursor:pointer;font-family:var(--font-cond);letter-spacing:.05em;text-transform:uppercase">▸ Configuración en Google Cloud Console</summary>
          <div style="margin-top:8px;padding:10px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--text2);line-height:1.8">
            1. <a href="https://console.cloud.google.com" target="_blank" style="color:var(--cyan)">console.cloud.google.com</a> → Credenciales<br>
            2. Tipo: <strong style="color:var(--white)">Aplicación web</strong><br>
            3. Origen JS autorizado: <code style="color:var(--yellow-corp)">http://127.0.0.1:4242</code><br>
            4. URI redireccionamiento: <code style="color:var(--yellow-corp)">http://127.0.0.1:3737</code><br>
            5. Habilitar APIs: Drive API + Gmail API
          </div>
        </details>
      </div>
    `;
  }
};

/* ═══════════════════════════════════════════════
   PERFIL DEL ESTUDIO — Configuración global
   ═══════════════════════════════════════════════ */
const Estudio = {
  data: {},

  load() {
    try { this.data = JSON.parse(localStorage.getItem('estudio_perfil') || '{}'); } catch { this.data = {}; }
    window.studioPerfil = this.data;
    return this.data;
  },

  save() {
    const d = {
      nombre: document.getElementById('est-nombre')?.value?.trim() || 'Antalavera Arquitectura',
      cif: document.getElementById('est-cif')?.value?.trim() || '',
      direccion: document.getElementById('est-dir')?.value?.trim() || '',
      telefono: document.getElementById('est-tel')?.value?.trim() || '',
      email: document.getElementById('est-email')?.value?.trim() || '',
      web: document.getElementById('est-web')?.value?.trim() || '',
      firmante: document.getElementById('est-firmante')?.value?.trim() || '',
      rol: document.getElementById('est-rol')?.value?.trim() || '',
      nif: document.getElementById('est-nif')?.value?.trim() || '',
      colegio: document.getElementById('est-colegio')?.value?.trim() || '',
      numColegiado: document.getElementById('est-num')?.value?.trim() || '',
    };
    if (this.data.logo) d.logo = this.data.logo;
    localStorage.setItem('estudio_perfil', JSON.stringify(d));
    this.data = d;
    window.studioPerfil = d;
    Toast.show('Perfil del estudio guardado ✓', 'success');
  },

  async loadLogo(event) {
    const file = event.target.files[0];
    if (!file) return;
    const dataUrl = await App.fileToDataUrl(file);
    this.data.logo = dataUrl;
    const prev = document.getElementById('logo-preview');
    if (prev) prev.innerHTML = `<img src="${dataUrl}" style="max-height:60px;max-width:200px;object-fit:contain">`;
    Toast.show('Logo cargado');
  },

  guardarDrive() {
    const id = (document.getElementById('drive-client-id')?.value || '').trim();
    const sc = (document.getElementById('drive-client-secret')?.value || '').trim();
    if (id) localStorage.setItem('drive_client_id', id);
    if (sc) localStorage.setItem('drive_client_secret', sc);
    if (typeof DriveDB !== 'undefined') { DriveDB.CLIENT_ID = id; DriveDB.CLIENT_SECRET = sc; }
    Toast.show('Credenciales guardadas', 'success');
  },

  conectarDrive() {
    const id = (document.getElementById('drive-client-id')?.value || '').trim();
    const sc = (document.getElementById('drive-client-secret')?.value || '').trim();
    if (!id) { Toast.show('Introduce el Client ID', 'error'); return; }
    if (!sc) { Toast.show('Introduce el Client Secret', 'error'); return; }
    localStorage.setItem('drive_client_id', id);
    localStorage.setItem('drive_client_secret', sc);
    if (typeof DriveDB !== 'undefined') {
      DriveDB.CLIENT_ID = id;
      DriveDB.CLIENT_SECRET = sc;
      DriveDB.login();
    } else {
      Toast.show('Error: recarga la app y vuelve a intentarlo', 'error');
    }
  },

  desconectarDrive() {
    ['drive_token','drive_token_ts','drive_user_email','drive_user_name'].forEach(k => localStorage.removeItem(k));
    if (typeof DriveDB !== 'undefined') { DriveDB.accessToken = null; }
    Toast.show('Desconectado de Google Drive');
    App.navigate('perfil');
  },

  render(container) {
    this.load();
    const d = this.data;
    container.innerHTML = `
      <div style="max-width:720px;margin:0 auto">
        <div class="card mb-3">
          <div class="section-title mb-3">🏛️ Datos del estudio</div>
          <div class="flex gap-3 mb-3">
            <div id="logo-preview" style="width:80px;height:80px;border:1px dashed var(--border2);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;background:var(--bg);flex-shrink:0">
              ${d.logo ? `<img src="${d.logo}" style="max-width:76px;max-height:76px;object-fit:contain">` : '<span style="font-size:11px;color:var(--text3)">Logo</span>'}
            </div>
            <div style="flex:1">
              <label class="btn btn-secondary btn-sm" style="cursor:pointer;margin-bottom:6px">
                📷 Subir logo del estudio
                <input type="file" accept="image/*" style="display:none" onchange="Estudio.loadLogo(event)">
              </label>
              <div class="text-muted text-sm">Aparecerá en informes PDF, firmas y exportaciones</div>
            </div>
          </div>
          <div class="form-grid">
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">Nombre del estudio *</label>
              <input id="est-nombre" class="form-input" value="${d.nombre||''}" placeholder="Pérez Arquitectos S.L.P.">
            </div>
            <div class="form-group">
              <label class="form-label">CIF / NIF</label>
              <input id="est-cif" class="form-input" value="${d.cif||''}" placeholder="B12345678">
            </div>
            <div class="form-group">
              <label class="form-label">Teléfono</label>
              <input id="est-tel" class="form-input" value="${d.telefono||''}" placeholder="+34 91 123 45 67">
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">Dirección</label>
              <input id="est-dir" class="form-input" value="${d.direccion||''}" placeholder="Calle Gran Vía 28, 2ºA · 28013 Madrid">
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input id="est-email" class="form-input" value="${d.email||''}" placeholder="contacto@estudio.com">
            </div>
            <div class="form-group">
              <label class="form-label">Web</label>
              <input id="est-web" class="form-input" value="${d.web||''}" placeholder="www.estudio.com">
            </div>
          </div>
        </div>

        <div class="card mb-3">
          <div class="section-title mb-3">👤 Datos del arquitecto firmante</div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Nombre completo</label>
              <input id="est-firmante" class="form-input" value="${d.firmante||''}" placeholder="Dr. Arq. Juan García Pérez">
            </div>
            <div class="form-group">
              <label class="form-label">Cargo / titulación</label>
              <input id="est-rol" class="form-input" value="${d.rol||''}" placeholder="Arquitecto Director de Proyecto">
            </div>
            <div class="form-group">
              <label class="form-label">NIF</label>
              <input id="est-nif" class="form-input" value="${d.nif||''}" placeholder="12345678A">
            </div>
            <div class="form-group">
              <label class="form-label">Colegio de Arquitectos</label>
              <input id="est-colegio" class="form-input" value="${d.colegio||''}" placeholder="COAM — Madrid">
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">Nº de colegiado</label>
              <input id="est-num" class="form-input" value="${d.numColegiado||''}" placeholder="28-XXXXX">
            </div>
          </div>
        </div>

        <div class="card mb-3" id="drive-panel">
          <div class="section-title mb-3">☁️ Google Drive</div>
          <div style="background:var(--surface2);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--text2);border-left:3px solid var(--cyan)">
            PC y Android compartirán los mismos datos en Drive automáticamente.
          </div>
          <div class="form-group">
            <label class="form-label">Client ID</label>
            <input id="drive-client-id" class="form-input" 
              placeholder="154717978042-xxxx.apps.googleusercontent.com" 
              value="${localStorage.getItem('drive_client_id')||''}" 
              style="font-size:13px;font-family:var(--mono)">
          </div>
          <div class="form-group">
            <label class="form-label">Client Secret</label>
            <input id="drive-client-secret" type="password" class="form-input" 
              placeholder="GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx" 
              value="${localStorage.getItem('drive_client_secret')||''}" 
              style="font-size:13px;font-family:var(--mono)">
            <div style="font-size:11px;color:var(--text3);margin-top:4px">
              Google Cloud Console → Credenciales → tu app → Secretos del cliente
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary" onclick="Estudio.guardarDrive()">💾 Guardar credenciales</button>
            <button class="btn btn-primary" onclick="Estudio.conectarDrive()">🔗 Conectar con Google</button>
            <button class="btn btn-ghost btn-sm" onclick="Estudio.desconectarDrive()">Desconectar</button>
          </div>
          <div id="drive-status-msg" style="margin-top:10px;font-size:12px;color:var(--green)"></div>
        </div>

        <div class="flex justify-between gap-2">
          <div></div>
          <button class="btn btn-primary btn-lg" onclick="Estudio.save()">💾 Guardar perfil del estudio</button>
        </div>
      </div>
    `;
  }
};
