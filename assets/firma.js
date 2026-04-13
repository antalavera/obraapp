/* ═══════════════════════════════════════════════
   FIRMA DIGITAL — Módulo de firma
   • Firma manuscrita (canvas)
   • Firma con certificado digital (PKCS#12/.p12/.pfx)
     compatible con FNMT, Camerfirma, ANF, etc.
   • Incrustación en PDF (via pdf-lib)
   ═══════════════════════════════════════════════ */
const Firma = {
  canvas: null,
  ctx: null,
  isDrawing: false,
  hasSignature: false,
  stampData: null,   // logo/sello del estudio
  certInfo: null,    // info del certificado cargado
  privateKey: null,  // CryptoKey (WebCrypto)
  certPem: null,     // certificado público en PEM

  /* ─── Cargar librería PKCS12 si hace falta ─── */
  async loadPKILibs() {
    if (window.forge) return;
    await App.loadScript('https://cdnjs.cloudflare.com/ajax/libs/forge/1.3.1/forge.min.js');
  },

  /* ─── Modal principal de firma ─── */
  async openSignModal(eventId, documentTitle) {
    // PASO 1: Generar PDF del evento para previsualizarlo antes de firmar
    Toast.show('Generando documento para firmar...');
    const pdfBlob = await this._generateEventPDF(eventId);
    if (!pdfBlob) { Toast.show('Error al generar el documento', 'error'); return; }
    const pdfUrl  = URL.createObjectURL(pdfBlob);
    const ev      = await DB.get('events', eventId);
    const estudio = typeof Estudio !== 'undefined' ? Estudio.load() : {};

    // Store pdfUrl globally for onclick access
    window._firmaPdfUrl = pdfUrl;

    const modal = App.createModal('✍️ Firma digital del documento', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">

        <!-- Izquierda: PREVISUALIZACIÓN del PDF -->
        <div>
          <div class="section-title mb-2" style="color:var(--cyan)">📄 Documento a firmar</div>
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:8px">
            <iframe src="${pdfUrl}" style="width:100%;height:420px;border:none" title="Vista previa del documento"></iframe>
          </div>
          <div style="font-size:11px;color:var(--text3)">
            📋 <strong>${ev.title}</strong><br>
            ${ev.date ? '📅 ' + new Date(ev.date+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'}) : ''}
            ${ev.project ? ' · 🏗️ ' + ev.project : ''}
          </div>
          <button class="btn btn-secondary btn-sm" style="margin-top:8px;width:100%" onclick="Firma._openPdfPreview()">
            🔍 Abrir PDF completo en nueva ventana
          </button>
        </div>

        <!-- Derecha: FIRMA -->
        <div style="display:flex;flex-direction:column;gap:12px">

          <!-- Firma manuscrita -->
          <div>
            <div class="section-title mb-2">✍️ Firma manuscrita</div>
            <div style="position:relative;border:2px solid var(--border2);border-radius:8px;overflow:hidden;background:#fff;touch-action:none">
              <canvas id="sig-canvas" width="320" height="130" style="display:block;width:100%;cursor:crosshair"></canvas>
              <div style="position:absolute;bottom:6px;left:50%;transform:translateX(-50%);font-size:10px;color:#c0c0c0;pointer-events:none;white-space:nowrap">Firma aquí con el ratón o con el dedo</div>
            </div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-secondary btn-sm" onclick="Firma.clearCanvas()">🗑️ Borrar</button>
              <select id="sig-pen-color" class="form-select" style="width:auto;padding:5px 8px;font-size:12px" onchange="Firma.updatePen()">
                <option value="#1a3a6b">Azul marino</option>
                <option value="#1e293b">Azul oscuro</option>
                <option value="#000">Negro</option>
              </select>
            </div>
          </div>

          <!-- Certificado digital -->
          <div>
            <div class="section-title mb-2">🔐 Certificado digital (opcional)</div>
            <div id="cert-status" style="background:var(--bg);border:1px dashed var(--border2);border-radius:8px;padding:10px;text-align:center;font-size:12px;color:var(--text3);margin-bottom:8px">
              Sin certificado — la firma será solo manuscrita
            </div>
            <label class="btn btn-secondary btn-sm" style="cursor:pointer;width:100%;justify-content:center;margin-bottom:6px">
              📂 Cargar certificado (.p12 / .pfx)
              <input type="file" accept=".p12,.pfx,.pem" style="display:none" onchange="Firma.onCertFileChosen(event)">
            </label>
            <div id="cert-pwd-box" style="display:none;margin-bottom:6px">
              <div style="font-size:11px;color:var(--yellow-corp);margin-bottom:4px">🔒 Certificado protegido — introduce la contraseña:</div>
              <div style="display:flex;gap:6px">
                <input id="cert-password" type="password" class="form-input" placeholder="Contraseña..." style="font-size:13px;flex:1"
                  onkeydown="if(event.key==='Enter') Firma.submitCertPassword()">
                <button class="btn btn-ghost btn-icon" onclick="var i=document.getElementById('cert-password');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁️':'🙈'" title="Mostrar contraseña">👁️</button>
                <button class="btn btn-primary btn-sm" onclick="Firma.submitCertPassword()">✓</button>
              </div>
            </div>
          </div>

          <!-- Datos del firmante -->
          <div>
            <div class="section-title mb-2">👤 Firmante</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <input id="sig-name" class="form-input" placeholder="Nombre completo" value="${estudio.firmante||''}">
              <input id="sig-role" class="form-input" placeholder="Cargo / rol" value="${estudio.rol||'Arquitecto'}">
              <input id="sig-nif"  class="form-input" placeholder="NIF/NIE/CIF" value="${estudio.nif||''}">
              <input id="sig-date" type="date" class="form-input" value="${new Date().toISOString().slice(0,10)}">
            </div>
          </div>

        </div>
      </div>
    `, 'modal-xl');

    modal.querySelector('.modal-footer').innerHTML = `
      <div style="font-size:11px;color:var(--text3);margin-right:auto">
        Al firmar confirmas que has revisado el documento íntegro
      </div>
      <button class="btn btn-secondary" onclick="Firma._cancelSign()">Cancelar</button>
      <button class="btn btn-primary btn-lg" onclick="Firma.applySignature('${eventId}', window._firmaPdfUrl)">
        ✅ Firmar y guardar PDF
      </button>
    `;
    document.body.appendChild(modal);
    this.initCanvas();
  },

  initCanvas() {
    this.canvas = document.getElementById('sig-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.strokeStyle = '#1e293b';
    this.ctx.lineWidth = 2.2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.hasSignature = false;
    this.setupCanvasEvents();
  },

  setupCanvasEvents() {
    const c = this.canvas;
    const getPos = e => {
      const rect = c.getBoundingClientRect();
      const scaleX = c.width / rect.width;
      const scaleY = c.height / rect.height;
      if (e.touches) {
        return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
      }
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    };
    const start = e => { e.preventDefault(); this.isDrawing = true; const p = getPos(e); this.ctx.beginPath(); this.ctx.moveTo(p.x, p.y); };
    const move = e => { if (!this.isDrawing) return; e.preventDefault(); const p = getPos(e); this.ctx.lineTo(p.x, p.y); this.ctx.stroke(); this.hasSignature = true; this.syncPreviewCanvas(); };
    const end = () => { this.isDrawing = false; };
    c.addEventListener('mousedown', start); c.addEventListener('mousemove', move); c.addEventListener('mouseup', end); c.addEventListener('mouseleave', end);
    c.addEventListener('touchstart', start, { passive: false }); c.addEventListener('touchmove', move, { passive: false }); c.addEventListener('touchend', end);
  },

  syncPreviewCanvas() {
    const prev = document.getElementById('sig-preview-canvas');
    if (!prev || !this.canvas) return;
    const ctx = prev.getContext('2d');
    ctx.clearRect(0, 0, prev.width, prev.height);
    ctx.drawImage(this.canvas, 0, 0, prev.width, prev.height);
  },

  clearCanvas() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hasSignature = false;
    this.syncPreviewCanvas();
  },

  updatePen() {
    const col = document.getElementById('sig-pen-color')?.value || '#1e293b';
    if (this.ctx) this.ctx.strokeStyle = col;
  },

  /* Step 1: file chosen — try without password first */
  async onCertFileChosen(event) {
    const file = event.target.files[0];
    if (!file) return;
    this._pendingCertFile = file;
    const status = document.getElementById('cert-status');
    if (status) status.innerHTML = '<div style="color:var(--text3)">⏳ Leyendo certificado...</div>';
    // Try without password first
    const ok = await this.loadCertificate(null, '');
    if (!ok) {
      // Needs password — show password box
      const box = document.getElementById('cert-pwd-box');
      if (box) { box.style.display = 'block'; document.getElementById('cert-password')?.focus(); }
      if (status) status.innerHTML = '<div style="color:var(--yellow-corp)">🔒 Certificado protegido con contraseña</div>';
    }
  },

  async submitCertPassword() {
    const pwd = document.getElementById('cert-password')?.value || '';
    await this.loadCertificate(null, pwd);
  },

  async loadCertificate(event, forcePwd) {
    const file = event?.target?.files?.[0] || this._pendingCertFile;
    if (!file) return false;
    this._pendingCertFile = file;
    const pwd = forcePwd !== undefined ? forcePwd : (document.getElementById('cert-password')?.value || '');

    const certStatus = document.getElementById('cert-status');
    if (certStatus) certStatus.innerHTML = '<div style="color:var(--text3)">⏳ Cargando certificado...</div>';

    try {
      await this.loadPKILibs();
      const arrayBuffer = await file.arrayBuffer();
      const bytes  = new Uint8Array(arrayBuffer);
      let binary   = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const p12Der  = forge.util.createBuffer(binary, 'raw');
      const p12Asn1 = forge.asn1.fromDer(p12Der);

      let p12 = null;
      let ultimoError = null;
      // Solo intentar con la contraseña indicada (y su trim), no con ''.
      // Si pwd está vacío, probar sin contraseña también
      const intentos = pwd ? [pwd, pwd.trim()] : [''];
      for (const intento of intentos) {
        try { p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, intento); break; } catch(e1) {
          try { p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, true, intento); break; } catch(e2) { ultimoError = e2; }
        }
      }
      if (!p12) {
        if (certStatus) certStatus.innerHTML = '<div style="color:var(--yellow-corp)">🔒 Certificado protegido — introduce la contraseña</div>';
        return false;
      }

      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const certBag  = certBags[forge.pki.oids.certBag]?.[0];
      if (!certBag) throw new Error('No se encontró certificado en el archivo');
      const cert = certBag.cert;

      const getField = (id) => cert.subject.getField(id)?.value || '';
      this.certInfo = {
        cn:           getField('CN') || getField('2.5.4.3'),
        org:          getField('O')  || getField('2.5.4.10'),
        email:        getField('E')  || getField('emailAddress'),
        serialNumber: cert.serialNumber,
        validFrom:    new Date(cert.validity.notBefore).toLocaleDateString('es-ES'),
        validTo:      new Date(cert.validity.notAfter).toLocaleDateString('es-ES'),
        issuer:       cert.issuer.getField('O')?.value || cert.issuer.getField('CN')?.value || 'Desconocido',
        fingerprint:  forge.pki.getPublicKeyFingerprint(cert.publicKey, {encoding:'hex',delimiter:':'}).slice(0,29) + '...'
      };

      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
      const keyBag  = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
      if (keyBag) this._forgeKey = keyBag.key;

      // Ocultar caja de contraseña
      const pwdBox = document.getElementById('cert-pwd-box');
      if (pwdBox) pwdBox.style.display = 'none';

      // Mostrar info del certificado
      if (certStatus) certStatus.innerHTML = `
        <div style="text-align:left">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:20px">✅</span>
            <strong style="color:var(--green);font-family:var(--font-cond);font-size:15px">${this.certInfo.cn}</strong>
          </div>
          <div style="font-size:12px;color:var(--text2);display:grid;grid-template-columns:auto 1fr;gap:3px 10px">
            ${this.certInfo.org  ?`<span style="color:var(--text3)">Organización:</span><span>${this.certInfo.org}</span>`:''}
            ${this.certInfo.email?`<span style="color:var(--text3)">Email:</span><span>${this.certInfo.email}</span>`:''}
            <span style="color:var(--text3)">Emisor:</span><span>${this.certInfo.issuer}</span>
            <span style="color:var(--text3)">Válido hasta:</span>
            <span style="color:${new Date(cert.validity.notAfter)<new Date()?'var(--red)':'var(--green)'}">${this.certInfo.validTo}</span>
            <span style="color:var(--text3)">Nº serie:</span><span style="font-family:var(--mono);font-size:10px">${this.certInfo.serialNumber?.slice(0,24)}...</span>
          </div>
        </div>`;

      if (this.certInfo.cn) {
        const nameField = document.getElementById('sig-name');
        if (nameField && !nameField.value) nameField.value = this.certInfo.cn;
      }
      Toast.show('Certificado cargado ✓', 'success');
      this.updatePreview();
      return true;
    } catch(e) {
      if (certStatus) certStatus.innerHTML = `<div style="color:var(--red)">❌ Error: ${e.message}</div>`;
      Toast.show('Error al leer el certificado: ' + e.message, 'error');
      return false;
    }
  },

  async loadStamp(event) {
    const file = event.target.files[0];
    if (!file) return;
    this.stampData = await App.fileToDataUrl(file);
    const prev = document.getElementById('stamp-preview');
    const prevBlock = document.getElementById('stamp-preview-block');
    if (prev) prev.innerHTML = `<img src="${this.stampData}" style="max-height:44px;max-width:100%;object-fit:contain">`;
    if (prevBlock) prevBlock.innerHTML = `<img src="${this.stampData}" style="max-height:56px;max-width:60px;object-fit:contain">`;
  },

  updatePreview() {
    const name = document.getElementById('sig-name')?.value || '';
    const role = document.getElementById('sig-role')?.value || '';
    const nif = document.getElementById('sig-nif')?.value || '';
    const date = document.getElementById('sig-date')?.value || '';
    const dateStr = date ? new Date(date + 'T00:00:00').toLocaleDateString('es-ES') : '';

    document.getElementById('prev-name').textContent = name;
    document.getElementById('prev-role').textContent = role;
    document.getElementById('prev-nif').textContent = nif ? `NIF: ${nif}` : '';
    document.getElementById('prev-date').textContent = dateStr ? `Fecha: ${dateStr}` : '';
    document.getElementById('prev-cert').textContent = this.certInfo ? `🔐 Cert: ${this.certInfo.issuer}` : '';
    this.syncPreviewCanvas();
  },

  previewSignature() { this.updatePreview(); },

  /* ─── Aplicar firma y guardar en el evento ─── */
  _openPdfPreview() {
    const url = window._firmaPdfUrl;
    if (!url) { Toast.show('Sin PDF generado', 'error'); return; }
    // En Electron abre con shell, en web abre tab
    if (window.electronAPI) {
      // Crear un link de descarga temporal
      const a = document.createElement('a'); a.href = url;
      a.download = 'preview_documento.pdf';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } else {
      window.open(url, '_blank');
    }
  },

  _cancelSign() {
    if (window._firmaPdfUrl) {
      try { URL.revokeObjectURL(window._firmaPdfUrl); } catch {}
      window._firmaPdfUrl = null;
    }
    document.querySelector('.modal-backdrop')?.remove();
  },

  /* Genera el PDF del evento y devuelve un Blob (sin descargar) */
  async _generateEventPDF(eventId) {
    try {
      if (!window.jspdf) await App.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      const { jsPDF } = window.jspdf;
      const doc     = new jsPDF();
      const ev      = await DB.get('events', eventId);
      const media   = await DB.getAll('media',  'eventId', eventId);
      const audios  = await DB.getAll('audios',  'eventId', eventId);
      const files   = await DB.getAll('files',   'eventId', eventId);
      const notes   = await DB.getAll('notes',   'eventId', eventId);
      const estudio = typeof Estudio !== 'undefined' ? Estudio.load() : {};

      // Reutilizar la lógica de app-ext.js pero devolver blob
      // Portada
      doc.setFillColor(30, 31, 33); doc.rect(0,0,210,297,'F');
      doc.setFillColor(41,182,200); doc.rect(0,0,6,297,'F');
      if (estudio.logo) { try { doc.addImage(estudio.logo,'PNG',14,14,36,18,undefined,'FAST'); } catch {} }
      doc.setTextColor(41,182,200); doc.setFontSize(10);
      doc.text(ev.type==='obra'?'INFORME DE VISITA DE OBRA':'ACTA DE REUNIÓN', 14, 62);
      doc.setTextColor(255,255,255); doc.setFontSize(20); doc.setFont(undefined,'bold');
      doc.text(doc.splitTextToSize(ev.title||'Sin título',175), 14, 74);
      doc.setFontSize(10); doc.setFont(undefined,'normal'); doc.setTextColor(157,163,171);
      let py = 108;
      const row = (l,v) => { if(!v) return; doc.setTextColor(92,99,112); doc.text(l,14,py); doc.setTextColor(200,210,220); doc.text(String(v),60,py); py+=7; };
      row('Fecha:', ev.date?new Date(ev.date+'T00:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'—');
      row('Hora:', ev.time||'—'); row('Lugar:', ev.location||'—');
      row('Proyecto:', ev.project||'—');
      row('Asistentes:', (ev.participants||[]).join(', ')||'—');
      if (ev.lat) row('GPS:', `${ev.lat.toFixed(5)}, ${ev.lng.toFixed(5)}`);
      doc.setFillColor(25,26,28); doc.rect(0,255,210,42,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(11); doc.setFont(undefined,'bold');
      doc.text(estudio.nombre||'Estudio de Arquitectura', 14, 268);
      doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(120,130,140);
      if (estudio.firmante) doc.text(estudio.firmante+(estudio.rol?' · '+estudio.rol:''), 14, 276);
      if (estudio.email)    doc.text([estudio.email,estudio.telefono].filter(Boolean).join(' · '), 14, 283);

      // Página de contenido
      doc.addPage();
      let y = 20;
      const hdr = () => {
        doc.setFillColor(41,182,200); doc.rect(0,0,6,297,'F');
        doc.setFontSize(7); doc.setTextColor(92,99,112);
        doc.text(ev.title||'', 12, 10); doc.text(new Date().toLocaleDateString('es-ES'),170,10);
        doc.line(12,13,195,13); y = 20;
      };
      hdr();
      const chk = (n=25) => { if(y+n>278){doc.addPage();hdr();} };
      const sec = (t,r,g,b) => { chk(14); doc.setFillColor(r||41,g||182,b||200);
        doc.rect(12,y-3,183,8,'F'); doc.setTextColor(255,255,255);
        doc.setFont(undefined,'bold'); doc.setFontSize(8);
        doc.text(t,14,y+2); y+=11; doc.setFont(undefined,'normal');
        doc.setFontSize(9.5); doc.setTextColor(30,41,59); };

      if (ev.description) {
        sec('DESCRIPCIÓN / OBJETO');
        const ls = doc.splitTextToSize(ev.description,178); chk(ls.length*5+5);
        doc.setTextColor(50,60,80); doc.text(ls,14,y); y+=ls.length*5+8;
      }
      if (notes.length && notes[0]?.content?.trim()) {
        sec('NOTAS E INFORME',30,100,160);
        const ls = doc.splitTextToSize(notes[0].content,178); chk(ls.length*5+5);
        doc.setTextColor(50,60,80); doc.text(ls,14,y); y+=ls.length*5+8;
      }
      const trans = audios.filter(a=>a.transcript?.trim());
      if (trans.length) {
        sec('TRANSCRIPCIONES',200,120,20);
        trans.forEach((a,i) => {
          const ls=doc.splitTextToSize(a.transcript,175); chk(ls.length*5+12);
          doc.setFont(undefined,'bold'); doc.setFontSize(8);
          doc.text(`Audio ${i+1}`,14,y); y+=5;
          doc.setFont(undefined,'normal'); doc.setFontSize(9);
          doc.setFillColor(255,250,230); doc.rect(13,y-3,181,ls.length*5+4,'F');
          doc.setTextColor(60,50,20); doc.text(ls,16,y); y+=ls.length*5+8;
        });
      }
      const rFiles = files.filter(f=>!f._isSig);
      if (rFiles.length) {
        sec('ARCHIVOS ADJUNTOS',14,165,120);
        rFiles.forEach(f=>{ chk(7); doc.setTextColor(50,60,80); doc.text('• '+f.name,16,y); y+=6; });
        y+=4;
      }
      const photos = media.filter(m=>!m.type?.includes('video')&&m.dataUrl?.startsWith('data:image'));
      if (photos.length) {
        sec('REGISTRO FOTOGRÁFICO',16,130,80);
        let col=0,px=14;
        for (const p of photos.slice(0,20)) {
          try { chk(62); doc.addImage(p.dataUrl,'JPEG',px,y,86,58);
            if(p.lat){doc.setFontSize(6);doc.setTextColor(100,110,120);doc.text(`GPS:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`,px,y+60);}
            col++; if(col%2===0){px=14;y+=64;}else{px=106;} } catch{}
        }
        if (col%2!==0) y+=64;
      }

      // Pie de página
      const total = doc.internal.getNumberOfPages();
      for(let i=1;i<=total;i++){
        doc.setPage(i); doc.setFontSize(6); doc.setTextColor(100,110,120);
        doc.text(`${estudio.nombre||'ObraApp'} · ${ev.title} · Pág.${i}/${total} · ${new Date().toLocaleString('es-ES')}`,12,292);
      }

      return doc.output('blob');
    } catch(e) {
      console.error('_generateEventPDF:', e);
      return null;
    }
  },

  /* Aplica la firma al PDF y lo guarda */
  async applySignature(eventId, pdfUrl) {
    const name = document.getElementById('sig-name')?.value?.trim() || 'Sin nombre';
    const role = document.getElementById('sig-role')?.value?.trim() || '';
    const nif  = document.getElementById('sig-nif')?.value?.trim() || '';
    const date = document.getElementById('sig-date')?.value || new Date().toISOString().slice(0,10);

    // Generate signature block as PNG from canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = 480; offscreen.height = 160;
    const ctx = offscreen.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);

    // Border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, offscreen.width, offscreen.height);

    // Header bar
    ctx.fillStyle = '#f97316';
    ctx.fillRect(0, 0, offscreen.width, 4);

    // Signature image (left)
    if (this.hasSignature && this.canvas) {
      ctx.drawImage(this.canvas, 10, 14, 200, 90);
    }
    // Dividing line
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(220, 14); ctx.lineTo(220, 130); ctx.stroke();

    // Stamp (if any)
    if (this.stampData) {
      const img = new Image();
      img.src = this.stampData;
      await new Promise(r => { img.onload = r; img.onerror = r; });
      const maxH = 60, maxW = 60;
      const scale = Math.min(maxW/img.width, maxH/img.height);
      ctx.drawImage(img, 228, 14, img.width*scale, img.height*scale);
    }

    // Text
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 12px IBM Plex Sans, sans-serif';
    ctx.fillText(name, 300, 30);
    ctx.font = '11px IBM Plex Sans, sans-serif';
    ctx.fillStyle = '#475569';
    let ty = 46;
    if (role) { ctx.fillText(role, 300, ty); ty += 14; }
    if (nif)  { ctx.fillText(`NIF: ${nif}`, 300, ty); ty += 14; }
    ctx.fillText(`Fecha: ${new Date(date + 'T00:00:00').toLocaleDateString('es-ES')}`, 300, ty); ty += 14;
    if (this.certInfo) {
      ctx.fillStyle = '#059669';
      ctx.fillText(`🔐 ${this.certInfo.issuer}`, 228, ty); ty += 13;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px IBM Plex Mono, monospace';
      ctx.fillText(`SN: ${this.certInfo.serialNumber?.slice(0,24)}`, 228, ty);
    }

    // Line under signature
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(10, 110); ctx.lineTo(210, 110); ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px IBM Plex Sans, sans-serif';
    ctx.fillText('Firma', 10, 122);

    const sigDataUrl = offscreen.toDataURL('image/png');

    // Hash del documento con WebCrypto (para auditoría)
    let hashHex = '';
    try {
      const msgBuffer = new TextEncoder().encode(`${eventId}|${name}|${nif}|${date}|${Date.now()}`);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
    } catch {}

    // Si hay clave privada forge, firmar el hash
    let signatureHex = '';
    if (this._forgeKey && window.forge) {
      try {
        const md = forge.md.sha256.create();
        md.update(hashHex);
        const sig = this._forgeKey.sign(md);
        signatureHex = forge.util.bytesToHex(sig);
      } catch {}
    }

    // Guardar en DB
    const sigRecord = {
      eventId,
      firmante: name,
      rol: role,
      nif,
      fecha: date,
      sigDataUrl,
      hashSHA256: hashHex,
      signatureHex: signatureHex.slice(0, 64),
      certInfo: this.certInfo ? { cn: this.certInfo.cn, issuer: this.certInfo.issuer, validTo: this.certInfo.validTo } : null,
      createdAt: new Date().toISOString()
    };

    const existing = (await DB.getAll('files', 'eventId', eventId)).filter(f => f._isSig);
    for (const s of existing) await DB.delete('files', s.id);

    await DB.put('files', {
      eventId,
      name: `firma_${name.replace(/\s+/g,'_')}_${date}.png`,
      type: 'image/png',
      size: sigDataUrl.length,
      dataUrl: sigDataUrl,
      _isSig: true,
      _sigMeta: sigRecord
    });

    // Revocar URL del PDF provisional
    if (pdfUrl) try { URL.revokeObjectURL(pdfUrl); } catch {}
    document.querySelector('.modal-backdrop')?.remove();
    Toast.show('Documento firmado y guardado ✓', 'success');

    App.currentEventId = eventId;
    if (typeof AppExt !== 'undefined') await AppExt.loadTabFirma(eventId);
    if (App.currentTab === 'archivos') await App.loadTabArchivos(eventId);
    App.switchTab('firma');
  },

  /* ─── Ver firmas del evento ─── */
  async viewSignatures(eventId) {
    const files = (await DB.getAll('files', 'eventId', eventId)).filter(f => f._isSig);
    if (files.length === 0) { Toast.show('No hay firmas registradas en este evento'); return; }

    const modal = App.createModal('🔐 Firmas digitales del documento', files.map(f => {
      const m = f._sigMeta || {};
      return `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:12px">
          <img src="${f.dataUrl}" style="width:100%;max-height:120px;object-fit:contain;background:#fff;border-radius:6px;margin-bottom:10px">
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px">
            <span style="color:var(--text3)">Firmante:</span><strong>${m.firmante || '—'}</strong>
            <span style="color:var(--text3)">Rol:</span><span>${m.rol || '—'}</span>
            <span style="color:var(--text3)">NIF:</span><span>${m.nif || '—'}</span>
            <span style="color:var(--text3)">Fecha:</span><span>${m.fecha || '—'}</span>
            ${m.certInfo ? `<span style="color:var(--text3)">Certificado:</span><span style="color:var(--green)">🔐 ${m.certInfo.cn}</span>` : ''}
            ${m.hashSHA256 ? `<span style="color:var(--text3)">Hash SHA-256:</span><span style="font-family:monospace;font-size:10px">${m.hashSHA256.slice(0,32)}...</span>` : ''}
          </div>
        </div>
      `;
    }).join(''));
    document.body.appendChild(modal);
  }
};
