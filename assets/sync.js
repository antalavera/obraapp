/* ═══════════════════════════════════════════════════════════════
   SYNC v3 — Estructura de archivo de obra en Google Drive

   Antalavera ObraApp/
   ├── PROYECTOS/
   │   └── [Nombre del Proyecto]/
   │       ├── PROYECTO.json            ← ficha del proyecto
   │       ├── CONTACTOS/
   │       │   └── [Rol] - [Nombre].json
   │       └── VISITAS Y REUNIONES/
   │           └── [Fecha] - [Título]/
   │               ├── ACTA.json        ← metadatos del evento
   │               ├── NOTAS.txt        ← notas e informe
   │               ├── TRANSCRIPCIONES.txt
   │               ├── FOTOS/
   │               │   ├── foto_001.jpg
   │               │   └── foto_001_GPS.txt
   │               ├── AUDIOS/
   │               │   └── audio_001.webm
   │               └── ARCHIVOS/
   │                   └── plano.dwg
   └── CONTACTOS_GENERALES/
       └── [Rol] - [Nombre].json
   ═══════════════════════════════════════════════════════════════ */

const Sync = {
  ROOT: 'Antalavera ObraApp',
  _rootId: null,
  _pushTimer: null,
  _deletedRegistry: null,  // tracks items deleted from app

  /* ── Registro de borrados ── */
  recordDeletion(type, id, drivePath) {
    const key = 'sync_deleted';
    const reg = JSON.parse(localStorage.getItem(key) || '[]');
    reg.push({ type, id, drivePath, ts: Date.now() });
    // Keep only last 500 entries
    if (reg.length > 500) reg.splice(0, reg.length - 500);
    localStorage.setItem(key, JSON.stringify(reg));
  },

  clearDeletion(id) {
    const key = 'sync_deleted';
    const reg = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify(reg.filter(r => r.id !== id)));
  },

  getDeletions() {
    return JSON.parse(localStorage.getItem('sync_deleted') || '[]');
  },
  _syncing: false,
  _folderCache: {},

  get token() { return localStorage.getItem('drive_token'); },
  get isConnected() {
    return !!(this.token && parseInt(localStorage.getItem('drive_token_ts')||0) > Date.now());
  },

  /* ─── API Drive ─── */
  async api(method, url, body) {
    const h = { Authorization: 'Bearer ' + this.token };
    const opts = { method, headers: h };
    if (body) { h['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    if (res.status === 401) throw new Error('Token expirado — reconecta Google Drive en Perfil del estudio');
    if (!res.ok) throw new Error('Drive ' + res.status + ': ' + (await res.text()).slice(0,120));
    return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
  },

  /* ─── Carpeta: buscar o crear (con caché) ─── */
  async folder(name, parentId) {
    const key = (parentId || 'root') + '/' + name;
    if (this._folderCache[key]) return this._folderCache[key];

    const q = `name='${name.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
            + (parentId ? ` and '${parentId}' in parents` : ` and 'root' in parents`);
    const res = await this.api('GET',
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);

    let id = res.files?.[0]?.id;
    if (!id) {
      const f = await this.api('POST', 'https://www.googleapis.com/drive/v3/files', {
        name, mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {})
      });
      id = f.id;
    }
    this._folderCache[key] = id;
    return id;
  },

  /* ─── Buscar archivo en carpeta ─── */
  async findFile(name, parentId) {
    const q = `name='${name.replace(/'/g,"\\'")}' and '${parentId}' in parents and trashed=false`;
    const res = await this.api('GET',
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
    return res.files?.[0]?.id || null;
  },

  /* ─── Subir texto ─── */
  async uploadText(name, text, parentId, existingId) {
    const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
    const meta = { name, ...(existingId ? {} : { parents: [parentId] }) };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', blob);
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`;
    const res = await fetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { Authorization: 'Bearer ' + this.token }, body: form
    });
    return res.json();
  },

  /* ─── Subir JSON ─── */
  async uploadJson(name, data, parentId, existingId) {
    return this.uploadText(name, JSON.stringify(data, null, 2), parentId, existingId);
  },

  /* ─── Subir binario ─── */
  async uploadBinary(name, dataUrl, parentId) {
    if (!dataUrl || !dataUrl.includes(',')) return null;
    const [header, b64] = dataUrl.split(',');
    const mime = header.split(':')[1]?.split(';')[0] || 'application/octet-stream';
    const bin  = atob(b64);
    const arr  = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name, parents: [parentId] })], { type: 'application/json' }));
    form.append('file', new Blob([arr], { type: mime }));
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      { method: 'POST', headers: { Authorization: 'Bearer ' + this.token }, body: form }
    );
    return res.json();
  },

  /* ═══════════════════════════════════════════════
     PUSH — Subir toda la estructura a Drive
     ═══════════════════════════════════════════════ */
  async push(onProgress) {
    if (!this.isConnected) throw new Error('No conectado a Google Drive');
    if (this._syncing) return;
    this._syncing = true;
    this._folderCache = {};

    try {
      /* Carpeta raíz */
      this._rootId = await this.folder(this.ROOT, null);
      onProgress?.('✓ Carpeta raíz en Drive');

      /* Leer toda la BD */
      const [events, projects, contacts, notes, mediaAll, audiosAll, filesAll] = await Promise.all([
        DB.getAll('events').catch(() => []),
        DB.getAll('projects').catch(() => []),
        DB.getAll('contacts').catch(() => []),
        DB.getAll('notes').catch(() => []),
        DB.getAll('media').catch(() => []),
        DB.getAll('audios').catch(() => []),
        DB.getAll('files').catch(() => []),
      ]);

      onProgress?.(`📊 ${events.length} eventos · ${projects.length} proyectos · ${contacts.length} contactos`);

      /* ── PROYECTOS ── */
      const proyectosFolder = await this.folder('PROYECTOS', this._rootId);

      /* Agrupar eventos por proyecto */
      const eventsByProject = {};
      events.forEach(ev => {
        const proj = ev.project || 'Sin proyecto';
        if (!eventsByProject[proj]) eventsByProject[proj] = [];
        eventsByProject[proj].push(ev);
      });

      /* Proyectos sin eventos */
      projects.forEach(p => {
        if (!eventsByProject[p.name]) eventsByProject[p.name] = [];
      });

      for (const [projName, projEvents] of Object.entries(eventsByProject)) {
        onProgress?.(`📁 Proyecto: ${projName}`);
        const projFolder = await this.folder(this.safeName(projName), proyectosFolder);

        /* Ficha del proyecto */
        const projData = projects.find(p => p.name === projName) || { name: projName };
        const fichaId  = await this.findFile('PROYECTO.json', projFolder);
        await this.uploadJson('PROYECTO.json', {
          ...projData,
          totalEventos: projEvents.length,
          actualizadoEn: new Date().toISOString()
        }, projFolder, fichaId);

        /* Contactos del proyecto */
        const projContacts = contacts.filter(c => c.project === projName);
        if (projContacts.length > 0) {
          const contactsFolder = await this.folder('CONTACTOS', projFolder);
          for (const c of projContacts) {
            const cName = this.safeName(`${c.role || 'Contacto'} - ${c.name}`);
            const cId   = await this.findFile(cName + '.json', contactsFolder);
            await this.uploadJson(cName + '.json', c, contactsFolder, cId);
          }
        }

        /* Eventos del proyecto */
        if (projEvents.length > 0) {
          const visitasFolder = await this.folder('VISITAS Y REUNIONES', projFolder);

          for (const ev of projEvents) {
            const evName   = this.safeName(`${ev.date || 'sin-fecha'} - ${ev.title || 'sin-titulo'}`);
            onProgress?.(`  📋 ${ev.title}`);
            const evFolder = await this.folder(evName, visitasFolder);

            /* ACTA.json — ficha del evento */
            const actaId = await this.findFile('ACTA.json', evFolder);
            await this.uploadJson('ACTA.json', {
              titulo:       ev.title,
              tipo:         ev.type === 'obra' ? 'Visita de Obra' : 'Reunión',
              fecha:        ev.date,
              hora:         ev.time,
              lugar:        ev.location,
              proyecto:     ev.project,
              participantes: ev.participants,
              descripcion:  ev.description,
              coordenadas:  ev.lat ? `${ev.lat}, ${ev.lng}` : null,
              creadoEn:     ev.createdAt,
            }, evFolder, actaId);

            /* NOTAS.txt */
            const evNotes = notes.filter(n => n.eventId === ev.id);
            if (evNotes.length > 0 && evNotes[0].content) {
              const notaId = await this.findFile('NOTAS.txt', evFolder);
              await this.uploadText('NOTAS.txt', evNotes.map(n => n.content).join('\n\n---\n\n'), evFolder, notaId);
            }

            /* TRANSCRIPCIONES.txt */
            const evAudios = audiosAll.filter(a => a.eventId === ev.id);
            const transTexts = evAudios.filter(a => a.transcript?.trim());
            if (transTexts.length > 0) {
              const transId = await this.findFile('TRANSCRIPCIONES.txt', evFolder);
              const txt = transTexts.map((a, i) =>
                `--- Audio ${i+1} (${new Date(a.createdAt||'').toLocaleString('es-ES')}) ---\n${a.transcript}`
              ).join('\n\n');
              await this.uploadText('TRANSCRIPCIONES.txt', txt, evFolder, transId);
            }

            /* FOTOS/ */
            const evMedia = mediaAll.filter(m => m.eventId === ev.id && m.dataUrl);
            if (evMedia.length > 0) {
              const fotosFolder = await this.folder('FOTOS', evFolder);
              for (let i = 0; i < evMedia.length; i++) {
                const m   = evMedia[i];
                if (m._driveId) continue; // ya subida
                const ext = m.type?.includes('video') ? 'webm' : 'jpg';
                const num = String(i+1).padStart(3, '0');
                const r   = await this.uploadBinary(`foto_${num}.${ext}`, m.dataUrl, fotosFolder);
                if (r?.id) {
                  await DB.put('media', { ...m, _driveId: r.id });
                  /* Archivo GPS junto a la foto */
                  if (m.lat) {
                    await this.uploadText(`foto_${num}_GPS.txt`,
                      `Latitud: ${m.lat}\nLongitud: ${m.lng}\nFecha: ${m.createdAt || ''}`,
                      fotosFolder, null);
                  }
                }
                onProgress?.(`    📷 foto ${i+1}/${evMedia.length}`);
              }
            }

            /* AUDIOS/ */
            if (evAudios.length > 0) {
              const audiosFolder = await this.folder('AUDIOS', evFolder);
              for (let i = 0; i < evAudios.length; i++) {
                const a = evAudios[i];
                if (a._driveId || !a.dataUrl) continue;
                const r = await this.uploadBinary(`audio_${String(i+1).padStart(3,'0')}.webm`, a.dataUrl, audiosFolder);
                if (r?.id) await DB.put('audios', { ...a, _driveId: r.id });
                onProgress?.(`    🎙️ audio ${i+1}/${evAudios.length}`);
              }
            }

            /* ARCHIVOS/ */
            const evFiles = filesAll.filter(f => f.eventId === ev.id && f.dataUrl && !f._isSig);
            if (evFiles.length > 0) {
              const archFolder = await this.folder('ARCHIVOS', evFolder);
              for (const f of evFiles) {
                if (f._driveId) continue;
                const r = await this.uploadBinary(f.name, f.dataUrl, archFolder);
                if (r?.id) await DB.put('files', { ...f, _driveId: r.id });
                onProgress?.(`    📎 ${f.name}`);
              }
            }

            /* FIRMA.png */
            const firma = filesAll.find(f => f.eventId === ev.id && f._isSig && f.dataUrl);
            if (firma && !firma._driveId) {
              const r = await this.uploadBinary('FIRMA.png', firma.dataUrl, evFolder);
              if (r?.id) await DB.put('files', { ...firma, _driveId: r.id });
            }
          }
        }
      }

      /* ── CONTACTOS GENERALES (sin proyecto) ── */
      const generalContacts = contacts.filter(c => !c.project);
      if (generalContacts.length > 0) {
        const cgFolder = await this.folder('CONTACTOS_GENERALES', this._rootId);
        for (const c of generalContacts) {
          const cName = this.safeName(`${c.role || 'Contacto'} - ${c.name}`);
          const cId   = await this.findFile(cName + '.json', cgFolder);
          await this.uploadJson(cName + '.json', c, cgFolder, cId);
        }
        onProgress?.(`✓ ${generalContacts.length} contactos generales`);
      }

      localStorage.setItem('sync_last_push', new Date().toISOString());
      this.setStatus('connected', localStorage.getItem('drive_user_email') || 'conectado');
      onProgress?.('✅ Sincronización completada');
      return true;

    } finally {
      this._syncing = false;
    }
  },

  /* ═══════════════════════════════════════════════
     PULL — Importar desde Drive a BD local
     ═══════════════════════════════════════════════ */
  async pull(onProgress) {
    if (!this.isConnected || this._syncing) return false;
    this._syncing = true;
    this._folderCache = {};

    try {
      this._rootId = await this.folder(this.ROOT, null);
      const proyectosFolder = await this.folder('PROYECTOS', this._rootId);

      onProgress?.('Leyendo proyectos desde Drive...');

      /* Listar subcarpetas de PROYECTOS */
      const q = `'${proyectosFolder}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const projList = await this.api('GET',
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);

      for (const projDriveFolder of (projList.files || [])) {
        onProgress?.(`  ← ${projDriveFolder.name}`);

        /* Leer ficha del proyecto */
        const fichaId = await this.findFile('PROYECTO.json', projDriveFolder.id);
        if (fichaId) {
          const fichaData = await this.downloadJson(fichaId);
          if (fichaData?.name && fichaData?.id) {
            // Respetar borrados locales - no reimportar lo que el usuario borró
            const deletions = this.getDeletions();
            const wasDeleted = deletions.some(d => d.id === fichaData.id);
            if (!wasDeleted) {
              const local = await DB.get('projects', fichaData.id).catch(() => null);
              if (!local) await DB.put('projects', fichaData).catch(() => {});
            }
          }
        }

        /* Leer eventos */
        const visitasId = await this.folder('VISITAS Y REUNIONES', projDriveFolder.id);
        const evQ = `'${visitasId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const evList = await this.api('GET',
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(evQ)}&fields=files(id,name)`);

        for (const evDriveFolder of (evList.files || [])) {
          const actaId = await this.findFile('ACTA.json', evDriveFolder.id);
          if (!actaId) continue;
          const acta = await this.downloadJson(actaId);
          if (!acta) continue;

          /* Buscar si ya existe localmente o fue borrado */
          const deletions = this.getDeletions();
          const allEvents  = await DB.getAll('events').catch(() => []);

          // Buscar por título + fecha + proyecto
          const exists = allEvents.find(e =>
            e.title === acta.titulo && e.date === acta.fecha && e.project === acta.proyecto
          );
          // Comprobar si fue borrado localmente (por título+fecha)
          const wasDeleted = deletions.some(d =>
            d.type === 'event' && d.drivePath === (acta.proyecto || '')
            && allEvents.every(e => !(e.title === acta.titulo && e.date === acta.fecha))
          );

          if (!exists && !wasDeleted) {
            await DB.put('events', {
              title:        acta.titulo,
              type:         acta.tipo === 'Visita de Obra' ? 'obra' : 'reunion',
              date:         acta.fecha,
              time:         acta.hora,
              location:     acta.lugar,
              project:      acta.proyecto,
              participants: acta.participantes || [],
              description:  acta.descripcion,
              lat:          acta.coordenadas ? parseFloat(acta.coordenadas.split(',')[0]) : null,
              lng:          acta.coordenadas ? parseFloat(acta.coordenadas.split(',')[1]) : null,
            }).catch(() => {});
            onProgress?.(`    ✓ Importado: ${acta.titulo}`);
          }
        }

        /* Leer contactos del proyecto */
        try {
          const contactsId = await this.findFile('CONTACTOS', projDriveFolder.id);
          if (contactsId) {
            const cQ = `'${contactsId}' in parents and trashed=false`;
            const cList = await this.api('GET',
              `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(cQ)}&fields=files(id,name)`);
            for (const cf of (cList.files || [])) {
              const cData = await this.downloadJson(cf.id);
              if (cData?.name) {
                const local = await DB.get('contacts', cData.id).catch(() => null);
                if (!local) await DB.put('contacts', cData).catch(() => {});
              }
            }
          }
        } catch {}
      }

      /* Contactos generales */
      try {
        const cgFolder = await this.findFile('CONTACTOS_GENERALES', this._rootId);
        if (cgFolder) {
          const cgQ = `'${cgFolder}' in parents and trashed=false`;
          const cgList = await this.api('GET',
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(cgQ)}&fields=files(id,name)`);
          for (const cf of (cgList.files || [])) {
            const cData = await this.downloadJson(cf.id);
            if (cData?.name) {
              const local = await DB.get('contacts', cData.id).catch(() => null);
              if (!local) await DB.put('contacts', cData).catch(() => {});
            }
          }
        }
      } catch {}

      localStorage.setItem('sync_last_pull', new Date().toISOString());
      onProgress?.('✅ Datos importados desde Drive');
      return true;

    } finally {
      this._syncing = false;
    }
  },

  /* ─── Descargar JSON desde Drive ─── */
  async downloadJson(fileId) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: 'Bearer ' + this.token } }
      );
      return res.ok ? res.json() : null;
    } catch { return null; }
  },

  /* ─── Nombre seguro para carpetas ─── */
  safeName(str) {
    return (str || 'sin-nombre')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  },

  /* ─── Push automático ─── */
  queuePush() {
    if (!this.isConnected) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => {
      this.push(() => {}).catch(e => console.warn('[Sync]', e.message));
    }, 5000);
  },

  /* ─── Sidebar status ─── */
  setStatus(state, msg) {
    const el = document.getElementById('drive-sidebar-status');
    if (!el) return;
    const colors = { connected:'rgba(41,182,200,.8)', syncing:'rgba(245,197,24,.8)', error:'rgba(239,68,68,.7)', disconnected:'rgba(255,255,255,.2)' };
    const icons  = { connected:'☁️', syncing:'🔄', error:'⚠️', disconnected:'☁️' };
    el.textContent = (icons[state]||'☁️') + ' ' + msg;
    el.style.color  = colors[state] || colors.disconnected;
  },

  /* ─── Init ─── */
  async init() {
    if (!this.isConnected) { this.setStatus('disconnected', 'Drive: no conectado'); return; }
    this.setStatus('connected', localStorage.getItem('drive_user_email') || 'conectado');

    // Solo push automático - el pull manual desde el botón en Perfil
    setTimeout(async () => {
      try {
        this.setStatus('syncing', 'Subiendo a Drive...');
        await this.push(() => {});
        this.setStatus('connected', localStorage.getItem('drive_user_email') || 'conectado');
      } catch(e) {
        this.setStatus('connected', localStorage.getItem('drive_user_email') || 'conectado');
      }
    }, 2000);

    const origPut = DB.put.bind(DB);
    DB.put = async (store, data) => {
      const r = await origPut(store, data);
      Sync.queuePush();
      return r;
    };
  }
};

window.addEventListener('DOMContentLoaded', () => { setTimeout(() => Sync.init(), 1000); });

window.__onDriveConnected = function(token, email) {
  localStorage.setItem('drive_token', token);
  localStorage.setItem('drive_user_email', email);
  Sync._folderCache = {};
  Sync._rootId = null;
  Sync.init();
  setTimeout(() => Sync.push(msg => console.log('[Sync]', msg)).catch(e => console.error('[Sync]', e)), 1500);
};
