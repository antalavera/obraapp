/* ═══════════════════════════════════════════════════════
   DRIVE-CORE.JS — Sincronización bidireccional robusta
   Versión única que reemplaza sync.js + drive-sync.js
   
   Modelo:
   - PC y Android pueden crear/modificar todo
   - Drive es el punto de sincronización
   - Gana siempre el dato con updatedAt más reciente
   - Config (credenciales, perfil) guardada en Drive
   - Sync automático al arrancar y al guardar
   ═══════════════════════════════════════════════════════ */

const DriveCore = {

  /* ── Estado ── */
  token:      null,
  email:      null,
  clientId:   null,
  clientSecret: null,
  rootId:     null,
  configId:   null,  // ID del archivo config.json en Drive
  _syncing:   false,
  _timer:     null,
  _folderCache: {},

  /* ── Constantes ── */
  ROOT:       'Antalavera ObraApp',
  CONFIG_FILE: 'APP_CONFIG.json',
  VERSION:    '1.0',

  /* ════════════════════════════════════════════
     ESTADO Y CONFIGURACIÓN
  ════════════════════════════════════════════ */

  get isConnected() {
    return !!(this.token && this.clientId && this.clientSecret);
  },

  loadConfig() {
    this.clientId     = localStorage.getItem('drive_client_id')     || '';
    this.clientSecret = localStorage.getItem('drive_client_secret') || '';
    this.token        = localStorage.getItem('drive_token')         || '';
    this.email        = localStorage.getItem('drive_user_email')    || '';
    return this.isConnected;
  },

  saveConfig() {
    localStorage.setItem('drive_client_id',     this.clientId     || '');
    localStorage.setItem('drive_client_secret', this.clientSecret || '');
    localStorage.setItem('drive_token',         this.token        || '');
    localStorage.setItem('drive_user_email',    this.email        || '');
  },

  setStatus(state, msg) {
    const el = document.getElementById('drive-sidebar-status');
    const icons = { connected:'☁️', syncing:'🔄', disconnected:'☁️', error:'⚠️' };
    if (el) {
      el.textContent = (icons[state] || '☁️') + ' ' + (msg || state);
      el.style.color = state === 'connected' ? 'rgba(41,182,200,.8)'
                     : state === 'syncing'   ? 'var(--yellow-corp)'
                     : state === 'error'     ? 'var(--red)'
                     : 'var(--text3)';
    }
  },

  /* ════════════════════════════════════════════
     API DE GOOGLE DRIVE
  ════════════════════════════════════════════ */

  async api(method, url, body) {
    const opts = {
      method,
      headers: { 'Authorization': 'Bearer ' + this.token }
    };
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body) {
      opts.body = body;
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      // Token expirado
      this.token = null;
      localStorage.removeItem('drive_token');
      this.setStatus('disconnected', 'Sesión expirada — reconecta Drive');
      throw new Error('TOKEN_EXPIRED');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Error ' + res.status);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return res.json();
    return res.text();
  },

  async folder(name, parentId) {
    const key = (parentId || 'root') + '/' + name;
    if (this._folderCache[key]) return this._folderCache[key];

    const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
            + (parentId ? ` and '${parentId}' in parents` : '');
    const res = await this.api('GET', `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    if (res.files && res.files.length) {
      this._folderCache[key] = res.files[0].id;
      return res.files[0].id;
    }
    const created = await this.api('POST', 'https://www.googleapis.com/drive/v3/files', {
      name, mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : []
    });
    this._folderCache[key] = created.id;
    return created.id;
  },

  async findFile(name, parentId) {
    const q = `name='${name}' and '${parentId}' in parents and trashed=false`;
    const res = await this.api('GET', `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    return res.files?.[0]?.id || null;
  },

  async uploadJson(name, data, parentId, existingId) {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const meta = { name, parents: existingId ? undefined : (parentId ? [parentId] : []) };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', blob);
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const method = existingId ? 'PATCH' : 'POST';
    return this.api(method, url, form);
  },

  async downloadJson(fileId) {
    const text = await this.api('GET', `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    try { return typeof text === 'string' ? JSON.parse(text) : text; }
    catch { return null; }
  },

  /* ════════════════════════════════════════════
     CONFIGURACIÓN EN DRIVE
     Guarda Client ID, Secret y perfil del estudio
     Para que Android los recupere automáticamente
  ════════════════════════════════════════════ */

  getDevice() {
    if (window.electronAPI?.isElectron) return 'pc';
    if (/Android/i.test(navigator.userAgent)) return 'android';
    return 'web';
  },

  getConfigFileName() {
    return 'APP_CONFIG_' + this.getDevice().toUpperCase() + '.json';
  },

  async pushConfig() {
    if (!this.isConnected) return;
    const rootId   = await this.ensureRoot();
    const device   = this.getDevice();
    const fileName = this.getConfigFileName();
    const estudio  = JSON.parse(localStorage.getItem('estudio_perfil') || '{}');
    const config   = {
      version:      this.VERSION,
      device,
      clientId:     this.clientId,
      clientSecret: this.clientSecret,
      estudio,
      transcripcionServicio: localStorage.getItem('transcripcion_servicio') || 'groq',
      transcripcionIdioma:   localStorage.getItem('transcripcion_idioma')   || 'auto',
      updatedAt:    new Date().toISOString(),
    };
    const existingId = await this.findFile(fileName, rootId);
    await this.uploadJson(fileName, config, rootId, existingId);
  },

  async pullConfig() {
    if (!this.isConnected) return false;
    try {
      const rootId   = await this.ensureRoot();
      const device   = this.getDevice();
      const fileName = this.getConfigFileName();

      // Primero intentar el config de este dispositivo
      let fileId = await this.findFile(fileName, rootId);

      // Si no existe, buscar el del otro dispositivo para copiar perfil del estudio
      if (!fileId) {
        const otherFile = device === 'pc' ? 'APP_CONFIG_ANDROID.json' : 'APP_CONFIG_PC.json';
        fileId = await this.findFile(otherFile, rootId);
      }

      if (!fileId) return false;
      const config = await this.downloadJson(fileId);
      if (!config) return false;

      // Restaurar credenciales SOLO si son del mismo dispositivo
      if (config.device === device || config.device === this.getDevice()) {
        if (config.clientId && !this.clientId) {
          this.clientId = config.clientId;
          localStorage.setItem('drive_client_id', config.clientId);
        }
        if (config.clientSecret && !this.clientSecret) {
          this.clientSecret = config.clientSecret;
          localStorage.setItem('drive_client_secret', config.clientSecret);
        }
        if (config.transcripcionServicio) localStorage.setItem('transcripcion_servicio', config.transcripcionServicio);
        if (config.transcripcionIdioma)   localStorage.setItem('transcripcion_idioma',   config.transcripcionIdioma);
      }

      // Restaurar perfil del estudio (compartido entre dispositivos)
      if (config.estudio && Object.keys(config.estudio).length) {
        const local = JSON.parse(localStorage.getItem('estudio_perfil') || '{}');
        if (!local.nombre) {
          localStorage.setItem('estudio_perfil', JSON.stringify(config.estudio));
        }
      }
      return true;
    } catch(e) {
      console.warn('[DriveCore] pullConfig error:', e.message);
      return false;
    }
  },

  /* ════════════════════════════════════════════
     SINCRONIZACIÓN BIDIRECCIONAL
  ════════════════════════════════════════════ */

  async ensureRoot() {
    if (this.rootId) return this.rootId;
    this.rootId = await this.folder(this.ROOT, null);
    return this.rootId;
  },

  /* Push: sube todos los datos locales a Drive */
  async push(onProgress) {
    if (!this.isConnected || this._syncing) return;
    this._syncing = true;
    this._folderCache = {};

    try {
      const rootId = await this.ensureRoot();
      onProgress?.('📁 Carpeta raíz OK');

      const [projects, events, contacts] = await Promise.all([
        DB.getAll('projects').catch(() => []),
        DB.getAll('events').catch(() => []),
        DB.getAll('contacts').catch(() => []),
      ]);

      // Subir configuración
      await this.pushConfig().catch(() => {});

      // Subir proyectos
      const proyFolder = await this.folder('PROYECTOS', rootId);
      for (const p of projects) {
        const pName = (p.nombre || p.name || p.id).replace(/[/\\:*?"<>|]/g, '_');
        const pFolder = await this.folder(pName, proyFolder);

        // Ficha del proyecto
        const fichaId = await this.findFile('PROYECTO.json', pFolder);
        await this.uploadJson('PROYECTO.json', p, pFolder, fichaId);

        // Eventos del proyecto
        const evFolder = await this.folder('EVENTOS', pFolder);
        const proyEvents = events.filter(e => e.projectId === p.id);

        for (const ev of proyEvents) {
          const evName = (ev.date || '') + '_' + (ev.title || ev.id).replace(/[/\\:*?"<>|]/g, '_');
          const evFolder2 = await this.folder(evName.slice(0, 50), evFolder);

          // Datos del evento
          const evFileId = await this.findFile('EVENTO.json', evFolder2);
          await this.uploadJson('EVENTO.json', ev, evFolder2, evFileId);

          // Notas
          const notes = await DB.getAll('notes', 'eventId', ev.id).catch(() => []);
          if (notes.length) {
            const notasId = await this.findFile('NOTAS.json', evFolder2);
            await this.uploadJson('NOTAS.json', notes, evFolder2, notasId);
          }
        }
        onProgress?.('  ✓ ' + pName);
      }

      // Subir contactos globales
      if (contacts.length) {
        const contFile = await this.findFile('CONTACTOS.json', rootId);
        await this.uploadJson('CONTACTOS.json', contacts, rootId, contFile);
      }

      localStorage.setItem('sync_last_push', new Date().toISOString());
      onProgress?.('✅ Subida completada');

    } finally {
      this._syncing = false;
    }
  },

  /* Pull: descarga de Drive lo que no tenemos o está más actualizado */
  async pull(onProgress) {
    if (!this.isConnected || this._syncing) return;
    this._syncing = true;
    this._folderCache = {};

    try {
      const rootId = await this.ensureRoot();

      // Recuperar config (credenciales + perfil)
      await this.pullConfig();

      // Leer proyectos de Drive
      const q = `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and name!='${this.CONFIG_FILE}'`;
      const res = await this.api('GET', `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
      const proyFolderId = res.files?.find(f => f.name === 'PROYECTOS')?.id;
      if (!proyFolderId) { onProgress?.('Sin proyectos en Drive'); return; }

      const proyRes = await this.api('GET',
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${proyFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name)`);

      const deletions = JSON.parse(localStorage.getItem('sync_deleted') || '[]');

      for (const pFolder of (proyRes.files || [])) {
        // Leer ficha proyecto
        const fichaId = await this.findFile('PROYECTO.json', pFolder.id);
        if (!fichaId) continue;
        const pData = await this.downloadJson(fichaId);
        if (!pData?.id) continue;

        // Saltar si fue borrado localmente
        if (deletions.some(d => d.id === pData.id)) continue;

        // Merge con local (gana más reciente)
        const local = await DB.get('projects', pData.id).catch(() => null);
        if (!local || new Date(pData.updatedAt) > new Date(local.updatedAt || 0)) {
          await DB.put('projects', pData).catch(() => {});
          onProgress?.('  ↓ Proyecto: ' + (pData.nombre || pData.name));
        }

        // Leer eventos
        const evFolderId = await this.findFile('EVENTOS', pFolder.id);
        if (!evFolderId) continue;

        const evFolders = await this.api('GET',
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${evFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name)`);

        for (const evFolder of (evFolders.files || [])) {
          const evFileId = await this.findFile('EVENTO.json', evFolder.id);
          if (!evFileId) continue;
          const evData = await this.downloadJson(evFileId);
          if (!evData?.id) continue;

          if (deletions.some(d => d.id === evData.id)) continue;

          const localEv = await DB.get('events', evData.id).catch(() => null);
          if (!localEv || new Date(evData.updatedAt) > new Date(localEv.updatedAt || 0)) {
            await DB.put('events', evData).catch(() => {});

            // Notas
            const notasId = await this.findFile('NOTAS.json', evFolder.id);
            if (notasId) {
              const notas = await this.downloadJson(notasId);
              if (Array.isArray(notas)) {
                for (const n of notas) {
                  const localN = await DB.get('notes', n.id).catch(() => null);
                  if (!localN || new Date(n.updatedAt) > new Date(localN.updatedAt || 0)) {
                    await DB.put('notes', n).catch(() => {});
                  }
                }
              }
            }
          }
        }
      }

      // Contactos globales
      const contFileId = await this.findFile('CONTACTOS.json', rootId);
      if (contFileId) {
        const contacts = await this.downloadJson(contFileId);
        if (Array.isArray(contacts)) {
          for (const c of contacts) {
            const local = await DB.get('contacts', c.id).catch(() => null);
            if (!local || new Date(c.updatedAt) > new Date(local.updatedAt || 0)) {
              await DB.put('contacts', c).catch(() => {});
            }
          }
        }
      }

      localStorage.setItem('sync_last_pull', new Date().toISOString());
      onProgress?.('✅ Descarga completada');

    } finally {
      this._syncing = false;
    }
  },

  /* Push automático con debounce al guardar cualquier dato */
  queuePush() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (this.isConnected) {
        this.push(() => {}).catch(e => console.warn('[DriveCore push]', e.message));
      }
    }, 5000); // 5 segundos después del último cambio
  },

  /* Registro de borrados para que pull no reimporte */
  recordDeletion(type, id) {
    const key = 'sync_deleted';
    const reg = JSON.parse(localStorage.getItem(key) || '[]');
    reg.push({ type, id, ts: Date.now() });
    if (reg.length > 500) reg.splice(0, reg.length - 500);
    localStorage.setItem(key, JSON.stringify(reg));
  },

  /* ════════════════════════════════════════════
     INICIALIZACIÓN
  ════════════════════════════════════════════ */

  async init() {
    this.loadConfig();
    // Re-read token in case OAuth completed after initial load
    const freshToken = localStorage.getItem('drive_token');
    if (freshToken && !this.token) {
      this.token = freshToken;
      this.email = localStorage.getItem('drive_user_email') || '';
    }
    if (!this.isConnected) {
      this.setStatus('disconnected', 'Drive: no conectado');
      return;
    }
    this.setStatus('connected', this.email || 'conectado');

    // Interceptar DB.put para push automático
    if (!DB._driveCoreHooked) {
      const origPut = DB.put.bind(DB);
      DB.put = async (store, data) => {
        const result = await origPut(store, data);
        DriveCore.queuePush();
        return result;
      };
      DB._driveCoreHooked = true;
    }

    // Pull al arrancar (solo en Android/web, no en PC)
    const isPC = !!(window.electronAPI?.isElectron);
    if (!isPC) {
      setTimeout(async () => {
        try {
          this.setStatus('syncing', 'Sincronizando...');
          await this.pull(() => {});
          this.setStatus('connected', this.email || 'conectado');
          if (typeof App !== 'undefined') App.navigate(App.currentView || 'dashboard');
        } catch(e) {
          this.setStatus('connected', this.email || 'conectado');
          console.warn('[DriveCore init pull]', e.message);
        }
      }, 2000);
    }
  },
};

/* ════════════════════════════════════════════
   ARRANQUE AUTOMÁTICO
════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => DriveCore.init(), 800);
});

/* Callback tras OAuth */
window.__onDriveConnected = function(token, email) {
  DriveCore.token        = token;
  DriveCore.email        = email;
  DriveCore.clientId     = localStorage.getItem('drive_client_id')     || DriveCore.clientId;
  DriveCore.clientSecret = localStorage.getItem('drive_client_secret') || DriveCore.clientSecret;
  DriveCore.saveConfig();
  DriveCore.setStatus('connected', email);
  // No llamar a init() otra vez para evitar pull automático en PC
  // Solo interceptar DB.put si no está ya hookeado
  if (!DB._driveCoreHooked) {
    const origPut = DB.put.bind(DB);
    DB.put = async (store, data) => {
      const result = await origPut(store, data);
      DriveCore.queuePush();
      return result;
    };
    DB._driveCoreHooked = true;
  }
  setTimeout(() => DriveCore.push(() => {}).catch(() => {}), 2000);
};

/* Exponer para compatibilidad con drive-fix.js */
window.Sync = {
  get isConnected()    { return DriveCore.isConnected; },
  push:                (cb) => DriveCore.push(cb),
  pull:                (cb) => DriveCore.pull(cb),
  queuePush:           ()   => DriveCore.queuePush(),
  recordDeletion:      (t,i) => DriveCore.recordDeletion(t,i),
  getDeletions:        ()   => JSON.parse(localStorage.getItem('sync_deleted') || '[]'),
};
