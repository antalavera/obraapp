/* ═══════════════════════════════════════════════
   APP EXTENSION v2.0 — Integración módulos nuevos
   Firma digital, mapa, DXF viewer, Drive, Perfil
   ═══════════════════════════════════════════════ */

/* ─── app-ext.js ya no sobreescribe renderEventDetail ─── */
/* La implementación correcta está en app.js               */

/* ─── Override switchTab para mapa ─── */
/* switchTab ya está manejado en app.js - no sobreescribir aquí */

/* ─── Override buildFileItem para añadir visor DXF ─── */
const _origBuildFileItem = App._buildFileItem ? App._buildFileItem.bind(App) : null;
App._buildFileItem = function(f) {
  const div = _origBuildFileItem ? _origBuildFileItem(f) : document.createElement('div');
  const ext = (f.name||'').split('.').pop().toLowerCase();
  if (['dxf','dwg'].includes(ext)) {
    const actions = div.querySelector('.file-actions');
    if (actions) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn btn-primary btn-sm';
      viewBtn.textContent = '📐 Ver plano';
      viewBtn.onclick = () => DXFViewer.openViewerModal(f.id);
      actions.insertBefore(viewBtn, actions.firstChild);
    }
  }
  // Signature badge
  if (f._isSig) {
    div.style.borderLeft = '3px solid var(--green)';
    const info = div.querySelector('.file-info');
    if (info) {
      const badge = document.createElement('div');
      badge.style.cssText = 'font-size:11px;color:var(--green);margin-top:2px';
      badge.textContent = `✍️ Firma digital${f._sigMeta?.certInfo ? ' con certificado' : ''}`;
      info.appendChild(badge);
    }
  }
  return div;
};

/* ─── Override capturePhoto para añadir geolocalización ─── */
const _origCapturePhoto = App.capturePhoto ? App.capturePhoto.bind(App) : async function(){};
App.capturePhoto = async function() {
  const video = document.getElementById('camera-stream');
  const canvas = document.getElementById('cam-canvas');
  if (!video || !canvas) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

  // Intenta obtener coords en paralelo
  const geoPromise = Geo.getPhotoLocation();

  const mediaData = { eventId: this.currentEventId, dataUrl, type: 'image/jpeg', caption: '' };
  // Espera coords con timeout corto
  try {
    const pos = await Promise.race([geoPromise, new Promise(r => setTimeout(() => r(null), 3000))]);
    if (pos) { mediaData.lat = pos.lat; mediaData.lng = pos.lng; }
  } catch {}

  const m = await DB.put('media', mediaData);
  const grid = document.getElementById('media-grid');
  if (grid) {
    if (grid.querySelector('.empty-state')) grid.innerHTML = '';
    grid.appendChild(this.buildMediaItem(m));
  }
  // Flash
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:.8;z-index:9999;pointer-events:none;transition:opacity .3s';
  document.body.appendChild(flash);
  setTimeout(() => { flash.style.opacity='0'; setTimeout(()=>flash.remove(),300); }, 50);
  Toast.show(mediaData.lat ? '📷 Foto capturada con GPS ✓' : '📷 Foto capturada ✓', 'success');
};

/* ─── generateAndDownloadPDF: función global independiente ─── */
async function generateAndDownloadPDF(eventId) {
  if (!eventId) { Toast.show('Selecciona un evento', 'error'); return; }
  Toast.show('Generando PDF...');
  try {
    if (!window.jspdf) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar jsPDF'));
        document.head.appendChild(s);
      });
    }
    const { jsPDF } = window.jspdf;
    const ev      = await DB.get('events', eventId);
    const media   = await DB.getAll('media',   'eventId', eventId).catch(() => []);
    const audios  = await DB.getAll('audios',  'eventId', eventId).catch(() => []);
    const files   = await DB.getAll('files',   'eventId', eventId).catch(() => []);
    const notes   = await DB.getAll('notes',   'eventId', eventId).catch(() => []);
    const estudio = typeof Estudio !== 'undefined' ? Estudio.load() : {};
    const sigFiles     = files.filter(f => f._isSig);
    const regularFiles = files.filter(f => !f._isSig);
    const doc = new jsPDF();
    let y = 0;

    // Portada
    doc.setFillColor(30,31,33); doc.rect(0,0,210,297,'F');
    doc.setFillColor(41,182,200); doc.rect(0,0,6,297,'F');
    if (estudio.logo) { try { doc.addImage(estudio.logo,'PNG',14,14,36,18,undefined,'FAST'); } catch {} }
    doc.setTextColor(41,182,200); doc.setFontSize(10);
    doc.text(ev.type==='obra'?'INFORME DE VISITA DE OBRA':'ACTA DE REUNIÓN', 14, 62);
    doc.setTextColor(255,255,255); doc.setFontSize(20); doc.setFont(undefined,'bold');
    doc.text(doc.splitTextToSize(ev.title||'Sin título',175), 14, 74);
    doc.setFontSize(10); doc.setFont(undefined,'normal');
    let py = 108;
    const row = (l,v) => { if(!v) return; doc.setTextColor(92,99,112); doc.text(l,14,py); doc.setTextColor(200,210,220); doc.text(String(v),60,py); py+=7; };
    const ds = ev.date ? new Date(ev.date+'T00:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '—';
    row('Fecha:',ds); row('Hora:',ev.time||'—'); row('Lugar:',ev.location||'—');
    row('Proyecto:',ev.project||'—'); row('Asistentes:',(ev.participants||[]).join(', ')||'—');
    if (ev.lat) row('GPS:',ev.lat.toFixed(5)+', '+ev.lng.toFixed(5));
    doc.setFillColor(25,26,28); doc.rect(0,255,210,42,'F');
    doc.setTextColor(255,255,255); doc.setFontSize(11); doc.setFont(undefined,'bold');
    doc.text(estudio.nombre||'Antalavera Arquitectura',14,268);
    doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(120,130,140);
    if (estudio.firmante) doc.text(estudio.firmante+(estudio.rol?' · '+estudio.rol:''),14,276);
    if (estudio.email) doc.text([estudio.email,estudio.telefono].filter(Boolean).join(' · '),14,283);

    // Contenido
    doc.addPage(); y=20;
    const hdr = () => { doc.setFillColor(41,182,200); doc.rect(0,0,6,297,'F'); doc.setFontSize(7); doc.setTextColor(92,99,112); doc.text(ev.title||'',12,10); doc.text(new Date().toLocaleDateString('es-ES'),170,10); doc.line(12,13,198,13); y=20; };
    hdr();
    const chk = (n=25) => { if(y+n>278){doc.addPage();hdr();} };
    const sec = (t,r,g,b) => { chk(14); doc.setFillColor(r||41,g||182,b||200); doc.rect(12,y-3,186,8,'F'); doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); doc.setFontSize(8); doc.text(t,14,y+2); y+=11; doc.setFont(undefined,'normal'); doc.setFontSize(9.5); doc.setTextColor(30,41,59); };

    if (ev.description) { sec('DESCRIPCIÓN'); const ls=doc.splitTextToSize(ev.description,178); chk(ls.length*5+5); doc.text(ls,14,y); y+=ls.length*5+8; }
    const mn=notes.find(n=>n.content?.trim());
    if (mn) { sec('NOTAS E INFORME',30,100,160); const ls=doc.splitTextToSize(mn.content,178); chk(ls.length*5+5); doc.text(ls,14,y); y+=ls.length*5+8; }
    const trans=audios.filter(a=>a.transcript?.trim());
    if (trans.length) { sec('TRANSCRIPCIONES',200,120,20); trans.forEach((a,i)=>{ const ls=doc.splitTextToSize(a.transcript,175); chk(ls.length*5+12); doc.setFont(undefined,'bold'); doc.setFontSize(8); doc.text('Audio '+(i+1),14,y); y+=5; doc.setFont(undefined,'normal'); doc.setFontSize(9); doc.setFillColor(255,250,230); doc.rect(13,y-3,184,ls.length*5+4,'F'); doc.setTextColor(60,50,20); doc.text(ls,16,y); y+=ls.length*5+8; doc.setTextColor(30,41,59); }); }
    if (regularFiles.length) { sec('ARCHIVOS ADJUNTOS',14,120,180); regularFiles.forEach(f=>{chk(7);doc.text('• '+f.name,16,y);y+=6;}); y+=4; }
    const photos=media.filter(m=>!m.type?.includes('video')&&m.dataUrl?.startsWith('data:image'));
    if (photos.length) {
      sec('FOTOS',16,130,80); let col=0,px=14;
      for (const p of photos.slice(0,20)) {
        try { chk(62); doc.addImage(p.dataUrl,'JPEG',px,y,86,58); if(p.lat){doc.setFontSize(6);doc.setTextColor(100,110,120);doc.text('GPS:'+p.lat.toFixed(4)+','+p.lng.toFixed(4),px,y+60);} col++; if(col%2===0){px=14;y+=64;}else{px=106;} } catch{}
      }
      if(col%2!==0)y+=64;
    }
    const realSigFiles = sigFiles.filter(sf => sf.dataUrl && sf.dataUrl.length > 100);
    if (realSigFiles.length) { doc.addPage();hdr();sec('FIRMA DIGITAL',5,120,80); for(const sf of realSigFiles){try{doc.addImage(sf.dataUrl,'PNG',14,y,180,55,undefined,'FAST');y+=60;const m=sf._sigMeta||{};if(m.hashSHA256){doc.setFontSize(7);doc.setTextColor(100,116,139);doc.text('SHA-256: '+m.hashSHA256,14,y);y+=5;}}catch{}} }

    const total=doc.internal.getNumberOfPages();
    for(let i=1;i<=total;i++){doc.setPage(i);doc.setFontSize(6);doc.setTextColor(100,110,120);doc.text((estudio.nombre||'ObraApp')+' · '+(ev.title||'')+' · Pág.'+i+'/'+total,12,292);}

    const blob=doc.output('blob');
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=(ev.title||'evento').toLowerCase().replace(/[^a-z0-9]+/g,'-')+'_'+(ev.date||'sin-fecha')+'_informe.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    Toast.show('PDF descargado ✓','success');
  } catch(e) {
    console.error('PDF error:',e);
    Toast.show('Error PDF: '+e.message,'error');
  }
}

App.exportPDF = () => generateAndDownloadPDF(App.currentEventId);


/* ─── Override openExportModal — con firma previa recomendada ─── */
App.openExportModal = async function() {
  const eid = this.currentEventId;
  const ev  = await DB.get('events', eid);
  if (!ev) { Toast.show('Selecciona un evento primero', 'error'); return; }

  const files    = await DB.getAll('files', 'eventId', eid).catch(()=>[]);
  const hasSig   = files.some(f => f._isSig);
  const hasNotes = (await DB.getAll('notes', 'eventId', eid).catch(()=>[])).some(n => n.content?.trim());
  const hasMedia = (await DB.getAll('media', 'eventId', eid).catch(()=>[])).length > 0;

  const sigLabel = hasSig ? ' ✅ con firma digital' : ' (sin firma — puedes firmar primero)';

  const modal = this.createModal('📤 Exportar / Enviar evento', `
    ${hasSig
      ? `<div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:8px 14px;margin-bottom:12px;font-size:12px;color:#22c55e">✅ Evento firmado digitalmente</div>`
      : `<div style="background:rgba(245,197,24,.08);border:1px solid rgba(245,197,24,.25);border-radius:8px;padding:8px 14px;margin-bottom:12px;font-size:12px;color:var(--yellow-corp)">⚠️ Sin firma digital — el PDF se generará sin firma. Para firmarlo, usa el botón ✍️ Firmar dentro del evento.</div>`
    }
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="export-option" onclick="document.querySelector('.modal-backdrop')?.remove();App.exportPDF()">
        <div class="export-option-icon">📄</div>
        <div class="export-option-label">Generar PDF</div>
        <div class="export-option-sub">${sigLabel}</div>
      </div>
      <div class="export-option" onclick="document.querySelector('.modal-backdrop')?.remove();App.exportZIP()">
        <div class="export-option-icon">🗜️</div>
        <div class="export-option-label">Descargar ZIP</div>
        <div class="export-option-sub">Fotos, audios, notas y archivos</div>
      </div>
      <div class="export-option" onclick="document.querySelector('.modal-backdrop')?.remove();App.openEmailComposer()">
        <div class="export-option-icon">📧</div>
        <div class="export-option-label">Redactar email</div>
        <div class="export-option-sub">Elegir destinatarios y cuerpo</div>
      </div>
      <div class="export-option" onclick="document.querySelector('.modal-backdrop')?.remove();App.shareWhatsApp()">
        <div class="export-option-icon">💬</div>
        <div class="export-option-label">WhatsApp</div>
        <div class="export-option-sub">Resumen formateado</div>
      </div>
      <div class="export-option" onclick="document.querySelector('.modal-backdrop')?.remove();Sync&&Sync.push(m=>Toast.show(m)).catch(e=>Toast.show(e.message,'error'))">
        <div class="export-option-icon">☁️</div>
        <div class="export-option-label">Sync a Drive</div>
        <div class="export-option-sub">Subir a Google Drive ahora</div>
      </div>
      <div class="export-option" onclick="document.querySelector('.modal-backdrop')?.remove();App.shareNative&&App.shareNative()">
        <div class="export-option-icon">↗️</div>
        <div class="export-option-label">Compartir</div>
        <div class="export-option-sub">Cualquier app del dispositivo</div>
      </div>
    </div>
  `, 'modal-lg');
  document.body.appendChild(modal);
};

/* ─── Navigate override para perfil ─── */
const _origNavigate = App.navigate ? App.navigate.bind(App) : function(){};
App.navigate = function(view, param) {
  if (view === 'perfil') {
    this.currentView = 'perfil';
    document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === 'perfil'));
    document.getElementById('topbar-title').textContent = 'Perfil del estudio';
    document.getElementById('topbar-actions').innerHTML = '';
    Estudio.render(document.getElementById('main-content'));
    AppExt.updateSidebarEstudio();
    return;
  }
  if (this.currentTab === 'mapa') Geo.destroyMap();
  _origNavigate(view, param);
};

/* ─── AppExt namespace ─── */
const AppExt = {

  async syncToDrive(eventId) {
    document.querySelector('.modal-backdrop')?.remove();
    const modal = App.createModal('☁️ Sincronizando con Google Drive', `
      <div style="text-align:center;padding:20px">
        <div style="font-size:40px;margin-bottom:12px">☁️</div>
        <div id="sync-status" style="font-size:14px;color:var(--text2);margin-bottom:12px">Conectando...</div>
        <div class="progress-bar"><div class="progress-fill" id="sync-progress" style="width:5%"></div></div>
      </div>
    `, 'modal-sm');
    document.body.appendChild(modal);

    let pct = 5;
    const onProgress = (msg) => {
      const el = document.getElementById('sync-status');
      if (el) el.textContent = msg;
      pct = Math.min(pct + 15, 90);
      const bar = document.getElementById('sync-progress');
      if (bar) bar.style.width = pct + '%';
    };

    try {
      const url = await Drive.syncEvent(eventId, onProgress);
      const bar = document.getElementById('sync-progress');
      if (bar) bar.style.width = '100%';
      const el = document.getElementById('sync-status');
      if (el) el.innerHTML = `✅ Sincronizado correctamente<br><a href="${url}" target="_blank" style="color:var(--accent);font-size:13px">Abrir en Google Drive ↗</a>`;
      setTimeout(() => document.querySelector('.modal-backdrop')?.remove(), 3000);
      Toast.show('Evento sincronizado en Google Drive ✓', 'success');
      this.updateDriveSidebarStatus(true);
    } catch(e) {
      const el = document.getElementById('sync-status');
      if (el) el.innerHTML = `❌ ${e.message}`;
      Toast.show('Error de sincronización: ' + e.message, 'error');
    }
  },

  updateSidebarEstudio() {
    const d = Estudio.data;
    const el = document.getElementById('sidebar-estudio-name');
    if (el && d.nombre) el.textContent = d.nombre;
  },

  updateDriveSidebarStatus(connected) {
    const el = document.getElementById('drive-sidebar-status');
    if (el) el.style.color = connected ? 'rgba(16,185,129,.7)' : 'rgba(255,255,255,.3)';
    if (el) el.textContent = connected ? '☁️ Drive: conectado' : '☁️ Drive: no conectado';
  }
};

/* ─── Init extras ─── */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    Estudio.load();
    AppExt.updateSidebarEstudio();
    if (Drive.loadToken()) AppExt.updateDriveSidebarStatus(true);
  }, 500);
});
