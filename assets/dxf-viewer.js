/* ═══════════════════════════════════════════════
   DXF VIEWER — Visor de planos CAD
   Parsea DXF (formato abierto de AutoCAD) y DWG
   con conversión automática via servidor gratuito
   ═══════════════════════════════════════════════ */
const DXFViewer = {
  canvas: null,
  ctx: null,
  entities: [],
  viewBox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  scale: 1,
  panX: 0,
  panY: 0,
  isDragging: false,
  lastX: 0,
  lastY: 0,
  layers: {},
  layerVisibility: {},
  colors: {
    0: '#ffffff', 1: '#ff0000', 2: '#ffff00', 3: '#00ff00',
    4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#ffffff',
    8: '#808080', 9: '#c0c0c0', 10: '#ff0000', 11: '#ffaaaa',
    30: '#ff8000', 40: '#ffff00', 50: '#00ff00', 140: '#00aaff',
    256: '#cccccc'
  },

  /* ─── Renderizar panel del visor ─── */
  renderViewer(containerId, fileId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `
      <div class="dxf-toolbar">
        <button class="btn btn-secondary btn-sm" onclick="DXFViewer.zoomIn()">🔍+</button>
        <button class="btn btn-secondary btn-sm" onclick="DXFViewer.zoomOut()">🔍−</button>
        <button class="btn btn-secondary btn-sm" onclick="DXFViewer.zoomFit()">⬜ Encuadrar</button>
        <button class="btn btn-secondary btn-sm" onclick="DXFViewer.resetView()">🏠 Inicio</button>
        <div style="flex:1"></div>
        <div id="dxf-coords" style="font-size:11px;color:var(--text3);font-family:var(--mono)">X: — Y: —</div>
        <div id="dxf-status" style="font-size:11px;color:var(--text3)">Cargando...</div>
      </div>
      <div style="position:relative;flex:1">
        <canvas id="dxf-canvas" style="width:100%;height:100%;cursor:crosshair;display:block;background:#1a1a2e"></canvas>
        <div id="dxf-layers" class="dxf-layers-panel"></div>
      </div>
    `;
    this.canvas = document.getElementById('dxf-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.setupInteraction();
    if (fileId) this.loadFile(fileId);
  },

  setupInteraction() {
    const c = this.canvas;
    // Resize
    const resize = () => {
      c.width = c.offsetWidth * devicePixelRatio;
      c.height = c.offsetHeight * devicePixelRatio;
      this.ctx.scale(devicePixelRatio, devicePixelRatio);
      this.render();
    };
    new ResizeObserver(resize).observe(c);
    resize();

    // Mouse/touch pan & zoom
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1/1.15;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.panX = mx - (mx - this.panX) * factor;
      this.panY = my - (my - this.panY) * factor;
      this.scale *= factor;
      this.render();
    }, { passive: false });

    c.addEventListener('mousedown', e => { this.isDragging = true; this.lastX = e.clientX; this.lastY = e.clientY; c.style.cursor = 'grabbing'; });
    c.addEventListener('mousemove', e => {
      if (this.isDragging) {
        this.panX += e.clientX - this.lastX;
        this.panY += e.clientY - this.lastY;
        this.lastX = e.clientX; this.lastY = e.clientY;
        this.render();
      }
      // Show coords
      const rect = c.getBoundingClientRect();
      const wx = (e.clientX - rect.left - this.panX) / this.scale;
      const wy = -(e.clientY - rect.top - this.panY) / this.scale + this.viewBox.maxY;
      const coordEl = document.getElementById('dxf-coords');
      if (coordEl) coordEl.textContent = `X: ${wx.toFixed(2)}  Y: ${wy.toFixed(2)}`;
    });
    c.addEventListener('mouseup', () => { this.isDragging = false; c.style.cursor = 'crosshair'; });
    c.addEventListener('mouseleave', () => { this.isDragging = false; c.style.cursor = 'crosshair'; });

    // Touch
    let lastDist = 0;
    c.addEventListener('touchstart', e => {
      if (e.touches.length === 1) { this.isDragging = true; this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY; }
      else if (e.touches.length === 2) { lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
    });
    c.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && this.isDragging) {
        this.panX += e.touches[0].clientX - this.lastX;
        this.panY += e.touches[0].clientY - this.lastY;
        this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY;
        this.render();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const factor = dist / lastDist;
        this.scale *= factor; lastDist = dist;
        this.render();
      }
    }, { passive: false });
    c.addEventListener('touchend', () => { this.isDragging = false; });
  },

  async loadFile(fileId) {
    const f = await DB.get('files', fileId);
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    document.getElementById('dxf-status').textContent = `Procesando ${f.name}...`;
    try {
      if (ext === 'dxf') {
        const text = atob(f.dataUrl.split(',')[1]);
        this.parseDXF(text);
      } else if (ext === 'dwg') {
        await this.handleDWG(f);
      } else {
        document.getElementById('dxf-status').textContent = 'Formato no soportado';
      }
    } catch(e) {
      document.getElementById('dxf-status').textContent = 'Error al cargar: ' + e.message;
    }
  },

  async handleDWG(file) {
    document.getElementById('dxf-status').textContent = '⚠️ DWG es propietario de Autodesk. Guarda como DXF desde AutoCAD (Archivo → Guardar como → DXF) para visualizar aquí.';
    document.getElementById('dxf-status').style.color = 'var(--amber)';
    // Show instructions overlay on canvas
    const c = this.canvas;
    const ctx = this.ctx;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 16px IBM Plex Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Archivo DWG detectado', c.offsetWidth/2, c.offsetHeight/2 - 50);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px IBM Plex Sans, sans-serif';
    ctx.fillText('Para visualizar el plano, expórtalo como DXF desde AutoCAD:', c.offsetWidth/2, c.offsetHeight/2 - 20);
    ctx.fillText('Archivo → Guardar como → AutoCAD DXF (*.dxf)', c.offsetWidth/2, c.offsetHeight/2 + 5);
    ctx.fillText('o usa la herramienta gratuita ODA File Converter', c.offsetWidth/2, c.offsetHeight/2 + 30);
  },

  /* ─── Parser DXF ─── */
  parseDXF(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim());
    this.entities = [];
    this.layers = {};

    let i = 0;
    const next = () => { const code = parseInt(lines[i++]); const val = lines[i++]; return { code, val }; };
    const peek = () => ({ code: parseInt(lines[i]), val: lines[i+1] });

    let section = '';
    let entity = null;
    let inEntities = false;
    let inBlock = false;

    while (i < lines.length - 1) {
      const { code, val } = next();
      if (code === 0) {
        if (entity) { this.addEntity(entity); entity = null; }
        if (val === 'SECTION') {
          const { val: sectionName } = next();
          section = sectionName;
          inEntities = section === 'ENTITIES';
          inBlock = false;
        } else if (val === 'ENDSEC') {
          section = ''; inEntities = false; inBlock = false;
        } else if (val === 'LAYER' && section === 'TABLES') {
          // Read layer definition
          let layerData = { name: '', color: 7 };
          while (peek().code !== 0) {
            const { code: lc, val: lv } = next();
            if (lc === 2) layerData.name = lv;
            if (lc === 62) layerData.color = parseInt(lv);
          }
          if (layerData.name) {
            this.layers[layerData.name] = layerData;
            this.layerVisibility[layerData.name] = true;
          }
        } else if (['LINE','ARC','CIRCLE','POLYLINE','LWPOLYLINE','ELLIPSE','TEXT','MTEXT','POINT','SPLINE','HATCH'].includes(val) && inEntities) {
          entity = { type: val, layer: '0', color: null, vertices: [] };
        } else if (val === 'VERTEX' && entity?.type === 'POLYLINE') {
          let vx = 0, vy = 0;
          while (peek().code !== 0) {
            const { code: vc, val: vv } = next();
            if (vc === 10) vx = parseFloat(vv);
            if (vc === 20) vy = parseFloat(vv);
          }
          entity.vertices.push([vx, vy]);
        } else if (val === 'BLOCK') { inBlock = true; inEntities = false; }
        else if (val === 'ENDBLK') { inBlock = false; if (section === 'BLOCKS') inEntities = false; }
        continue;
      }

      if (entity) {
        switch (code) {
          case 8:  entity.layer = val; break;
          case 62: entity.color = parseInt(val); break;
          case 10: entity.x = parseFloat(val); break;
          case 20: entity.y = parseFloat(val); break;
          case 11: entity.x2 = parseFloat(val); break;
          case 21: entity.y2 = parseFloat(val); break;
          case 40: entity.r = parseFloat(val); break; // radius / major axis
          case 41: entity.startAngle = parseFloat(val); break;
          case 42: entity.endAngle = parseFloat(val); break;
          case 50: if (entity.type === 'ARC') entity.startAngle = parseFloat(val) * Math.PI/180; break;
          case 51: if (entity.type === 'ARC') entity.endAngle = parseFloat(val) * Math.PI/180; break;
          case 1:  entity.text = val; break;
          case 70: entity.flags = parseInt(val); break;
          case 90: if (entity.type === 'LWPOLYLINE') entity.vertexCount = parseInt(val); break;
        }
        // LWPOLYLINE vertices stored inline with codes 10,20
        if (entity.type === 'LWPOLYLINE' && code === 10) { entity._lx = parseFloat(val); }
        if (entity.type === 'LWPOLYLINE' && code === 20 && entity._lx !== undefined) {
          entity.vertices.push([entity._lx, parseFloat(val)]);
          entity._lx = undefined;
        }
      }
    }
    if (entity) this.addEntity(entity);

    this.computeViewBox();
    this.zoomFit();
    this.renderLayersPanel();
    const count = this.entities.length;
    document.getElementById('dxf-status').textContent = `${count} entidades · ${Object.keys(this.layers).length} capas`;
  },

  addEntity(e) {
    if (e.type && (e.x !== undefined || e.vertices?.length > 0 || e.type === 'CIRCLE')) {
      this.entities.push(e);
    }
  },

  computeViewBox() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expand = (x, y) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    this.entities.forEach(e => {
      if (e.x !== undefined) { expand(e.x, e.y); }
      if (e.x2 !== undefined) { expand(e.x2, e.y2); }
      if (e.r !== undefined) { expand(e.x - e.r, e.y - e.r); expand(e.x + e.r, e.y + e.r); }
      e.vertices?.forEach(([vx, vy]) => expand(vx, vy));
    });
    if (isFinite(minX)) {
      const pad = Math.max(maxX - minX, maxY - minY) * 0.05;
      this.viewBox = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }
  },

  /* ─── Render ─── */
  render() {
    const c = this.canvas;
    const ctx = this.ctx;
    const w = c.offsetWidth, h = c.offsetHeight;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    this.entities.forEach(e => {
      if (!this.layerVisibility[e.layer] && e.layer !== '0' && this.layerVisibility[e.layer] !== undefined) return;
      const layerColor = this.layers[e.layer]?.color ?? 7;
      const colorIdx = e.color !== null && e.color !== undefined ? e.color : layerColor;
      const col = colorIdx === 256 ? (this.colors[layerColor] || '#fff') : (this.colors[colorIdx] || '#cccccc');
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 0.5 / this.scale;
      ctx.beginPath();

      switch (e.type) {
        case 'LINE':
          if (e.x !== undefined && e.x2 !== undefined) {
            ctx.moveTo(e.x, -e.y);
            ctx.lineTo(e.x2, -e.y2);
          }
          break;
        case 'CIRCLE':
          if (e.x !== undefined && e.r) {
            ctx.arc(e.x, -e.y, e.r, 0, Math.PI * 2);
          }
          break;
        case 'ARC':
          if (e.x !== undefined && e.r) {
            ctx.arc(e.x, -e.y, e.r, -e.endAngle, -e.startAngle, true);
          }
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE':
          if (e.vertices?.length > 1) {
            ctx.moveTo(e.vertices[0][0], -e.vertices[0][1]);
            for (let j = 1; j < e.vertices.length; j++) ctx.lineTo(e.vertices[j][0], -e.vertices[j][1]);
            if (e.flags & 1) ctx.closePath(); // closed
          }
          break;
        case 'POINT':
          if (e.x !== undefined) {
            const pr = 1.5 / this.scale;
            ctx.arc(e.x, -e.y, pr, 0, Math.PI*2);
            ctx.fill();
          }
          break;
        case 'TEXT':
        case 'MTEXT':
          if (e.text && e.x !== undefined) {
            const fs = Math.max(2, (e.r || 2.5));
            ctx.save();
            ctx.scale(1, -1);
            ctx.font = `${fs}px IBM Plex Mono, monospace`;
            ctx.fillText(e.text.replace(/\\P/g, ' ').replace(/\{[^}]*\}/g, ''), e.x, e.y);
            ctx.restore();
          }
          break;
      }
      ctx.stroke();
    });
    ctx.restore();
  },

  /* ─── Controls ─── */
  zoomIn()  { const c = this.canvas; this.scale *= 1.3; this.panX = c.offsetWidth/2 - (c.offsetWidth/2 - this.panX) * 1.3; this.panY = c.offsetHeight/2 - (c.offsetHeight/2 - this.panY) * 1.3; this.render(); },
  zoomOut() { const c = this.canvas; this.scale /= 1.3; this.panX = c.offsetWidth/2 - (c.offsetWidth/2 - this.panX) / 1.3; this.panY = c.offsetHeight/2 - (c.offsetHeight/2 - this.panY) / 1.3; this.render(); },

  zoomFit() {
    const c = this.canvas;
    if (!c) return;
    const vb = this.viewBox;
    const dxfW = vb.maxX - vb.minX;
    const dxfH = vb.maxY - vb.minY;
    if (dxfW === 0 || dxfH === 0) return;
    const cw = c.offsetWidth, ch = c.offsetHeight;
    this.scale = Math.min(cw / dxfW, ch / dxfH) * 0.92;
    this.panX = cw / 2 - (vb.minX + dxfW / 2) * this.scale;
    this.panY = ch / 2 + (-(-(vb.minY + dxfH / 2))) * this.scale;
    this.panY = ch / 2 - (-vb.minY - dxfH / 2) * this.scale;
    // Flip Y (DXF uses Y-up, canvas Y-down)
    this.panY = ch / 2 + (vb.minY + dxfH / 2) * this.scale;
    this.render();
  },

  resetView() { this.scale = 1; this.panX = 0; this.panY = 0; this.zoomFit(); },

  renderLayersPanel() {
    const panel = document.getElementById('dxf-layers');
    if (!panel) return;
    const names = Object.keys(this.layers);
    if (names.length === 0) return;
    panel.innerHTML = `
      <div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--text2);text-transform:uppercase;letter-spacing:.05em">Capas</div>
      ${names.map(name => {
        const layer = this.layers[name];
        const col = this.colors[layer.color] || '#fff';
        const vis = this.layerVisibility[name] !== false;
        return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer" onclick="DXFViewer.toggleLayer('${name.replace(/'/g,"\\'")}')">
          <div style="width:10px;height:10px;border-radius:2px;background:${col};flex-shrink:0;${!vis?'opacity:.3':''}"></div>
          <span style="${!vis?'opacity:.4;text-decoration:line-through':''};color:var(--text2);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${name}">${name}</span>
        </div>`;
      }).join('')}
    `;
  },

  toggleLayer(name) {
    this.layerVisibility[name] = !this.layerVisibility[name];
    this.renderLayersPanel();
    this.render();
  },

  /* Abrir visor completo en modal */
  async openViewerModal(fileId) {
    const f = await DB.get('files', fileId);
    if (!f) return;
    const modal = App.createModal(`📐 Visor CAD — ${f.name}`, `
      <div style="display:flex;flex-direction:column;height:70vh">
        <div class="dxf-toolbar" id="dxf-toolbar" style="display:flex;gap:6px;padding:8px;background:var(--sidebar);border-radius:var(--radius);margin-bottom:8px;flex-wrap:wrap"></div>
        <div style="flex:1;position:relative;overflow:hidden;border-radius:var(--radius)">
          <canvas id="dxf-canvas" style="width:100%;height:100%;cursor:crosshair;display:block;background:#0f1117"></canvas>
          <div id="dxf-layers" style="position:absolute;top:10px;right:10px;background:rgba(15,23,36,.92);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px;max-height:300px;overflow-y:auto;min-width:150px"></div>
        </div>
        <div style="display:flex;gap:12px;margin-top:8px;font-size:12px;color:var(--text3)">
          <span id="dxf-coords">X: — Y: —</span>
          <span id="dxf-status">Cargando...</span>
          <div style="flex:1"></div>
          <span>🖱️ Rueda: zoom &nbsp; Arrastrar: pan &nbsp; Pellizco: zoom táctil</span>
        </div>
      </div>
    `, 'modal-lg');
    document.body.appendChild(modal);

    // Toolbar buttons
    const toolbar = document.getElementById('dxf-toolbar');
    const btns = [
      ['🔍+','zoomIn'],['🔍−','zoomOut'],['⬜ Encuadrar','zoomFit'],['🏠 Inicio','resetView']
    ];
    btns.forEach(([label, fn]) => {
      const b = document.createElement('button');
      b.className = 'btn btn-sm';
      b.style.cssText = 'background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.15)';
      b.textContent = label;
      b.onclick = () => DXFViewer[fn]();
      toolbar.appendChild(b);
    });
    // Export PNG button
    const expBtn = document.createElement('button');
    expBtn.className = 'btn btn-sm';
    expBtn.style.cssText = 'background:var(--accent);color:#fff;margin-left:auto';
    expBtn.textContent = '⬇️ Exportar PNG';
    expBtn.onclick = () => {
      const link = document.createElement('a');
      link.download = f.name.replace(/\.[^.]+$/, '') + '.png';
      link.href = DXFViewer.canvas.toDataURL('image/png');
      link.click();
    };
    toolbar.appendChild(expBtn);

    this.canvas = document.getElementById('dxf-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.entities = [];
    this.layers = {};
    this.layerVisibility = {};
    this.scale = 1; this.panX = 0; this.panY = 0;
    this.setupInteraction();
    setTimeout(() => { this.canvas.width = this.canvas.offsetWidth; this.canvas.height = this.canvas.offsetHeight; this.loadFile(fileId); }, 100);
  }
};
