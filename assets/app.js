/* ═══════════════════════════════════════════════════════════════
   ANTALAVERA ARQUITECTURA — ObraApp v3
   Arquitectura centrada en PROYECTOS
   ═══════════════════════════════════════════════════════════════ */

const App = {
  currentView: 'dashboard',
  currentProjectId: null,
  currentEventId: null,
  currentTab: 'eventos',
  _participants: [],
  _eventType: 'obra',

  TIPOS_OBRA: ['Edificio residencial','Edificio plurifamiliar','Vivienda unifamiliar',
    'Reforma integral','Rehabilitación','Edificio de oficinas','Local comercial',
    'Industrial / nave','Equipamiento público','Urbanización','Otro'],

  ESTADOS: ['En redacción','Visado','En tramitación','Licencia obtenida',
    'En ejecución','Obra terminada','Paralizada','Archivada'],

  /* ─── INIT ─── */
  async init() {
    await DB.open();
    this.setupNav();
    this.navigate('dashboard');
    this.checkInstallPrompt();
  },

  setupNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.view));
    });
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
    });
  },

  navigate(view, param) {
    this.currentView = view;
    document.querySelectorAll('.nav-item[data-view]').forEach(el =>
      el.classList.toggle('active', el.dataset.view === view));
    const content = document.getElementById('main-content');
    const title   = document.getElementById('topbar-title');
    const actions = document.getElementById('topbar-actions');
    actions.innerHTML = '';
    if (typeof Geo !== 'undefined') Geo.destroyMap?.();
    switch(view) {
      case 'dashboard':      this.renderDashboard(content, title, actions); break;
      case 'projects':       this.renderProjects(content, title, actions); break;
      case 'project-new':    this.renderProjectForm(content, title, actions, null); break;
      case 'project-edit':   this.renderProjectForm(content, title, actions, param); break;
      case 'project-detail': this.renderProjectDetail(content, title, actions, param); break;
      case 'agents':         this.renderAgents(content, title, actions); break;
      case 'event-new':      this.renderEventNew(content, title, actions, param); break;
      case 'event-detail':   this.renderEventDetail(content, title, actions, param); break;
      case 'calendar':       this.renderCalendar(content, title, actions); break;
      case 'perfil':
        title.textContent = 'Perfil del estudio';
        if (typeof Estudio !== 'undefined') Estudio.render(content);
        break;
    }
  },

  /* ════════════════════════════════════════════
     DASHBOARD
  ════════════════════════════════════════════ */
  async renderDashboard(content, title, actions) {
    title.textContent = 'Panel de control';
    actions.innerHTML = `<button class="btn btn-primary" onclick="App.navigate('project-new')">＋ Nuevo proyecto</button>`;

    const [projects, events, agents] = await Promise.all([
      DB.getAll('projects').catch(()=>[]),
      DB.getAll('events').catch(()=>[]),
      DB.getAll('contacts').catch(()=>[]),
    ]);

    const today    = new Date();
    const todayStr = today.toISOString().slice(0,10);
    const in7days  = new Date(today.getTime() + 7*86400000).toISOString().slice(0,10);

    // ── Alertas ──
    const alertas = [];
    const nivelColor = {info:'var(--cyan)', aviso:'var(--yellow-corp)', peligro:'var(--red)', urgente:'#ff3b3b'};
    const nivelBg    = {info:'rgba(41,182,200,.08)', aviso:'rgba(245,197,24,.08)', peligro:'rgba(200,48,42,.08)', urgente:'rgba(255,59,59,.12)'};

    // Eventos hoy
    events.filter(e=>e.date===todayStr).forEach(e => alertas.push({
      nivel:'info', icon:'📅',
      titulo: e.title,
      sub: 'Hoy'+(e.time?' a las '+e.time:'')+' · '+(e.project||''),
      fn: ()=>{ App.currentEventId=e.id; App.currentProjectId=e.projectId; App.navigate('event-detail',e.id); }
    }));

    // Eventos próximos 7 días
    events.filter(e=>e.date>todayStr&&e.date<=in7days).forEach(e=>{
      const dias = Math.ceil((new Date(e.date+'T00:00:00')-today)/86400000);
      alertas.push({
        nivel:'aviso', icon:'🔔',
        titulo: e.title,
        sub: (dias===1?'Mañana':'En '+dias+' días')+' · '+e.date+' · '+(e.project||''),
        fn: ()=>{ App.currentEventId=e.id; App.currentProjectId=e.projectId; App.navigate('event-detail',e.id); }
      });
    });

    // Plazos fin de obra
    projects.filter(p=>p.fechaFin&&['En ejecución','En tramitación','Licencia obtenida'].includes(p.estado)).forEach(p=>{
      const dias = Math.ceil((new Date(p.fechaFin+'T00:00:00')-today)/86400000);
      if (dias<=30) alertas.push({
        nivel: dias<0?'urgente':dias<=7?'peligro':'aviso', icon: dias<0?'🚨':'⏰',
        titulo: (dias<0?'Plazo vencido':'Fin de obra próximo')+': '+(p.nombre||p.name||''),
        sub: dias<0?'Venció hace '+Math.abs(dias)+' días ('+p.fechaFin+')':'Faltan '+dias+' días · '+p.fechaFin,
        fn: ()=>App.navigate('project-detail',p.id)
      });
    });

    // Incidencias abiertas
    projects.forEach(p=>{
      const ab=(p.incidencias||[]).filter(i=>!i.cerrada);
      if (ab.length) alertas.push({
        nivel:'peligro', icon:'⚠️',
        titulo: ab.length+' incidencia'+(ab.length>1?'s':'')+' abierta'+(ab.length>1?'s':'')+': '+(p.nombre||p.name||''),
        sub: ab.map(i=>i.texto).join(' · ').slice(0,80),
        fn: ()=>{ App.currentTab='seguimiento'; App.navigate('project-detail',p.id); }
      });
    });

    // Sin actividad >30 días en obras activas
    projects.filter(p=>p.estado==='En ejecución').forEach(p=>{
      const evs=events.filter(e=>e.projectId===p.id);
      const last=evs.sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
      const hace30=new Date(today.getTime()-30*86400000).toISOString().slice(0,10);
      if (!last||last.date<hace30) alertas.push({
        nivel:'aviso', icon:'💤',
        titulo:'Sin actividad: '+(p.nombre||p.name||''),
        sub: last?'Última visita hace más de 30 días ('+last.date+')':'Sin visitas registradas',
        fn: ()=>App.navigate('project-detail',p.id)
      });
    });

    // ── Stats ──
    const nActivos = projects.filter(p=>['En ejecución','En tramitación','Licencia obtenida'].includes(p.estado)).length;
    const recent   = [...projects].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0)).slice(0,4);

    content.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card" onclick="App.navigate('projects')" style="cursor:pointer">
          <div class="stat-icon">🏗️</div><div class="stat-value">${projects.length}</div><div class="stat-label">Proyectos</div>
        </div>
        <div class="stat-card" style="border-left-color:var(--yellow-corp)">
          <div class="stat-icon">⚡</div><div class="stat-value">${nActivos}</div><div class="stat-label">Activos</div>
        </div>
        <div class="stat-card" onclick="App.navigate('calendar')" style="cursor:pointer;border-left-color:var(--green)">
          <div class="stat-icon">📅</div><div class="stat-value">${events.filter(e=>e.date===todayStr).length}</div><div class="stat-label">Eventos hoy</div>
        </div>
        <div class="stat-card" onclick="App.navigate('agents')" style="cursor:pointer;border-left-color:#8b5cf6">
          <div class="stat-icon">👥</div><div class="stat-value">${agents.length}</div><div class="stat-label">Agentes</div>
        </div>
      </div>
      <div id="alertas-section" style="margin-bottom:20px"></div>
      <div class="section-header mb-3">
        <div class="section-title">Proyectos recientes</div>
        <button class="btn btn-ghost btn-sm" onclick="App.navigate('projects')">Ver todos →</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px" id="dash-grid"></div>
      ${recent.length===0?`<div class="empty-state"><div class="empty-icon">🏗️</div><div class="empty-title">Sin proyectos todavía</div><button class="btn btn-primary btn-lg" onclick="App.navigate('project-new')">＋ Crear primer proyecto</button></div>`:''}
    `;

    // Alertas
    const sec = document.getElementById('alertas-section');
    if (sec) {
      if (alertas.length) {
        const hdr = document.createElement('div');
        hdr.className = 'section-header mb-2';
        hdr.innerHTML = `<div class="section-title" style="display:flex;align-items:center;gap:8px">🔔 Alertas <span style="background:var(--red);color:#fff;font-size:11px;padding:2px 8px;border-radius:10px">${alertas.length}</span></div>`;
        sec.appendChild(hdr);
        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:6px';
        const colors = {info:'var(--cyan)',aviso:'var(--yellow-corp)',peligro:'var(--red)',urgente:'#ff3b3b'};
        const bgs    = {info:'rgba(41,182,200,.08)',aviso:'rgba(245,197,24,.08)',peligro:'rgba(200,48,42,.08)',urgente:'rgba(255,59,59,.12)'};
        alertas.forEach(a=>{
          const d=document.createElement('div');
          const c=colors[a.nivel]||'var(--cyan)';
          const b=bgs[a.nivel]||'rgba(41,182,200,.08)';
          d.style.cssText=`display:flex;align-items:center;gap:12px;padding:10px 14px;background:${b};border:1px solid ${c}44;border-left:3px solid ${c};border-radius:8px;cursor:pointer`;
          d.onclick=a.fn;
          d.innerHTML=`<span style="font-size:20px;flex-shrink:0">${a.icon}</span><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:${c};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.titulo}</div><div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.sub}</div></div><span style="color:var(--text3)">›</span>`;
          list.appendChild(d);
        });
        sec.appendChild(list);
      } else {
        sec.innerHTML='<div style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);border-radius:10px;padding:12px 16px;display:flex;gap:10px;align-items:center"><span style="font-size:20px">✅</span><div style="font-size:13px;color:#22c55e">Todo al día — sin alertas pendientes</div></div>';
      }
    }

    // Botón activar notificaciones (si no están activas)
    if (typeof Notificaciones !== 'undefined' && !Notificaciones.activas) {
      const notifBanner = document.createElement('div');
      notifBanner.style.cssText = 'background:rgba(41,182,200,.08);border:1px solid rgba(41,182,200,.3);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;gap:12px;align-items:center';
      notifBanner.innerHTML = `
        <span style="font-size:22px">🔔</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--white)">Activa las notificaciones</div>
          <div style="font-size:11px;color:var(--text3)">Recibe avisos de eventos, plazos e incidencias en tu dispositivo</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="Notificaciones.solicitarPermiso()">Activar</button>
        <button class="btn btn-ghost btn-icon btn-sm" onclick="this.parentElement.remove()" style="color:var(--text3)">✕</button>
      `;
      const sec = document.getElementById('alertas-section');
      if (sec) sec.before(notifBanner);
    }

    // Grid proyectos
    const grid=document.getElementById('dash-grid');
    if (grid) {
      for (const p of recent) {
        const evCount=events.filter(e=>e.projectId===p.id).length;
        grid.appendChild(this._buildProjectCard(p,evCount));
      }
    }
  },

  async renderProjects(content, title, actions) {
    title.textContent = 'Proyectos';
    actions.innerHTML = `
      <input id="proj-search" class="form-input" style="width:180px" placeholder="🔍 Buscar..." oninput="App.filterProjects(this.value)">
      <select id="proj-estado-filter" class="form-select" style="width:auto" onchange="App.filterProjects()">
        <option value="">Todos los estados</option>
        ${this.ESTADOS.map(e=>`<option>${e}</option>`).join('')}
      </select>
      <button class="btn btn-primary" onclick="App.navigate('project-new')">＋ Nuevo proyecto</button>
    `;
    const [projects, events] = await Promise.all([
      DB.getAll('projects').catch(()=>[]),
      DB.getAll('events').catch(()=>[]),
    ]);
    this._allProjects = projects;
    this._allEvents   = events;
    content.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px" id="projects-grid"></div>
      ${projects.length===0?`<div class="empty-state"><div class="empty-icon">🏗️</div><div class="empty-title">Sin proyectos</div><button class="btn btn-primary" onclick="App.navigate('project-new')">＋ Crear proyecto</button></div>`:''}`;
    const grid = document.getElementById('projects-grid');
    [...projects].sort((a,b)=>(a.nombre||a.name||'').localeCompare(b.nombre||b.name||'')).forEach(p => {
      const card = this._buildProjectCard(p, events.filter(e=>e.projectId===p.id).length);
      grid.appendChild(card);
    });
    this._projectCards = Array.from(grid.children);
  },

  _buildProjectCard(p, evCount=0) {
    const div = document.createElement('div');
    div.className = 'card';
    const color = this._estadoColor(p.estado);
    div.style.cssText = `border-top:3px solid ${color};cursor:pointer`;
    div.onclick = () => this.navigate('project-detail', p.id);
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="font-family:var(--font-cond);font-size:17px;font-weight:800;color:var(--white);line-height:1.2;flex:1">${p.nombre||p.name||'Sin nombre'}</div>
        <span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:3px;white-space:nowrap;margin-left:8px;font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.05em;background:${color}22;color:${color};border:1px solid ${color}44">${p.estado||'—'}</span>
      </div>
      ${p.referencia?`<div style="font-family:var(--mono);font-size:11px;color:var(--cyan);margin-bottom:6px">${p.referencia}</div>`:''}
      <div style="font-size:12px;color:var(--text3);margin-bottom:10px">${[p.municipio,p.tipoObra].filter(Boolean).join(' · ')||'—'}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="chip chip-blue">${evCount} evento${evCount!==1?'s':''}</span>
        ${p.superficieTotal?`<span style="font-size:11px;color:var(--text3)">${p.superficieTotal} m²</span>`:''}
        <button style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:16px;padding:2px 6px" onclick="event.stopPropagation();App.navigate('project-edit','${p.id}')" title="Editar">✏️</button>
      </div>
    `;
    return div;
  },

  _estadoColor(estado) {
    return {'En ejecución':'#29b6c8','En tramitación':'#f5c518','Licencia obtenida':'#22c55e',
      'En redacción':'#60a5fa','Visado':'#a78bfa','Obra terminada':'#10b981',
      'Paralizada':'#ef4444','Archivada':'#5c6370'}[estado] || '#5c6370';
  },

  filterProjects(q) {
    const query  = (q||document.getElementById('proj-search')?.value||'').toLowerCase();
    const estado = document.getElementById('proj-estado-filter')?.value||'';
    this._projectCards?.forEach(card => {
      const txt = card.textContent.toLowerCase();
      card.style.display = (!query||txt.includes(query))&&(!estado||txt.includes(estado.toLowerCase())) ? '' : 'none';
    });
  },

  /* ════════════════════════════════════════════
     PROYECTO — formulario nuevo/editar
  ════════════════════════════════════════════ */
  async renderProjectForm(content, title, actions, projectId) {
    const isEdit = !!projectId;
    const p = isEdit ? (await DB.get('projects', projectId)||{}) : {};
    title.textContent = isEdit ? 'Editar proyecto' : 'Nuevo proyecto';
    actions.innerHTML = `<button class="btn btn-secondary" onclick="App.navigate(${isEdit?`'project-detail','${projectId}'`:"'projects'"})">← Volver</button>`;

    content.innerHTML = `
      <div style="max-width:800px;margin:0 auto">
        <div class="card mb-3">
          <div class="section-title mb-3">📋 Identificación</div>
          <div class="form-grid">
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">Nombre / denominación *</label>
              <input id="p-nombre" class="form-input" value="${p.nombre||''}" placeholder="Edificio de 12 viviendas en Calle Mayor">
            </div>
            <div class="form-group">
              <label class="form-label">Referencia / expediente</label>
              <input id="p-ref" class="form-input" value="${p.referencia||''}" placeholder="EXP-2025-001">
            </div>
            <div class="form-group">
              <label class="form-label">Estado</label>
              <select id="p-estado" class="form-select">
                ${this.ESTADOS.map(e=>`<option ${p.estado===e?'selected':''}>${e}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Tipo de obra</label>
              <select id="p-tipo" class="form-select">
                ${this.TIPOS_OBRA.map(t=>`<option ${p.tipoObra===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Uso</label>
              <input id="p-uso" class="form-input" value="${p.uso||''}" placeholder="Residencial, Terciario...">
            </div>
          </div>
        </div>

        <div class="card mb-3">
          <div class="section-title mb-3">📍 Localización</div>
          <div class="form-grid">
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">Dirección / emplazamiento</label>
              <input id="p-dir" class="form-input" value="${p.direccion||''}" placeholder="Calle Mayor 1, 41001 Sevilla">
            </div>
            <div class="form-group">
              <label class="form-label">Municipio</label>
              <input id="p-muni" class="form-input" value="${p.municipio||''}" placeholder="Sevilla">
            </div>
            <div class="form-group">
              <label class="form-label">Provincia</label>
              <input id="p-prov" class="form-input" value="${p.provincia||''}" placeholder="Sevilla">
            </div>
            <div class="form-group">
              <label class="form-label">Referencia catastral</label>
              <input id="p-catastro" class="form-input" value="${p.refCatastral||''}" placeholder="1234567AB1234A0001XY">
            </div>
            <div class="form-group">
              <label class="form-label">Nº de licencia</label>
              <input id="p-licencia" class="form-input" value="${p.licencia||''}" placeholder="LC-2025-1234">
            </div>
          </div>
        </div>

        <div class="card mb-3">
          <div class="section-title mb-3">📐 Datos técnicos</div>
          <div class="form-grid form-grid-3">
            <div class="form-group">
              <label class="form-label">Sup. construida (m²)</label>
              <input id="p-sup" type="number" class="form-input" value="${p.superficieTotal||''}">
            </div>
            <div class="form-group">
              <label class="form-label">Nº de plantas</label>
              <input id="p-plantas" type="number" class="form-input" value="${p.plantas||''}">
            </div>
            <div class="form-group">
              <label class="form-label">Nº de viviendas / uds.</label>
              <input id="p-uds" type="number" class="form-input" value="${p.unidades||''}">
            </div>
            <div class="form-group">
              <label class="form-label">PEM (€)</label>
              <input id="p-pem" type="number" class="form-input" value="${p.pem||''}" min="0" step="0.01" placeholder="0,00">
            </div>
            <div class="form-group">
              <label class="form-label">Fecha inicio obra</label>
              <input id="p-finicio" type="date" class="form-input" value="${p.fechaInicio||''}">
            </div>
            <div class="form-group">
              <label class="form-label">Fecha fin prevista</label>
              <input id="p-ffin" type="date" class="form-input" value="${p.fechaFin||''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Observaciones</label>
            <textarea id="p-obs" class="form-textarea" style="min-height:80px">${p.observaciones||''}</textarea>
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">🔗 Enlace carpeta de archivo (MEGA, Drive, OneDrive...)</label>
            <input id="p-archivo-url" class="form-input" value="${p.archivoUrl||''}" placeholder="https://mega.nz/folder/... o https://drive.google.com/...">
            <div style="font-size:11px;color:var(--text3);margin-top:4px">Enlace directo a la carpeta del proyecto completo en tu nube (planos, PDFs visados, etc.)</div>
          </div>
        </div>

        <div class="flex justify-between mt-3">
          ${isEdit?`<button class="btn btn-danger" onclick="App.deleteProject('${p.id}')">🗑️ Eliminar</button>`:'<div></div>'}
          <button class="btn btn-primary btn-lg" onclick="App.saveProject('${p.id||''}')">
            💾 ${isEdit?'Guardar cambios':'Crear proyecto'}
          </button>
        </div>
      </div>
    `;
  },

  async saveProject(id) {
    const nombre = document.getElementById('p-nombre')?.value?.trim();
    if (!nombre) { Toast.show('El nombre es obligatorio', 'error'); return; }
    const data = {
      nombre,
      name: nombre,  // backward compat
      referencia:     document.getElementById('p-ref')?.value?.trim()    ||'',
      estado:         document.getElementById('p-estado')?.value         ||'En redacción',
      tipoObra:       document.getElementById('p-tipo')?.value           ||'',
      uso:            document.getElementById('p-uso')?.value?.trim()    ||'',
      direccion:      document.getElementById('p-dir')?.value?.trim()    ||'',
      municipio:      document.getElementById('p-muni')?.value?.trim()   ||'',
      provincia:      document.getElementById('p-prov')?.value?.trim()   ||'',
      refCatastral:   document.getElementById('p-catastro')?.value?.trim()||'',
      licencia:       document.getElementById('p-licencia')?.value?.trim()||'',
      superficieTotal:document.getElementById('p-sup')?.value            ||'',
      plantas:        document.getElementById('p-plantas')?.value        ||'',
      unidades:       document.getElementById('p-uds')?.value            ||'',
      pem:            document.getElementById('p-pem')?.value            ||'',
      fechaInicio:    document.getElementById('p-finicio')?.value        ||'',
      fechaFin:       document.getElementById('p-ffin')?.value           ||'',
      observaciones:  document.getElementById('p-obs')?.value?.trim()   ||'',
      archivoUrl:     document.getElementById('p-archivo-url')?.value?.trim()||'',
    };
    if (id) data.id = id;
    const saved = await DB.put('projects', data);
    Toast.show(id?'Proyecto actualizado ✓':'Proyecto creado ✓', 'success');
    this.navigate('project-detail', saved.id);
  },

  async deleteProject(id) {
    if (!confirm('¿Eliminar este proyecto y todos sus eventos?')) return;

    // 1. Eliminar todos los eventos y sus datos
    const events = await DB.getAll('events').catch(()=>[]);
    for (const ev of events.filter(e=>e.projectId===id)) {
      for (const store of ['media','audios','files','notes']) {
        const items = await DB.getAll(store, 'eventId', ev.id).catch(()=>[]);
        for (const item of items) await DB.delete(store, item.id).catch(()=>{});
      }
      await DB.delete('events', ev.id).catch(()=>{});
    }

    // 2. Desasignar agentes de este proyecto
    const agents = await DB.getAll('contacts').catch(()=>[]);
    for (const a of agents.filter(a=>(a.projectIds||[]).includes(id))) {
      await DB.put('contacts', {...a, projectIds:(a.projectIds||[]).filter(pid=>pid!==id)}).catch(()=>{});
    }

    // 3. Registrar borrado para sync
    if (typeof Sync !== 'undefined') Sync.recordDeletion('project', id, null);

    // 4. Eliminar el proyecto
    await DB.delete('projects', id).catch(()=>{});
    Toast.show('Proyecto eliminado ✓');
    this.navigate('projects');
  },

  /* ════════════════════════════════════════════
     PROYECTO — detalle con pestañas
  ════════════════════════════════════════════ */
  async renderProjectDetail(content, title, actions, projectId) {
    if (!projectId) projectId = this.currentProjectId;
    this.currentProjectId = projectId;
    const p = await DB.get('projects', projectId);
    if (!p) { this.navigate('projects'); return; }

    title.textContent = p.nombre||p.name||'Proyecto';
    actions.innerHTML = `
      <button class="btn btn-secondary" onclick="App.navigate('projects')">← Proyectos</button>
      <button class="btn btn-secondary" onclick="App.navigate('project-edit','${p.id}')">✏️ Editar</button>
      <button class="btn btn-primary" onclick="App.navigate('event-new','${p.id}')">＋ Nuevo evento</button>
    `;

    const [events, allAgents] = await Promise.all([
      DB.getAll('events').catch(()=>[]),
      DB.getAll('contacts').catch(()=>[]),
    ]);
    const projEvents = events.filter(e=>e.projectId===projectId)
      .sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
    const projAgents = allAgents.filter(a=>(a.projectIds||[]).includes(projectId));
    const color = this._estadoColor(p.estado);

    content.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <div class="card mb-3" style="border-top:3px solid ${color}">
          <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
              ${p.referencia?`<div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:4px">${p.referencia}</div>`:''}
              <div style="font-family:var(--font-cond);font-size:22px;font-weight:800;color:var(--white)">${p.nombre||p.name}</div>
              <div style="font-size:13px;color:var(--text2);margin-top:4px">${[p.tipoObra,p.municipio,p.provincia].filter(Boolean).join(' · ')||'—'}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
              <span style="padding:5px 14px;border-radius:4px;font-family:var(--font-cond);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;background:${color}22;color:${color};border:1px solid ${color}44">${p.estado||'—'}</span>
              ${p.superficieTotal?`<span style="font-size:12px;color:var(--text3)">${parseFloat(p.superficieTotal).toLocaleString('es-ES')} m²</span>`:''}
              ${p.pem?`<span style="font-size:12px;color:var(--text3)">${App.formatEUR(p.pem)}</span>`:''}
            </div>
          </div>
          ${p.direccion?`<div style="margin-top:10px;font-size:13px;color:var(--text3)">📍 ${p.direccion}</div>`:''}
          ${p.archivoUrl?`<a href="${p.archivoUrl}" target="_blank" class="btn btn-ghost btn-sm" style="margin-top:8px;font-size:12px;text-decoration:none;display:inline-flex">📁 Abrir carpeta de archivo ↗</a>`:''}
          <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap;font-size:12px;color:var(--text3)">
            ${p.licencia?`<span>🏛️ Licencia: ${p.licencia}</span>`:''}
            ${p.refCatastral?`<span>📋 Catastro: ${p.refCatastral}</span>`:''}
            ${p.fechaInicio?`<span>📅 Inicio: ${new Date(p.fechaInicio+'T00:00:00').toLocaleDateString('es-ES')}</span>`:''}
            ${p.fechaFin?`<span>🏁 Fin: ${new Date(p.fechaFin+'T00:00:00').toLocaleDateString('es-ES')}</span>`:''}
          </div>
        </div>

        <div class="tabs-bar" style="overflow-x:auto;flex-wrap:nowrap">
          <button class="tab-btn ${this.currentTab==='eventos'?'active':''}" onclick="App.switchTab('eventos')">
            📋 Eventos <span class="badge-count" style="background:var(--cyan)">${projEvents.length}</span>
          </button>
          <button class="tab-btn ${this.currentTab==='agentes'?'active':''}" onclick="App.switchTab('agentes')">
            👥 Agentes <span class="badge-count" style="background:#8b5cf6">${projAgents.length}</span>
          </button>
          <button class="tab-btn ${this.currentTab==='seguimiento'?'active':''}" onclick="App.switchTab('seguimiento')">📊 Seguimiento</button>
          <button class="tab-btn ${this.currentTab==='economico'?'active':''}"   onclick="App.switchTab('economico')">💰 Económico</button>
          <button class="tab-btn ${this.currentTab==='documentos'?'active':''}"  onclick="App.switchTab('documentos')">📁 Documentación</button>
          <button class="tab-btn ${this.currentTab==='info'?'active':''}"        onclick="App.switchTab('info')">📐 Ficha técnica</button>
        </div>

        <div id="tab-eventos"     class="tab-content ${this.currentTab==='eventos'    ?'active':''}"></div>
        <div id="tab-agentes"     class="tab-content ${this.currentTab==='agentes'    ?'active':''}"></div>
        <div id="tab-seguimiento" class="tab-content ${this.currentTab==='seguimiento'?'active':''}"></div>
        <div id="tab-economico"   class="tab-content ${this.currentTab==='economico'  ?'active':''}"></div>
        <div id="tab-documentos"  class="tab-content ${this.currentTab==='documentos' ?'active':''}"></div>
        <div id="tab-info"        class="tab-content ${this.currentTab==='info'        ?'active':''}"></div>
      </div>
    `;

    this._renderProjEvents(projEvents, projectId);
    this._renderProjAgents(projAgents, allAgents, projectId);
    this._renderProjSeguimiento(p, projEvents);
    this._renderProjEconomico(p);
    this._renderProjDocumentos(p);
    this._renderProjInfo(p);
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
    document.querySelector(`.tab-btn[onclick*="'${tab}'"]`)?.classList.add('active');
    document.getElementById('tab-'+tab)?.classList.add('active');
    // Load on demand for heavy tabs
    if (tab === 'mapa'  && this.currentEventId) {
      if (typeof Geo !== 'undefined') Geo.renderMapTab(this.currentEventId);
    }
    if (tab === 'firma') {
      const eid = this.currentEventId;
      if (eid && typeof AppExt !== 'undefined') {
        AppExt.loadTabFirma(eid).catch(e => console.warn('loadTabFirma:', e));
      }
    }
  },

  _renderProjEvents(events, projectId) {
    const el = document.getElementById('tab-eventos'); if(!el) return;
    if (!events.length) {
      el.innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Sin eventos</div><div class="empty-sub">Crea la primera visita o reunión de este proyecto</div><button class="btn btn-primary" onclick="App.navigate('event-new','${projectId}')">＋ Nuevo evento</button></div>`;
      return;
    }
    el.innerHTML='<div class="event-list" id="proj-ev-list"></div>';
    const list = document.getElementById('proj-ev-list');
    events.forEach(ev => list.appendChild(this._buildEventRow(ev)));
  },

  _buildEventRow(ev) {
    const div  = document.createElement('div');
    div.className = 'event-card';
    const date = ev.date ? new Date(ev.date+'T00:00:00').toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) : '—';

    // Info section — click to open
    const info = document.createElement('div');
    info.style.cssText = 'display:flex;flex:1;align-items:center;gap:10px;cursor:pointer;min-width:0';
    info.innerHTML = `
      <div class="event-type-badge ${ev.type==='obra'?'badge-obra':'badge-reunion'}">${ev.type==='obra'?'🏗️':'🤝'}</div>
      <div class="event-info">
        <div class="event-title">${ev.title||'Sin título'}</div>
        <div class="event-meta"><span>📅 ${date}</span>${ev.time?`<span>⏰ ${ev.time}</span>`:''} ${ev.location?`<span>📍 ${ev.location}</span>`:''}</div>
        ${ev.participants?.length?`<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${ev.participants.map(p=>`<span class="chip chip-blue" style="font-size:10px">${p}</span>`).join('')}</div>`:''}
      </div>
    `;
    info.addEventListener('click', () => {
      this.currentEventId = ev.id;
      this.currentTab = 'fotos';
      this.navigate('event-detail', ev.id);
    });

    // Action buttons — separate from info, no propagation issues
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex-shrink:0';

    const mkBtn = (icon, title, fn) => {
      const b = document.createElement('button');
      b.className = 'btn btn-ghost btn-icon';
      b.title = title;
      b.textContent = icon;
      b.addEventListener('click', fn);
      return b;
    };

    actions.appendChild(mkBtn('✏️', 'Editar', () => this.openEditEvent(ev.id)));
    actions.appendChild(mkBtn('📋', 'Duplicar', () => this.duplicateEvent(ev.id)));
    actions.appendChild(mkBtn('📤', 'Exportar', () => { this.currentEventId = ev.id; this.openExportModal(); }));
    actions.appendChild(mkBtn('🗑️', 'Eliminar', () => this.deleteEvent(ev.id)));

    div.appendChild(info);
    div.appendChild(actions);
    return div;
  },

  async duplicateEvent(eventId) {
    const ev = await DB.get('events', eventId);
    if (!ev) return;
    const { id, createdAt, updatedAt, ...rest } = ev;
    const copy = await DB.put('events', {
      ...rest,
      title: ev.title + ' (copia)',
      date:  new Date().toISOString().slice(0,10),
    });
    Toast.show('Evento duplicado ✓ — ábrelo para editarlo', 'success');
    this.navigate('project-detail', ev.projectId);
  },

  _renderProjAgents(projAgents, allAgents, projectId) {
    const el = document.getElementById('tab-agentes'); if(!el) return;
    const LOE = ['Promotor','Proyectista','Director de Obra','Director de Ejecución',
      'Coordinador de Seguridad y Salud','Otros Técnicos','Contratista','Subcontrata',
      'Suministrador','Administración','Notaría','Registro de la Propiedad',
      'Organismo de Control (OCA)','Compañía de Seguros','Otros'];
    const sorted = [...projAgents].sort((a,b)=>(LOE.indexOf(a.role)-LOE.indexOf(b.role))||(a.name||'').localeCompare(b.name||''));
    el.innerHTML=`
      <div class="section-header mb-3">
        <div class="section-title">Agentes del proyecto</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" onclick="App.openAssignAgent('${projectId}')">＋ Asignar existente</button>
          <button class="btn btn-primary" onclick="App.openNewAgent('${projectId}')">＋ Nuevo agente</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:8px" id="proj-agents-list"></div>
      ${!projAgents.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">👥</div><div class="empty-title">Sin agentes asignados</div><div class="empty-sub">Asigna los agentes LOE a este proyecto</div></div>`:''}
    `;
    const list = document.getElementById('proj-agents-list');
    sorted.forEach(a=>list.appendChild(this._buildAgentCard(a,projectId)));
  },

  _buildAgentCard(a, projectId) {
    const div = document.createElement('div'); div.className='card card-sm';
    const color = this._agentColor(a.role);
    div.style.borderLeft = `3px solid ${color}`;
    const initials = (a.name||'?').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
    div.innerHTML=`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="width:36px;height:36px;border-radius:50%;background:${color}18;border:1px solid ${color}44;display:flex;align-items:center;justify-content:center;font-family:var(--font-cond);font-weight:800;color:${color};font-size:13px;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-cond);font-size:14px;font-weight:700;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.name}</div>
          <div style="font-size:10px;color:${color};font-family:var(--font-cond);font-weight:700;text-transform:uppercase;letter-spacing:.07em">${a.role||'—'}</div>
        </div>
        <button style="background:none;border:none;cursor:pointer;color:var(--text3);padding:4px" onclick="App.unassignAgent('${a.id}','${projectId}')" title="Desasignar">✕</button>
      </div>
      ${a.company?`<div style="font-size:11px;color:var(--text3);margin-bottom:6px">${a.company}</div>`:''}
      <div style="display:flex;gap:5px">
        ${a.email?`<a href="mailto:${a.email}" class="btn btn-sm btn-ghost" style="font-size:11px;text-decoration:none" onclick="event.stopPropagation()">📧</a>`:''}
        ${a.phone?`<a href="tel:${a.phone}" class="btn btn-sm btn-ghost" style="font-size:11px;text-decoration:none" onclick="event.stopPropagation()">📞</a>`:''}
        ${a.phone?`<a href="https://wa.me/${a.phone.replace(/\D/g,'')}" target="_blank" class="btn btn-sm btn-ghost" style="font-size:11px;text-decoration:none" onclick="event.stopPropagation()">💬</a>`:''}
      </div>
    `;
    return div;
  },

  /* ── TAB SEGUIMIENTO ── */
  _renderProjSeguimiento(p, events) {
    const el = document.getElementById('tab-seguimiento'); if (!el) return;
    const totalEv   = events.length;
    const lastEv    = events[0];
    const lastDate  = lastEv?.date ? new Date(lastEv.date+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'}) : '—';

    // Calcular % ejecución basado en fechas si las hay
    let pctEjec = p.pctEjecucion || 0;
    let diasRestantes = null;
    if (p.fechaFin) {
      const fin   = new Date(p.fechaFin+'T00:00:00');
      const hoy   = new Date();
      const inicio= p.fechaInicio ? new Date(p.fechaInicio+'T00:00:00') : null;
      diasRestantes = Math.ceil((fin - hoy) / 86400000);
      if (inicio && !p.pctEjecucion) {
        const total = (fin - inicio) / 86400000;
        const trans = (hoy - inicio) / 86400000;
        pctEjec = Math.min(100, Math.max(0, Math.round(trans / total * 100)));
      }
    }

    el.innerHTML = `
      <div class="card mb-3">
        <div class="section-header mb-3">
          <div class="section-title">📊 Estado de ejecución</div>
          <button class="btn btn-secondary btn-sm" onclick="App.editSeguimiento('${p.id}')">✏️ Editar</button>
        </div>

        <!-- Barra de progreso -->
        <div style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
            <span style="font-family:var(--font-cond);font-size:13px;color:var(--text2)">% Ejecución</span>
            <span style="font-family:var(--font-cond);font-size:28px;font-weight:800;color:var(--cyan)">${pctEjec}%</span>
          </div>
          <div style="height:12px;background:var(--surface2);border-radius:6px;overflow:hidden">
            <div style="height:100%;width:${pctEjec}%;background:${pctEjec>=100?'var(--green)':pctEjec>60?'var(--cyan)':'var(--yellow-corp)'};border-radius:6px;transition:width .5s"></div>
          </div>
          ${diasRestantes!==null?`<div style="font-size:12px;color:${diasRestantes<0?'var(--red)':diasRestantes<30?'var(--yellow-corp)':'var(--text3)'};margin-top:4px">
            ${diasRestantes<0?'⚠️ Plazo vencido hace '+Math.abs(diasRestantes)+' días':diasRestantes===0?'⚠️ Vence hoy':'📅 '+diasRestantes+' días para la entrega prevista'}
          </div>`:''}
        </div>

        <!-- Indicadores -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:20px">
          <div class="stat-card" style="padding:12px">
            <div class="stat-icon" style="font-size:18px">📋</div>
            <div class="stat-value" style="font-size:22px">${totalEv}</div>
            <div class="stat-label">Visitas / Reuniones</div>
          </div>
          <div class="stat-card" style="padding:12px;border-left-color:var(--yellow-corp)">
            <div class="stat-icon" style="font-size:18px">📅</div>
            <div class="stat-value" style="font-size:13px;margin-top:4px">${lastDate}</div>
            <div class="stat-label">Último evento</div>
          </div>
          ${p.fechaInicio?`<div class="stat-card" style="padding:12px;border-left-color:var(--green)">
            <div class="stat-icon" style="font-size:18px">🚀</div>
            <div class="stat-value" style="font-size:13px;margin-top:4px">${new Date(p.fechaInicio+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}</div>
            <div class="stat-label">Inicio de obra</div>
          </div>`:''}
        </div>

        <!-- Hitos -->
        <div class="section-title mb-2" style="font-size:13px">🏁 Hitos del proyecto</div>
        <div id="hitos-list" style="display:flex;flex-direction:column;gap:6px">
          ${(p.hitos||[]).length === 0
            ? '<div style="font-size:12px;color:var(--text3);padding:10px 0">Sin hitos definidos — pulsa Editar para añadirlos</div>'
            : (p.hitos||[]).map(h => `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface2);border-radius:8px;border-left:3px solid ${h.done?'var(--green)':'var(--border)'}">
                <span style="font-size:16px">${h.done?'✅':'⬜'}</span>
                <div style="flex:1">
                  <div style="font-size:13px;color:${h.done?'var(--text3)':'var(--white)'};${h.done?'text-decoration:line-through':''}">${h.texto}</div>
                  ${h.fecha?`<div style="font-size:11px;color:var(--text3)">${new Date(h.fecha+'T00:00:00').toLocaleDateString('es-ES')}</div>`:''}
                </div>
              </div>`).join('')}
        </div>

        <!-- Incidencias abiertas -->
        ${(p.incidencias||[]).filter(i=>!i.cerrada).length > 0 ? `
        <div class="section-title mb-2 mt-3" style="font-size:13px;color:var(--red)">⚠️ Incidencias abiertas</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${(p.incidencias||[]).filter(i=>!i.cerrada).map(i=>`
            <div style="padding:10px 12px;background:rgba(200,48,42,.08);border:1px solid rgba(200,48,42,.25);border-radius:8px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div style="font-size:13px;color:var(--white)">${i.texto}</div>
                <button class="btn btn-sm btn-ghost" style="font-size:11px;color:var(--green)" onclick="App.cerrarIncidencia('${p.id}','${i.id}')">✓ Cerrar</button>
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:4px">${i.fecha?new Date(i.fecha+'T00:00:00').toLocaleDateString('es-ES'):''} ${i.responsable?'· Resp: '+i.responsable:''}</div>
            </div>`).join('')}
        </div>` : ''}
      </div>
    `;
  },

  async editSeguimiento(projectId) {
    const p = await DB.get('projects', projectId);
    if (!p) return;
    const hitos = p.hitos || [];
    const incidencias = p.incidencias || [];

    const modal = App.createModal('📊 Editar seguimiento', `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label class="form-label">% Ejecución (0-100)</label>
          <input id="seg-pct" type="number" min="0" max="100" class="form-input" value="${p.pctEjecucion||0}">
        </div>
        <div>
          <div class="section-title mb-2" style="font-size:13px">🏁 Hitos</div>
          <div id="hitos-edit" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
            ${hitos.map((h,i)=>`
              <div style="display:flex;gap:6px;align-items:center">
                <input type="checkbox" ${h.done?'checked':''} onchange="App._hitoToggle(${i},this.checked)" style="width:16px;height:16px;flex-shrink:0">
                <input class="form-input" value="${h.texto}" oninput="App._hitoText(${i},this.value)" style="flex:1;font-size:12px">
                <input type="date" class="form-input" value="${h.fecha||''}" oninput="App._hitoFecha(${i},this.value)" style="width:140px;font-size:12px">
                <button class="btn btn-ghost btn-icon btn-sm" onclick="App._hitoDelete(${i})">🗑️</button>
              </div>`).join('')}
          </div>
          <button class="btn btn-secondary btn-sm" onclick="App._hitoAdd()">＋ Añadir hito</button>
        </div>
        <div>
          <div class="section-title mb-2" style="font-size:13px">⚠️ Nueva incidencia</div>
          <div style="display:flex;gap:6px">
            <input id="inc-texto" class="form-input" placeholder="Descripción de la incidencia" style="flex:1">
            <input id="inc-resp"  class="form-input" placeholder="Responsable" style="width:150px">
            <button class="btn btn-danger btn-sm" onclick="App._addIncidencia()">＋</button>
          </div>
        </div>
      </div>
    `, 'modal-lg');

    this._editHitos = JSON.parse(JSON.stringify(hitos));
    this._editProjectId = projectId;

    modal.querySelector('.modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="App.saveSeguimiento()">💾 Guardar</button>
    `;
    document.body.appendChild(modal);
  },

  _editHitos: [], _editProjectId: null,
  _hitoToggle(i, v) { if(this._editHitos[i]) this._editHitos[i].done = v; },
  _hitoText(i, v)   { if(this._editHitos[i]) this._editHitos[i].texto = v; },
  _hitoFecha(i, v)  { if(this._editHitos[i]) this._editHitos[i].fecha = v; },
  _hitoDelete(i)    { this._editHitos.splice(i,1); App.editSeguimiento(this._editProjectId); },
  _hitoAdd()        { this._editHitos.push({id:crypto.randomUUID(),texto:'',fecha:'',done:false}); App.editSeguimiento(this._editProjectId); },

  async _addIncidencia() {
    const texto = document.getElementById('inc-texto')?.value?.trim();
    const resp  = document.getElementById('inc-resp')?.value?.trim();
    if (!texto) { Toast.show('Describe la incidencia','error'); return; }
    const p = await DB.get('projects', this._editProjectId);
    const incidencias = [...(p.incidencias||[]), {id:crypto.randomUUID(),texto,responsable:resp,fecha:new Date().toISOString().slice(0,10),cerrada:false}];
    await DB.put('projects', {...p, incidencias});
    Toast.show('Incidencia registrada','success');
    document.querySelector('.modal-backdrop')?.remove();
    this.navigate('project-detail', this._editProjectId);
  },

  async cerrarIncidencia(projectId, incId) {
    const p = await DB.get('projects', projectId);
    const incidencias = (p.incidencias||[]).map(i => i.id===incId ? {...i,cerrada:true,fechaCierre:new Date().toISOString().slice(0,10)} : i);
    await DB.put('projects', {...p, incidencias});
    Toast.show('Incidencia cerrada ✓','success');
    this.navigate('project-detail', projectId);
  },

  async saveSeguimiento() {
    const pct = parseInt(document.getElementById('seg-pct')?.value||'0');
    const p   = await DB.get('projects', this._editProjectId);
    await DB.put('projects', {...p, pctEjecucion:pct, hitos:this._editHitos});
    document.querySelector('.modal-backdrop')?.remove();
    Toast.show('Seguimiento guardado ✓','success');
    this.navigate('project-detail', this._editProjectId);
  },

  /* ── TAB ECONÓMICO ── */
  _renderProjEconomico(p) {
    const el = document.getElementById('tab-economico'); if (!el) return;
    const pem      = parseFloat(p.pem||0);
    const certs    = p.certificaciones || [];
    const totalCert= certs.reduce((s,c)=>s+parseFloat(c.importe||0),0);
    const pctCert  = pem > 0 ? Math.round(totalCert/pem*100) : 0;

    el.innerHTML = `
      <div class="card mb-3">
        <div class="section-header mb-3">
          <div class="section-title">💰 Resumen económico</div>
          <button class="btn btn-primary btn-sm" onclick="App.openAddCertificacion('${p.id}')">＋ Certificación</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:20px">
          <div class="stat-card" style="padding:12px">
            <div class="stat-label">PEM</div>
            <div class="stat-value" style="font-size:18px">${pem?App.formatEUR(pem):'—'}</div>
          </div>
          <div class="stat-card" style="padding:12px;border-left-color:var(--green)">
            <div class="stat-label">Certificado</div>
            <div class="stat-value" style="font-size:18px">${App.formatEUR(totalCert)}</div>
          </div>
          <div class="stat-card" style="padding:12px;border-left-color:var(--yellow-corp)">
            <div class="stat-label">Pendiente</div>
            <div class="stat-value" style="font-size:18px">${App.formatEUR(Math.max(0,pem-totalCert))}</div>
          </div>
          <div class="stat-card" style="padding:12px;border-left-color:var(--cyan)">
            <div class="stat-label">% Certificado</div>
            <div class="stat-value" style="font-size:22px">${pctCert}%</div>
          </div>
        </div>

        ${pem>0?`<div style="height:8px;background:var(--surface2);border-radius:4px;overflow:hidden;margin-bottom:20px">
          <div style="height:100%;width:${Math.min(100,pctCert)}%;background:var(--green);border-radius:4px"></div>
        </div>`:''}

        <div class="section-title mb-2" style="font-size:13px">📋 Certificaciones</div>
        ${certs.length===0
          ? '<div style="font-size:12px;color:var(--text3);padding:10px 0">Sin certificaciones registradas</div>'
          : `<table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead><tr style="color:var(--text3);border-bottom:1px solid var(--border)">
                <th style="text-align:left;padding:6px 4px">Nº</th>
                <th style="text-align:left;padding:6px 4px">Concepto</th>
                <th style="text-align:left;padding:6px 4px">Fecha</th>
                <th style="text-align:right;padding:6px 4px">Importe</th>
                <th style="text-align:center;padding:6px 4px">Estado</th>
                <th></th>
              </tr></thead>
              <tbody>
                ${certs.map((c,i)=>`<tr style="border-bottom:1px solid rgba(255,255,255,.05)">
                  <td style="padding:6px 4px;color:var(--text3)">${i+1}</td>
                  <td style="padding:6px 4px">${c.concepto||'—'}</td>
                  <td style="padding:6px 4px;color:var(--text3)">${c.fecha||'—'}</td>
                  <td style="padding:6px 4px;text-align:right;color:var(--green)">${App.formatEUR(c.importe||0)}</td>
                  <td style="padding:6px 4px;text-align:center"><span class="chip ${c.pagada?'chip-green':'chip-orange'}" style="font-size:10px">${c.pagada?'Pagada':'Pendiente'}</span></td>
                  <td style="padding:6px 4px">
                    <button class="btn btn-ghost btn-icon btn-sm" onclick="App.togglePagoCert('${p.id}','${c.id}')" title="${c.pagada?'Marcar pendiente':'Marcar pagada'}">${c.pagada?'↩️':'✅'}</button>
                    <button class="btn btn-ghost btn-icon btn-sm" onclick="App.deleteCert('${p.id}','${c.id}')">🗑️</button>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>`}
      </div>
    `;
  },

  async openAddCertificacion(projectId) {
    const modal = App.createModal('＋ Nueva certificación', `
      <div class="form-grid">
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Concepto</label>
          <input id="cert-concepto" class="form-input" placeholder="Cert. nº1 — Estructura">
        </div>
        <div class="form-group">
          <label class="form-label">Importe (€)</label>
          <input id="cert-importe" type="number" class="form-input" placeholder="45000">
        </div>
        <div class="form-group">
          <label class="form-label">Fecha</label>
          <input id="cert-fecha" type="date" class="form-input" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="form-group">
          <label class="form-label">Estado</label>
          <select id="cert-pagada" class="form-select">
            <option value="0">Pendiente de pago</option>
            <option value="1">Pagada</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notas</label>
          <input id="cert-notas" class="form-input" placeholder="Factura nº...">
        </div>
      </div>
    `);
    modal.querySelector('.modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="App.saveCertificacion('${projectId}')">💾 Guardar</button>
    `;
    document.body.appendChild(modal);
  },

  async saveCertificacion(projectId) {
    const importe = parseFloat(document.getElementById('cert-importe')?.value||'0');
    if (!importe) { Toast.show('Introduce el importe','error'); return; }
    const p = await DB.get('projects', projectId);
    const cert = {
      id:       crypto.randomUUID(),
      concepto: document.getElementById('cert-concepto')?.value?.trim()||'',
      importe,
      fecha:    document.getElementById('cert-fecha')?.value||'',
      pagada:   document.getElementById('cert-pagada')?.value === '1',
      notas:    document.getElementById('cert-notas')?.value?.trim()||'',
    };
    await DB.put('projects', {...p, certificaciones:[...(p.certificaciones||[]), cert]});
    document.querySelector('.modal-backdrop')?.remove();
    Toast.show('Certificación guardada ✓','success');
    this.navigate('project-detail', projectId);
  },

  async togglePagoCert(projectId, certId) {
    const p = await DB.get('projects', projectId);
    const certs = (p.certificaciones||[]).map(c => c.id===certId ? {...c, pagada:!c.pagada} : c);
    await DB.put('projects', {...p, certificaciones:certs});
    this.navigate('project-detail', projectId);
  },

  async deleteCert(projectId, certId) {
    if (!confirm('¿Eliminar esta certificación?')) return;
    const p = await DB.get('projects', projectId);
    await DB.put('projects', {...p, certificaciones:(p.certificaciones||[]).filter(c=>c.id!==certId)});
    Toast.show('Certificación eliminada');
    this.navigate('project-detail', projectId);
  },

  /* ── TAB DOCUMENTACIÓN ── */
  _renderProjDocumentos(p) {
    const el = document.getElementById('tab-documentos'); if (!el) return;
    const docs = p.documentos || [];

    el.innerHTML = `
      <div class="card mb-3">
        <div class="section-header mb-3">
          <div>
            <div class="section-title">📁 Documentación del proyecto</div>
            <div class="section-sub">Referencias y enlaces a documentos — los archivos pesados se guardan en tu nube</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="App.openAddDocumento('${p.id}')">＋ Añadir</button>
        </div>

        ${p.archivoUrl ? `
          <div style="background:var(--surface2);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
            <span style="font-size:20px">📂</span>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:600;color:var(--white)">Carpeta de archivo en la nube</div>
              <div style="font-size:11px;color:var(--text3)">${p.archivoUrl}</div>
            </div>
            <a href="${p.archivoUrl}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration:none;flex-shrink:0">Abrir ↗</a>
          </div>` : `
          <div style="background:var(--surface2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--text3)">
            💡 Añade el enlace a tu carpeta de MEGA, Drive o OneDrive en <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="App.navigate('project-edit','${p.id}')">✏️ Editar proyecto</button>
          </div>`}

        <div class="section-title mb-2" style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Documentos referenciados</div>

        ${docs.length===0
          ? '<div style="font-size:12px;color:var(--text3);padding:10px 0">Sin documentos — añade referencias a planos, licencias, seguros, contratos...</div>'
          : `<div style="display:flex;flex-direction:column;gap:6px">${docs.map(d=>`
              <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface2);border-radius:8px">
                <span style="font-size:22px;flex-shrink:0">${this._docIcon(d.tipo)}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;color:var(--white)">${d.nombre}</div>
                  <div style="font-size:11px;color:var(--text3)">${d.tipo||''}${d.fecha?' · '+d.fecha:''}${d.notas?' · '+d.notas:''}</div>
                </div>
                ${d.url?`<a href="${d.url}" target="_blank" class="btn btn-ghost btn-sm" style="text-decoration:none;flex-shrink:0">↗</a>`:''}
                <button class="btn btn-ghost btn-icon btn-sm" onclick="App.deleteDocumento('${p.id}','${d.id}')">🗑️</button>
              </div>`).join('')}</div>`}
      </div>
    `;
  },

  _docIcon(tipo) {
    return {'Licencia':'🏛️','Proyecto visado':'📐','Plano':'📐','Seguro':'🛡️',
            'Contrato':'📄','Certificado':'✅','Estudio geotécnico':'🔬',
            'Estudio seguridad':'⛑️','Control calidad':'🔍','Otro':'📎'}[tipo]||'📎';
  },

  async openAddDocumento(projectId) {
    const tipos = ['Licencia','Proyecto visado','Plano','Seguro','Contrato',
                   'Certificado','Estudio geotécnico','Estudio seguridad','Control calidad','Otro'];
    const modal = App.createModal('＋ Nuevo documento', `
      <div class="form-grid">
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Nombre del documento *</label>
          <input id="doc-nombre" class="form-input" placeholder="Licencia de obra mayor nº LM-2025-001">
        </div>
        <div class="form-group">
          <label class="form-label">Tipo</label>
          <select id="doc-tipo" class="form-select">
            ${tipos.map(t=>`<option>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Fecha</label>
          <input id="doc-fecha" type="date" class="form-input" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Enlace (MEGA, Drive, URL...)</label>
          <input id="doc-url" class="form-input" placeholder="https://mega.nz/... o vacío si es físico">
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Notas</label>
          <input id="doc-notas" class="form-input" placeholder="Nº expediente, observaciones...">
        </div>
      </div>
    `);
    modal.querySelector('.modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="App.saveDocumento('${projectId}')">💾 Guardar</button>
    `;
    document.body.appendChild(modal);
  },

  async saveDocumento(projectId) {
    const nombre = document.getElementById('doc-nombre')?.value?.trim();
    if (!nombre) { Toast.show('El nombre es obligatorio','error'); return; }
    const p = await DB.get('projects', projectId);
    const doc = {
      id:     crypto.randomUUID(),
      nombre,
      tipo:   document.getElementById('doc-tipo')?.value||'Otro',
      fecha:  document.getElementById('doc-fecha')?.value||'',
      url:    document.getElementById('doc-url')?.value?.trim()||'',
      notas:  document.getElementById('doc-notas')?.value?.trim()||'',
    };
    await DB.put('projects', {...p, documentos:[...(p.documentos||[]), doc]});
    document.querySelector('.modal-backdrop')?.remove();
    Toast.show('Documento guardado ✓','success');
    this.navigate('project-detail', projectId);
  },

  async deleteDocumento(projectId, docId) {
    if (!confirm('¿Eliminar este documento?')) return;
    const p = await DB.get('projects', projectId);
    await DB.put('projects', {...p, documentos:(p.documentos||[]).filter(d=>d.id!==docId)});
    Toast.show('Documento eliminado');
    this.navigate('project-detail', projectId);
  },

  _renderProjInfo(p) {
    const el = document.getElementById('tab-info'); if (!el) return;
    el.innerHTML = `
      <div class="card">
        <div class="section-header mb-3">
          <div class="section-title">📐 Ficha técnica</div>
          <button class="btn btn-primary btn-sm" onclick="App.saveFichaTecnica('${p.id}')">💾 Guardar cambios</button>
        </div>
        <div class="form-grid">
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Nombre / denominación</label>
            <input id="fi-nombre" class="form-input" value="${(p.nombre||p.name||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="form-group">
            <label class="form-label">Referencia / expediente</label>
            <input id="fi-ref" class="form-input" value="${(p.referencia||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select id="fi-estado" class="form-select">
              ${App.ESTADOS.map(e=>`<option ${p.estado===e?'selected':''}>${e}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo de obra</label>
            <select id="fi-tipo" class="form-select">
              ${App.TIPOS_OBRA.map(t=>`<option ${p.tipoObra===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Uso</label>
            <input id="fi-uso" class="form-input" value="${(p.uso||'').replace(/"/g,'&quot;')}" placeholder="Residencial, Terciario...">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Dirección / emplazamiento</label>
            <input id="fi-dir" class="form-input" value="${(p.direccion||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="form-group">
            <label class="form-label">Municipio</label>
            <input id="fi-muni" class="form-input" value="${(p.municipio||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="form-group">
            <label class="form-label">Provincia</label>
            <input id="fi-prov" class="form-input" value="${(p.provincia||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="form-group">
            <label class="form-label">Ref. catastral</label>
            <input id="fi-catastro" class="form-input" value="${(p.refCatastral||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="form-group">
            <label class="form-label">Nº de licencia</label>
            <input id="fi-licencia" class="form-input" value="${(p.licencia||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="form-group">
            <label class="form-label">Sup. construida (m²)</label>
            <input id="fi-sup" type="number" class="form-input" value="${p.superficieTotal||''}">
          </div>
          <div class="form-group">
            <label class="form-label">Nº de plantas</label>
            <input id="fi-plantas" type="number" class="form-input" value="${p.plantas||''}">
          </div>
          <div class="form-group">
            <label class="form-label">Nº viviendas / uds.</label>
            <input id="fi-uds" type="number" class="form-input" value="${p.unidades||''}">
          </div>
          <div class="form-group">
            <label class="form-label">PEM (€)</label>
            <input id="fi-pem" type="number" class="form-input" value="${p.pem||''}" min="0" step="0.01" placeholder="0,00">
          </div>
          <div class="form-group">
            <label class="form-label">Fecha inicio obra</label>
            <input id="fi-finicio" type="date" class="form-input" value="${p.fechaInicio||''}">
          </div>
          <div class="form-group">
            <label class="form-label">Fecha fin prevista</label>
            <input id="fi-ffin" type="date" class="form-input" value="${p.fechaFin||''}">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">🔗 Enlace carpeta archivo (MEGA, Drive...)</label>
            <input id="fi-archivo" class="form-input" value="${(p.archivoUrl||'').replace(/"/g,'&quot;')}" placeholder="https://mega.nz/folder/...">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Observaciones</label>
            <textarea id="fi-obs" class="form-textarea" style="min-height:80px">${p.observaciones||''}</textarea>
          </div>
        </div>
      </div>
    `;
  },

  async saveFichaTecnica(projectId) {
    const p = await DB.get('projects', projectId);
    await DB.put('projects', { ...p,
      nombre:          document.getElementById('fi-nombre')?.value?.trim()   || p.nombre,
      name:            document.getElementById('fi-nombre')?.value?.trim()   || p.nombre,
      referencia:      document.getElementById('fi-ref')?.value?.trim()      || '',
      estado:          document.getElementById('fi-estado')?.value           || '',
      tipoObra:        document.getElementById('fi-tipo')?.value             || '',
      uso:             document.getElementById('fi-uso')?.value?.trim()      || '',
      direccion:       document.getElementById('fi-dir')?.value?.trim()      || '',
      municipio:       document.getElementById('fi-muni')?.value?.trim()     || '',
      provincia:       document.getElementById('fi-prov')?.value?.trim()     || '',
      refCatastral:    document.getElementById('fi-catastro')?.value?.trim() || '',
      licencia:        document.getElementById('fi-licencia')?.value?.trim() || '',
      superficieTotal: document.getElementById('fi-sup')?.value             || '',
      plantas:         document.getElementById('fi-plantas')?.value          || '',
      unidades:        document.getElementById('fi-uds')?.value             || '',
      pem:             document.getElementById('fi-pem')?.value             || '',
      fechaInicio:     document.getElementById('fi-finicio')?.value          || '',
      fechaFin:        document.getElementById('fi-ffin')?.value             || '',
      archivoUrl:      document.getElementById('fi-archivo')?.value?.trim()  || '',
      observaciones:   document.getElementById('fi-obs')?.value?.trim()      || '',
    });
    Toast.show('Ficha técnica guardada ✓', 'success');
    this.navigate('project-detail', projectId);
  },

  async openAssignAgent(projectId) {
    const all = await DB.getAll('contacts').catch(()=>[]);
    const unassigned = all.filter(a=>!(a.projectIds||[]).includes(projectId));
    if (!unassigned.length) { Toast.show('Todos los agentes ya están asignados a este proyecto','error'); return; }
    const modal = this.createModal('Asignar agente al proyecto', `
      <input id="assign-q" class="form-input mb-3" placeholder="🔍 Buscar agente..." oninput="App.filterAssignList(this.value)">
      <div id="assign-list" style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
        ${unassigned.map(a=>`
          <div class="file-item" style="cursor:pointer" onclick="App.assignAgent('${a.id}','${projectId}')">
            <div style="width:32px;height:32px;border-radius:50%;background:${this._agentColor(a.role)}22;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${this._agentIcon(a.role)}</div>
            <div class="file-info">
              <div class="file-name">${a.name}</div>
              <div class="file-size">${a.role||'—'}${a.company?' · '+a.company:''}</div>
            </div>
            <button class="btn btn-primary btn-sm">Asignar</button>
          </div>`).join('')}
      </div>`);
    document.body.appendChild(modal);
  },

  filterAssignList(q) {
    q = q.toLowerCase();
    document.querySelectorAll('#assign-list .file-item').forEach(el=>{
      el.style.display = el.textContent.toLowerCase().includes(q)?'':'none';
    });
  },

  async assignAgent(agentId, projectId) {
    const a = await DB.get('contacts', agentId); if(!a) return;
    const ids = new Set(a.projectIds||[]); ids.add(projectId);
    await DB.put('contacts', {...a, projectIds:[...ids]});
    document.querySelector('.modal-backdrop')?.remove();
    Toast.show('Agente asignado ✓','success');
    this.navigate('project-detail', projectId);
  },

  async unassignAgent(agentId, projectId) {
    if(!confirm('¿Desasignar este agente del proyecto?')) return;
    const a = await DB.get('contacts', agentId); if(!a) return;
    await DB.put('contacts', {...a, projectIds:(a.projectIds||[]).filter(id=>id!==projectId)});
    Toast.show('Agente desasignado');
    this.navigate('project-detail', projectId);
  },

  openNewAgent(projectId) {
    this._pendingAgentProjectId = projectId;
    if (typeof ContactsView !== 'undefined') ContactsView.openForm(null, projectId);
    else this.navigate('agents');
  },

  /* ════════════════════════════════════════════
     EVENTOS — nuevo (centrado en proyecto)
  ════════════════════════════════════════════ */
  async renderEventNew(content, title, actions, projectId) {
    title.textContent = 'Nuevo evento';
    actions.innerHTML = `<button class="btn btn-secondary" onclick="App.navigate('project-detail','${projectId||''}')">← Volver</button>`;
    const [projects, allAgents] = await Promise.all([
      DB.getAll('projects').catch(()=>[]),
      DB.getAll('contacts').catch(()=>[]),
    ]);
    this._participants = [];
    this._eventType    = 'obra';
    this._newEventProjectId = projectId;

    content.innerHTML = `
      <div style="max-width:700px;margin:0 auto">
        <div class="card mb-3">
          <div class="section-title mb-3">1. Tipo de evento</div>
          <div class="type-selector">
            <div class="type-option selected" id="opt-obra" onclick="App._eventType='obra';document.querySelectorAll('.type-option').forEach(e=>e.classList.remove('selected'));this.classList.add('selected')">
              <div class="type-option-icon">🏗️</div>
              <div class="type-option-label">Visita de obra</div>
              <div class="type-option-sub">Inspección in situ</div>
            </div>
            <div class="type-option" id="opt-reunion" onclick="App._eventType='reunion';document.querySelectorAll('.type-option').forEach(e=>e.classList.remove('selected'));this.classList.add('selected')">
              <div class="type-option-icon">🤝</div>
              <div class="type-option-label">Reunión</div>
              <div class="type-option-sub">Acta y acuerdos</div>
            </div>
          </div>
        </div>

        <div class="card mb-3">
          <div class="section-title mb-3">2. Proyecto</div>
          <select id="ev-proj-sel" class="form-select" onchange="App.onProjChange(this.value)">
            <option value="">— Selecciona un proyecto —</option>
            ${projects.map(p=>`<option value="${p.id}" ${p.id===projectId?'selected':''}>${p.nombre||p.name}${p.referencia?' ('+p.referencia+')':''}</option>`).join('')}
          </select>
        </div>

        <div class="card mb-3">
          <div class="section-title mb-3">3. Datos</div>
          <div class="form-grid mb-3">
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">Título *</label>
              <input id="ev-title" class="form-input" placeholder="Visita estructura / Reunión de coordinación">
            </div>
            <div class="form-group">
              <label class="form-label">Fecha *</label>
              <input id="ev-date" type="date" class="form-input" value="${new Date().toISOString().slice(0,10)}">
            </div>
            <div class="form-group">
              <label class="form-label">Hora</label>
              <input id="ev-time" type="time" class="form-input">
            </div>
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label">Lugar</label>
              <input id="ev-location" class="form-input" placeholder="Dirección o nombre del lugar">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Descripción / objeto</label>
            <textarea id="ev-desc" class="form-textarea" style="min-height:70px" placeholder="Objeto de la visita o reunión..."></textarea>
          </div>
        </div>

        <div class="card mb-3">
          <div class="section-title mb-3">4. Participantes</div>
          <div id="ev-proj-agents" style="margin-bottom:10px"></div>
          <div class="participant-list" id="ev-part-list"></div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input id="ev-part-input" class="form-input" placeholder="Añadir participante manualmente..."
              onkeydown="if(event.key==='Enter'){App.addParticipant();event.preventDefault()}">
            <button class="btn btn-secondary" onclick="App.addParticipant()">＋</button>
          </div>
        </div>

        <div class="flex justify-between mt-3">
          <div></div>
          <button class="btn btn-primary btn-lg" onclick="App.saveEvent()">💾 Crear evento</button>
        </div>
      </div>
    `;
    if (projectId) this.onProjChange(projectId);
  },

  async onProjChange(projectId) {
    const el = document.getElementById('ev-proj-agents'); if(!el) return;
    const all = await DB.getAll('contacts').catch(()=>[]);
    if (!all.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text3)">Sin agentes en la base de datos. Ve a Agentes LOE para a\u00f1adir.</div>';
      return;
    }
    // Separar agentes del proyecto y el resto
    const projAgents  = all.filter(a => projectId && (a.projectIds||[]).includes(projectId));
    const otherAgents = all.filter(a => !projectId || !(a.projectIds||[]).includes(projectId));

    const buildBtn = (a) => `
      <button class="btn btn-sm" id="pa-${a.id}"
        style="background:var(--surface2);border:1px solid var(--border);color:var(--text);font-size:11px;text-transform:none;font-weight:normal"
        onclick="App.toggleAgent('${a.id}','${a.name}',this)"
        title="${a.role||''}${a.company?' · '+a.company:''}">
        ${this._agentIcon(a.role)} ${a.name}
      </button>`;

    el.innerHTML = `
      ${projAgents.length ? `
        <div style="font-size:10px;color:var(--cyan);margin-bottom:6px;font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.07em">Agentes del proyecto</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
          ${projAgents.map(buildBtn).join('')}
        </div>` : ''}
      ${otherAgents.length ? `
        <div style="font-size:10px;color:var(--text3);margin-bottom:6px;font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.07em">Resto de agentes</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${otherAgents.map(buildBtn).join('')}
        </div>` : ''}
    `;
  },

  toggleAgent(id, name, btn) {
    const i = this._participants.indexOf(name);
    if (i>=0) {
      this._participants.splice(i,1);
      btn.style.cssText='background:var(--surface2);border:1px solid var(--border-cyan);color:var(--text)';
    } else {
      this._participants.push(name);
      btn.style.cssText='background:var(--cyan);border:1px solid var(--cyan);color:#141516;font-weight:700';
    }
    this._renderParticipants();
  },

  addParticipant() {
    const input=document.getElementById('ev-part-input');
    const v=(input?.value||'').trim(); if(!v) return;
    if (!this._participants.includes(v)) { this._participants.push(v); this._renderParticipants(); }
    input.value='';
  },

  removeParticipant(i) { this._participants.splice(i,1); this._renderParticipants(); },

  _renderParticipants() {
    const list=document.getElementById('ev-part-list'); if(!list) return;
    list.innerHTML=this._participants.map((p,i)=>
      `<div class="participant-chip">${p}<button onclick="App.removeParticipant(${i})">×</button></div>`
    ).join('');
  },

  async saveEvent() {
    const title     = document.getElementById('ev-title')?.value?.trim();
    const date      = document.getElementById('ev-date')?.value;
    const projectId = document.getElementById('ev-proj-sel')?.value;
    if (!title)     { Toast.show('Introduce un título','error'); return; }
    if (!date)      { Toast.show('Selecciona una fecha','error'); return; }
    if (!projectId) { Toast.show('Selecciona un proyecto','error'); return; }

    const project = await DB.get('projects', projectId);
    const ev = await DB.put('events', {
      type:         this._eventType,
      title,
      date,
      time:         document.getElementById('ev-time')?.value||'',
      location:     document.getElementById('ev-location')?.value?.trim()||project?.direccion||'',
      projectId,
      project:      project?.nombre||project?.name||'',
      participants: [...this._participants],
      description:  document.getElementById('ev-desc')?.value?.trim()||'',
    });
    this.currentProjectId = projectId;
    this.currentEventId   = ev.id;
    this.currentTab       = 'fotos';
    Toast.show('Evento creado ✓','success');
    this.navigate('event-detail', ev.id);
  },

  async deleteEvent(id) {
    if (!id) { Toast.show('ID de evento no válido', 'error'); return; }
    if (!confirm('¿Eliminar este evento y todos sus datos?')) return;

    try {
      // Get event first
      const ev = await DB.get('events', id);
      const projId = (ev && ev.projectId) ? ev.projectId : this.currentProjectId;

      // Delete all related data
      const stores = ['media', 'audios', 'files', 'notes'];
      for (let s = 0; s < stores.length; s++) {
        const items = await DB.getAll(stores[s], 'eventId', id).catch(() => []);
        for (let i = 0; i < items.length; i++) {
          await DB.delete(stores[s], items[i].id).catch(() => {});
        }
      }

      // Delete the event itself
      await DB.delete('events', id);

      // Register deletion to prevent sync re-import
      if (typeof Sync !== 'undefined') {
        Sync.recordDeletion('event', id, ev ? (ev.project || '') : '');
      }

      document.querySelector('.modal-backdrop')?.remove();
      Toast.show('Evento eliminado ✓', 'success');

      // Navigate back
      this.currentTab = 'eventos';
      if (projId) {
        this.currentProjectId = projId;
        this.navigate('project-detail', projId);
      } else {
        this.navigate('projects');
      }
    } catch(e) {
      console.error('deleteEvent error:', e);
      Toast.show('Error al eliminar: ' + e.message, 'error');
    }
  },

  /* ════════════════════════════════════════════
     AGENTES — BD global
  ════════════════════════════════════════════ */
  async renderAgents(content, title, actions) {
    if (typeof ContactsView !== 'undefined') ContactsView.render(content, title, actions);
    else {
      title.textContent = 'Agentes';
      content.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">Módulo de agentes no disponible</div></div>';
    }
  },

  /* ════════════════════════════════════════════
     CALENDARIO
  ════════════════════════════════════════════ */
  async renderCalendar(content, title, actions) {
    title.textContent = 'Calendario';
    this._calYear  = new Date().getFullYear();
    this._calMonth = new Date().getMonth();
    this._calEvents = await DB.getAll('events').catch(()=>[]);
    this._calEl = content;
    this._drawCalendar();
  },

  _drawCalendar() {
    const y=this._calYear, m=this._calMonth, el=this._calEl;
    const monthName=new Date(y,m,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});
    const first=(new Date(y,m,1).getDay()+6)%7;
    const days=new Date(y,m+1,0).getDate();
    const today=new Date().toISOString().slice(0,10);
    const byDate={};
    this._calEvents.forEach(ev=>{if(ev.date){if(!byDate[ev.date])byDate[ev.date]=[];byDate[ev.date].push(ev);}});
    let cells='';
    for(let i=0;i<first;i++) cells+=`<div class="cal-day other-month"></div>`;
    for(let d=1;d<=days;d++){
      const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const evs=byDate[ds]||[];
      cells+=`<div class="cal-day${ds===today?' today':''}" onclick="App._calClick('${ds}')">
        <div class="cal-day-num">${d}</div>
        ${evs.slice(0,2).map(e=>`<div class="cal-event-dot cal-event-${e.type}">${e.title}</div>`).join('')}
        ${evs.length>2?`<div style="font-size:9px;color:var(--text3)">+${evs.length-2}</div>`:''}
      </div>`;
    }
    el.innerHTML=`<div class="card"><div class="cal-header">
      <button class="btn btn-ghost btn-icon" onclick="App._calMonth--;if(App._calMonth<0){App._calMonth=11;App._calYear--;}App._drawCalendar()">‹</button>
      <div class="cal-month" style="text-transform:capitalize">${monthName}</div>
      <button class="btn btn-ghost btn-icon" onclick="App._calMonth++;if(App._calMonth>11){App._calMonth=0;App._calYear++;}App._drawCalendar()">›</button>
    </div>
    <div class="cal-grid">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d=>`<div class="cal-day-header">${d}</div>`).join('')}${cells}</div></div>`;
  },

  _calClick(ds) {
    const evs=this._calEvents.filter(e=>e.date===ds);
    if (evs.length===1) { this.currentEventId=evs[0].id; this.currentProjectId=evs[0].projectId; this.navigate('event-detail',evs[0].id); }
    else if (evs.length>1) {
      const modal=this.createModal(new Date(ds+'T00:00:00').toLocaleDateString('es-ES'), evs.map(ev=>`
        <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;margin-bottom:8px" onclick="document.querySelector('.modal-backdrop').remove();App.navigate('event-detail','${ev.id}')">
          <span style="font-size:20px">${ev.type==='obra'?'🏗️':'🤝'}</span>
          <div><div style="font-weight:600">${ev.title}</div><div style="font-size:12px;color:var(--text3)">${ev.project||'—'}</div></div>
        </div>`).join(''));
      document.body.appendChild(modal);
    }
  },

  /* ════════════════════════════════════════════
     EVENTO DETALLE
  ════════════════════════════════════════════ */
  async renderEventDetail(content, title, actions, eventId) {
    if (!eventId) eventId=this.currentEventId;
    this.currentEventId=eventId;
    const ev=await DB.get('events',eventId);
    if (!ev) { this.navigate('projects'); return; }
    if (ev.projectId) this.currentProjectId=ev.projectId;

    title.textContent=ev.type==='obra'?'🏗️ Visita de obra':'🤝 Reunión';
    actions.innerHTML=`
      <button class="btn btn-secondary" onclick="App.navigate('project-detail','${ev.projectId||''}')">← Volver</button>
      <button class="btn btn-secondary" onclick="App.openEditEvent('${eventId}')">✏️ Editar</button>
      <button class="btn btn-secondary" onclick="Firma && Firma.openSignModal('${eventId}')">✍️ Firmar</button>
      <button class="btn btn-danger" onclick="App.deleteEvent('${eventId}')">🗑️ Eliminar</button>
    `;
    const project=ev.projectId?await DB.get('projects',ev.projectId):null;
    const dateStr=ev.date?new Date(ev.date+'T00:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'—';

    content.innerHTML=`
      <div style="max-width:920px;margin:0 auto">
        <div class="card mb-3">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
            <div>
              ${project?`<div style="font-size:11px;color:var(--cyan);font-family:var(--mono);margin-bottom:4px;cursor:pointer" onclick="App.navigate('project-detail','${project.id}')">${project.nombre}${project.referencia?' · '+project.referencia:''} →</div>`:''}
              <div style="font-size:20px;font-weight:700;color:var(--white)">${ev.title}</div>
              <div style="display:flex;gap:14px;margin-top:6px;flex-wrap:wrap;font-size:12px;color:var(--text3)">
                <span>📅 ${dateStr}</span>
                ${ev.time?`<span>⏰ ${ev.time}</span>`:''}
                ${ev.location?`<span>📍 ${ev.location}</span>`:''}
              </div>
              <div style="margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:5px">
                ${(ev.participants||[]).map(p=>`<span class="chip chip-blue">👤 ${p}</span>`).join('')}
                <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="App.openEditParticipants('${ev.id}')">✏️ ${ev.participants?.length?'Editar':'＋ Añadir'} participantes</button>
              </div>
            </div>
            <span class="chip ${ev.type==='obra'?'chip-orange':'chip-blue'}" style="font-size:13px;padding:6px 14px">${ev.type==='obra'?'🏗️ Obra':'🤝 Reunión'}</span>
          </div>
          ${ev.description?`<div class="divider"></div><div style="font-size:13px;color:var(--text2)">${ev.description}</div>`:''}
        </div>
        <div class="tabs-bar">
          <button class="tab-btn ${this.currentTab==='fotos'?'active':''}"    onclick="App.switchTab('fotos')">📷 Fotos</button>
          <button class="tab-btn ${this.currentTab==='audio'?'active':''}"    onclick="App.switchTab('audio')">🎙️ Audio</button>
          <button class="tab-btn ${this.currentTab==='archivos'?'active':''}" onclick="App.switchTab('archivos')">📎 Archivos</button>
          <button class="tab-btn ${this.currentTab==='notas'?'active':''}"    onclick="App.switchTab('notas')">📝 Notas</button>
          <button class="tab-btn ${this.currentTab==='mapa'?'active':''}"     onclick="App.switchTab('mapa')">📍 Mapa</button>
        </div>
        <div id="tab-fotos"    class="tab-content ${this.currentTab==='fotos'   ?'active':''}"></div>
        <div id="tab-audio"    class="tab-content ${this.currentTab==='audio'   ?'active':''}"></div>
        <div id="tab-archivos" class="tab-content ${this.currentTab==='archivos'?'active':''}"></div>
        <div id="tab-notas"    class="tab-content ${this.currentTab==='notas'   ?'active':''}"></div>
        <div id="tab-mapa"     class="tab-content ${this.currentTab==='mapa'    ?'active':''}"></div>
      </div>
    `;
    await this.loadTabFotos(eventId);
    await this.loadTabAudio(eventId);
    await this.loadTabArchivos(eventId);
    await this.loadTabNotas(eventId);
    if (typeof Geo!=='undefined') await Geo.renderMapTab(eventId);
  },

  /* ─── Tabs de evento ─── */
  async loadTabFotos(eid) {
    const c=document.getElementById('tab-fotos'); if(!c) return;
    const media=await DB.getAll('media','eventId',eid).catch(()=>[]);
    c.innerHTML=`<div class="card mb-3"><div class="section-header mb-3"><div class="section-title">Fotos y vídeos</div><div style="display:flex;gap:8px"><button class="btn btn-primary" onclick="App.openCamera()">📷 Cámara</button><label class="btn btn-secondary" style="cursor:pointer">📁 Importar<input type="file" accept="image/*,video/*" multiple style="display:none" onchange="App.importMedia(event)"></label></div></div><div class="media-grid" id="media-grid"></div></div>`;
    const g=document.getElementById('media-grid');
    if (!media.length) g.innerHTML='<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-icon">📷</div><div class="empty-title">Sin fotos</div></div></div>';
    else media.forEach(m=>g.appendChild(this._buildMediaItem(m)));
  },

  async loadTabAudio(eid) {
    const c=document.getElementById('tab-audio'); if(!c) return;
    const audios=await DB.getAll('audios','eventId',eid).catch(()=>[]);
    c.innerHTML=`<div class="card mb-3"><div class="section-header mb-3"><div class="section-title">Grabaciones</div></div><div id="rec-indicator" style="display:none" class="recording-indicator"><div class="rec-dot"></div><span class="rec-label">Grabando...</span><span class="rec-timer" id="rec-timer">0:00</span></div><div style="display:flex;gap:10px;margin-bottom:16px"><button class="btn btn-primary" id="btn-record" onclick="App.toggleRecording()">🎙️ Grabar</button><label class="btn btn-secondary" style="cursor:pointer">📂 Importar<input type="file" accept="audio/*" multiple style="display:none" onchange="App.importAudio(event)"></label></div><div id="audio-list"></div></div>`;
    const list=document.getElementById('audio-list');
    audios.forEach(a=>list.appendChild(this._buildAudioItem(a)));
  },

  async loadTabArchivos(eid) {
    const c=document.getElementById('tab-archivos'); if(!c) return;
    const files=await DB.getAll('files','eventId',eid).catch(()=>[]);
    c.innerHTML=`<div class="card mb-3"><div class="section-header mb-3"><div class="section-title">Archivos adjuntos</div><label class="btn btn-primary" style="cursor:pointer">📎 Adjuntar<input type="file" multiple style="display:none" onchange="App.attachFiles(event)"></label></div><div class="capture-zone" onclick="this.querySelector('input').click()"><div class="capture-zone-icon">📁</div><div class="capture-zone-label">Arrastra archivos o haz clic</div><div class="capture-zone-sub">PDF, DWG, DXF, Excel, Word...</div><input type="file" multiple style="display:none" onchange="App.attachFiles(event)"></div><div id="files-list"></div></div>`;
    const list=document.getElementById('files-list');
    if (!files.length) list.innerHTML='<div class="empty-state" style="padding:20px"><div class="empty-icon">📎</div><div class="empty-sub">Sin archivos adjuntos</div></div>';
    else files.forEach(f=>list.appendChild(this._buildFileItem(f)));
    const zone=c.querySelector('.capture-zone');
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.style.borderColor='var(--cyan)';});
    zone.addEventListener('dragleave',()=>{zone.style.borderColor='';});
    zone.addEventListener('drop',e=>{e.preventDefault();zone.style.borderColor='';this.attachFiles({target:{files:e.dataTransfer.files}});});
  },

  async loadTabNotas(eid) {
    const c=document.getElementById('tab-notas'); if(!c) return;
    const notes=await DB.getAll('notes','eventId',eid).catch(()=>[]);
    const main=notes[0]||{content:''};
    c.innerHTML=`<div class="card mb-3">
      <div class="section-header mb-3">
        <div class="section-title">📝 Notas e informe</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span id="notes-wc" style="font-size:11px;color:var(--text3)"></span>
          <button class="btn btn-ghost btn-sm" onclick="App.copyNotes()" title="Copiar todo el texto">📋 Copiar</button>
          <button class="btn btn-primary btn-sm" onclick="App.saveNotes()">💾 Guardar</button>
        </div>
      </div>
      <div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="App.insertNoteTemplate('orden')">📋 Orden de trabajo</button>
        <button class="btn btn-ghost btn-sm" onclick="App.insertNoteTemplate('visita')">🏗️ Informe visita</button>
        <button class="btn btn-ghost btn-sm" onclick="App.insertNoteTemplate('acta')">🤝 Acta reunión</button>
        <button class="btn btn-ghost btn-sm" onclick="App.insertNoteFromTranscriptions()">🎙️ Desde audio</button>
        <button class="btn btn-ghost btn-sm" onclick="App.clearNotes()" style="color:var(--red)">🗑️ Borrar todo</button>
      </div>
      <textarea id="notes-area" class="notes-editor" placeholder="Escribe aquí las notas del evento..."
        oninput="App.updateNoteWordCount(this.value)">${main.content||''}</textarea>
    </div>`;
    this._currentNoteId=main.id;
    this.updateNoteWordCount(main.content||'');
  },

  updateNoteWordCount(text){
    const wc=document.getElementById('notes-wc');
    if(!wc)return;
    const words=(text.trim().match(/\S+/g)||[]).length;
    const chars=text.length;
    wc.textContent=`${words} palabras · ${chars} caracteres`;
  },

  async copyNotes(){
    const text=document.getElementById('notes-area')?.value||'';
    if(!text){Toast.show('No hay notas para copiar','error');return;}
    await navigator.clipboard.writeText(text).catch(()=>{});
    Toast.show('Notas copiadas al portapapeles','success');
  },

  async clearNotes(){
    if(!confirm('¿Borrar todas las notas? Esta acción no se puede deshacer.'))return;
    const area=document.getElementById('notes-area');
    if(area){area.value='';this.updateNoteWordCount('');}
    await this.saveNotes();
  },

  /* ─── Media helpers ─── */
  _buildMediaItem(m) {
    const div=document.createElement('div'); div.className='media-item'; div.id='media-'+m.id;
    const isV=m.type?.includes('video')||m.dataUrl?.startsWith('data:video');
    const date=m.createdAt?new Date(m.createdAt).toLocaleDateString('es-ES'):'';
    const gps=m.lat?` 📍${m.lat.toFixed(4)},${m.lng.toFixed(4)}`:'';
    const stamp=date||gps?`<div class="media-stamp">${date}${gps}</div>`:'';
    const actions=`<div class="media-item-actions">
      <button onclick="event.stopPropagation();App.downloadMedia('${m.id}')" title="Descargar">⬇️</button>
      <button onclick="event.stopPropagation();App.deleteMedia('${m.id}')" title="Eliminar">🗑️</button>
    </div>`;
    if (isV) div.innerHTML=`<video src="${m.dataUrl}" style="width:100%;height:100%;object-fit:cover" muted playsinline></video>${stamp}${actions}`;
    else { div.innerHTML=`<img src="${m.dataUrl}" alt="" loading="lazy">${stamp}${actions}`;
      div.addEventListener('click',e=>{if(!e.target.closest('.media-item-actions'))this.openLightbox(m.dataUrl,m);});
    }
    return div;
  },

  async downloadMedia(id) {
    const m=await DB.get('media',id); if(!m) return;
    const ext=m.type?.includes('video')?'webm':'jpg';
    const date=m.createdAt?new Date(m.createdAt).toISOString().slice(0,10):'foto';
    const a=document.createElement('a'); a.href=m.dataUrl; a.download=`foto_${date}.${ext}`; a.click();
  },
  openLightbox(src, m) {
    const lb=document.createElement('div'); lb.className='lightbox';
    const info = m ? `<div style="position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#fff;padding:6px 14px;border-radius:20px;font-size:12px;white-space:nowrap">
      ${m.createdAt?new Date(m.createdAt).toLocaleString('es-ES'):''}
      ${m.lat?` · 📍${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}`:''}
      <a href="https://www.google.com/maps?q=${m.lat},${m.lng}" target="_blank" style="color:#29b6c8;margin-left:8px">${m.lat?'Ver en mapa ↗':''}</a>
    </div>` : '';
    lb.innerHTML=`<button class="lightbox-close">×</button><img src="${src}">${info}
      <button style="position:absolute;top:16px;right:60px;background:rgba(0,0,0,.5);border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px" onclick="App.downloadMedia('${m?.id||''}')">⬇️ Descargar</button>`;
    lb.querySelector('.lightbox-close').onclick=()=>lb.remove();
    lb.onclick=e=>{if(e.target===lb)lb.remove();};
    document.body.appendChild(lb);
  },
  async deleteMedia(id){await DB.delete('media',id);document.getElementById('media-'+id)?.remove();},
  async importMedia(event){
    const files=Array.from(event.target.files);
    for(const file of files){
      const dataUrl=await this.compressImage(file);  // comprime automáticamente
      const pos=typeof Geo!=='undefined'?await Geo.getPhotoLocation().catch(()=>null):null;
      const m=await DB.put('media',{eventId:this.currentEventId,dataUrl,type:file.type,lat:pos?.lat,lng:pos?.lng});
      const g=document.getElementById('media-grid');if(g){if(g.querySelector('.empty-state'))g.innerHTML='';g.appendChild(this._buildMediaItem(m));}
    }
    Toast.show(`${files.length} archivo${files.length>1?'s':''} importado${files.length>1?'s':''}`, 'success');
  },

  /* ─── Audio helpers ─── */
  _buildAudioItem(a){
    const div=document.createElement('div');div.className='audio-item';div.id='audio-'+a.id;
    const date=a.createdAt?new Date(a.createdAt).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    div.innerHTML=`
      <div class="audio-controls">
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          <span style="font-size:22px">🎙️</span>
          ${date?`<span style="font-size:9px;color:var(--text3);text-align:center">${date}</span>`:''}
        </div>
        <audio controls class="audio-player" src="${a.dataUrl||''}"></audio>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button class="btn btn-ghost btn-icon btn-sm" onclick="App.downloadAudio('${a.id}')" title="Descargar">⬇️</button>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="App.deleteAudio('${a.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>
      <div class="${a.transcript?'audio-transcript':'audio-transcript empty'}" id="transcript-${a.id}">${a.transcript||'(Sin transcripción)'}</div>
      <div class="transcript-actions">
        <button class="btn btn-primary btn-sm" onclick="transcribirAudio('${a.id}')" title="Transcripción automática con IA">🤖 Transcribir</button>
        <button class="btn btn-secondary btn-sm" onclick="App.editTranscript('${a.id}')">✍️ Editar</button>
        ${a.transcript?`<button class="btn btn-ghost btn-sm" onclick="App.copyTranscript('${a.id}')">📋 Copiar</button>`:''}
      </div>`;
    return div;
  },

  async downloadAudio(id){
    const a=await DB.get('audios',id);if(!a)return;
    const date=a.createdAt?new Date(a.createdAt).toISOString().slice(0,10):'audio';
    const link=document.createElement('a');link.href=a.dataUrl;link.download=`audio_${date}.webm`;link.click();
  },

  async copyTranscript(id){
    const a=await DB.get('audios',id);if(!a||!a.transcript)return;
    await navigator.clipboard.writeText(a.transcript).catch(()=>{});
    Toast.show('Transcripción copiada al portapapeles','success');
  },
  _isRecording:false,_audioChunks:[],_audioRecorder:null,_recInterval:null,_recSecs:0,
  async toggleRecording(){if(this._isRecording)this._stopRec();else this._startRec();},
  async _startRec(){
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      this._audioChunks=[];this._audioRecorder=new MediaRecorder(stream);
      this._audioRecorder.ondataavailable=e=>{if(e.data.size>0)this._audioChunks.push(e.data);};
      this._audioRecorder.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop());
        const dataUrl=await this.fileToDataUrl(new Blob(this._audioChunks,{type:'audio/webm'}));
        const a=await DB.put('audios',{eventId:this.currentEventId,dataUrl,type:'audio/webm',transcript:''});
        const list=document.getElementById('audio-list');if(list)list.insertBefore(this._buildAudioItem(a),list.firstChild);
        Toast.show('Audio guardado','success');
      };
      this._audioRecorder.start(1000);this._isRecording=true;this._recSecs=0;
      document.getElementById('btn-record').textContent='⏹ Detener';document.getElementById('btn-record').className='btn btn-danger';
      document.getElementById('rec-indicator').style.display='flex';
      this._recInterval=setInterval(()=>{this._recSecs++;const t=document.getElementById('rec-timer');if(t)t.textContent=`${Math.floor(this._recSecs/60)}:${String(this._recSecs%60).padStart(2,'0')}`;},1000);
    }catch(e){Toast.show('No se pudo acceder al micrófono','error');}
  },
  _stopRec(){this._audioRecorder?.stop();this._isRecording=false;clearInterval(this._recInterval);const b=document.getElementById('btn-record');if(b){b.textContent='🎙️ Grabar';b.className='btn btn-primary';}document.getElementById('rec-indicator').style.display='none';},
  async editTranscript(audioId){
    const audio=await DB.get('audios',audioId);if(!audio)return;
    const div=document.getElementById('transcript-'+audioId);if(!div)return;
    div.textContent=audio.transcript||'';div.contentEditable='true';div.style.cssText='outline:2px solid var(--cyan);border-radius:4px;padding:6px;font-style:normal';div.focus();
    const old=div.nextElementSibling?.querySelector?.('.transcript-actions');
    const btn=document.createElement('button');btn.className='btn btn-primary btn-sm';btn.style.marginTop='6px';btn.textContent='💾 Guardar transcripción';
    btn.onclick=async()=>{const text=div.textContent.trim();div.contentEditable='false';div.style.cssText='';div.style.fontStyle=text?'normal':'italic';await DB.put('audios',{...audio,transcript:text});btn.remove();Toast.show('Transcripción guardada','success');};
    div.after(btn);
  },
  async importAudio(event){const files=Array.from(event.target.files);for(const f of files){const dataUrl=await this.fileToDataUrl(f);const a=await DB.put('audios',{eventId:this.currentEventId,dataUrl,type:f.type,transcript:'',filename:f.name});const list=document.getElementById('audio-list');if(list)list.insertBefore(this._buildAudioItem(a),list.firstChild);}Toast.show(`${files.length} audio${files.length>1?'s':''} importado${files.length>1?'s':''}`, 'success');},
  async deleteAudio(id){await DB.delete('audios',id);document.getElementById('audio-'+id)?.remove();},

  /* ─── Files helpers ─── */
  _buildFileItem(f){
    const div=document.createElement('div');div.className='file-item';div.id='file-'+f.id;
    div.innerHTML=`<div class="file-icon">${this.getFileIcon(f.name,f.type)}</div><div class="file-info"><div class="file-name">${f.name}</div><div class="file-size">${this.formatSize(f.size||0)}</div></div><div class="file-actions"><button class="btn btn-secondary btn-sm" onclick="App.downloadFile('${f.id}')">⬇️</button><button class="btn btn-ghost btn-sm" onclick="App.deleteFile('${f.id}')">🗑️</button></div>`;
    return div;
  },
  async attachFiles(event){
    const files=Array.from(event.target.files);const list=document.getElementById('files-list');
    if(list?.querySelector('.empty-state'))list.innerHTML='';
    for(const file of files){const dataUrl=await this.fileToDataUrl(file);const f=await DB.put('files',{eventId:this.currentEventId,name:file.name,type:file.type,size:file.size,dataUrl});if(list)list.appendChild(this._buildFileItem(f));}
    Toast.show(`${files.length} archivo${files.length>1?'s':''} adjuntado${files.length>1?'s':''}`, 'success');
  },
  async downloadFile(id){const f=await DB.get('files',id);if(!f)return;const a=document.createElement('a');a.href=f.dataUrl;a.download=f.name;a.click();},
  async deleteFile(id){await DB.delete('files',id);document.getElementById('file-'+id)?.remove();},

  /* ─── Notas helpers ─── */
  _currentNoteId:null,
  async saveNotes(){
    const content=document.getElementById('notes-area')?.value;const data={eventId:this.currentEventId,content};
    if(this._currentNoteId)data.id=this._currentNoteId;
    const saved=await DB.put('notes',data);this._currentNoteId=saved.id;Toast.show('Notas guardadas','success');
  },
  insertNoteTemplate(type){
    const area=document.getElementById('notes-area');if(!area)return;const date=new Date().toLocaleDateString('es-ES');
    const t={
      orden:`\n─── ORDEN DE TRABAJO ───────────────────\nFecha: ${date}\nObra: \nResponsable: \nPlazo: \n\nTRABAJOS:\n1. \n2. \n\nFirma: _______________\n`,
      visita:`\n─── INFORME VISITA DE OBRA ─────────────\nFecha: ${date}\nAsistentes: \n\nESTADO GENERAL:\n\nINCIDENCIAS:\n□ \n\nÓRDENES EMITIDAS:\n1. \n\nFirma: _______________\n`,
      acta:`\n─── ACTA DE REUNIÓN ────────────────────\nFecha: ${date}\nAsistentes:\n  - \n\nPUNTOS TRATADOS:\n1. \n\nACUERDOS:\n□ Resp: ___ Plazo: ___\n\nFirma: _______________\n`,
    };
    area.value+=t[type]||'';area.scrollTop=area.scrollHeight;
  },
  async insertNoteFromTranscriptions(){
    const audios=await DB.getAll('audios','eventId',this.currentEventId).catch(()=>[]);
    const trans=audios.filter(a=>a.transcript?.trim());
    if(!trans.length){Toast.show('No hay transcripciones','error');return;}
    const area=document.getElementById('notes-area');if(!area)return;
    area.value+='\n─── TRANSCRIPCIONES ────────────────────\n'+trans.map(a=>a.transcript).join('\n\n')+'\n';
    area.scrollTop=area.scrollHeight;
  },

  /* ─── Cámara ─── */
  openCamera(){
    const modal=this.createModal('Cámara','<video id="cam-stream" autoplay playsinline muted style="width:100%;border-radius:8px"></video><div class="camera-controls" style="margin-top:10px;display:flex;justify-content:center;gap:16px;align-items:center"><button class="btn btn-secondary btn-icon" onclick="App._flipCam()">🔄</button><div class="capture-btn" onclick="App.capturePhoto()"></div><button class="btn btn-secondary btn-icon" onclick="App.closeCamera()">✕</button></div><canvas id="cam-canvas" style="display:none"></canvas>','modal-lg');
    document.body.appendChild(modal);this._camFacing='environment';this._startCam();
  },
  async _startCam(){try{if(this.cameraStream)this.cameraStream.getTracks().forEach(t=>t.stop());this.cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:this._camFacing},audio:false});const v=document.getElementById('cam-stream');if(v)v.srcObject=this.cameraStream;}catch(e){Toast.show('No se pudo acceder a la cámara','error');}},
  _flipCam(){this._camFacing=this._camFacing==='environment'?'user':'environment';this._startCam();},
  async capturePhoto(){
    const video=document.getElementById('cam-stream'),canvas=document.getElementById('cam-canvas');if(!video||!canvas)return;
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
    // Comprimir foto de cámara: máx 1600px, calidad 0.82
    let dataUrl;
    if (canvas.width > 1600 || canvas.height > 1600) {
      const ratio = Math.min(1600/canvas.width, 1600/canvas.height);
      const c2 = document.createElement('canvas');
      c2.width  = Math.round(canvas.width  * ratio);
      c2.height = Math.round(canvas.height * ratio);
      c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
      dataUrl = c2.toDataURL('image/jpeg', 0.82);
    } else {
      dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    }
    const pos=typeof Geo!=='undefined'?await Geo.getPhotoLocation().catch(()=>null):null;
    const m=await DB.put('media',{eventId:this.currentEventId,dataUrl,type:'image/jpeg',lat:pos?.lat,lng:pos?.lng});
    const g=document.getElementById('media-grid');if(g){if(g.querySelector('.empty-state'))g.innerHTML='';g.appendChild(this._buildMediaItem(m));}
    const f=document.createElement('div');f.style.cssText='position:fixed;inset:0;background:#fff;opacity:.7;z-index:9999;pointer-events:none;transition:opacity .2s';document.body.appendChild(f);setTimeout(()=>{f.style.opacity='0';setTimeout(()=>f.remove(),200);},50);
    Toast.show('📷 Foto capturada','success');
  },
  closeCamera(){if(this.cameraStream){this.cameraStream.getTracks().forEach(t=>t.stop());this.cameraStream=null;}document.querySelector('.modal-backdrop')?.remove();},

  /* ─── Export ─── */
  async openEditEvent(eventId) {
    const ev = await DB.get('events', eventId);
    if (!ev) return;
    const [projects, allAgents] = await Promise.all([
      DB.getAll('projects').catch(()=>[]),
      DB.getAll('contacts').catch(()=>[]),
    ]);
    const projAgents  = allAgents.filter(a=>(a.projectIds||[]).includes(ev.projectId||''));
    const otherAgents = allAgents.filter(a=>!(a.projectIds||[]).includes(ev.projectId||''));

    // Init participants for editing
    this._epCurrent = [...(ev.participants||[])];
    this._epEventId = eventId;
    this._epAllAgents = allAgents;

    const buildBtn = (a) => {
      const sel = this._epCurrent.includes(a.name);
      return `<button class="btn btn-sm" id="ep-${a.id}"
        style="background:${sel?'var(--cyan)':'var(--surface2)'};border:1px solid ${sel?'var(--cyan)':'var(--border)'};
               color:${sel?'#141516':'var(--text)'};font-size:11px;text-transform:none;font-weight:${sel?700:'normal'}"
        onclick="App._toggleEP('${a.id}','${a.name}',this)">
        ${this._agentIcon(a.role)} ${a.name}
      </button>`;
    };

    const modal = this.createModal('✏️ Editar evento', `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="form-grid">
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Título *</label>
            <input id="ee-title" class="form-input" value="${(ev.title||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select id="ee-type" class="form-select">
              <option value="obra"    ${ev.type==='obra'?'selected':''}>🏗️ Visita de obra</option>
              <option value="reunion" ${ev.type==='reunion'?'selected':''}>🤝 Reunión</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Proyecto</label>
            <select id="ee-project" class="form-select">
              <option value="">— Sin proyecto —</option>
              ${projects.map(p=>`<option value="${p.id}" ${p.id===ev.projectId?'selected':''}>${p.nombre||p.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Fecha</label>
            <input id="ee-date" type="date" class="form-input" value="${ev.date||''}">
          </div>
          <div class="form-group">
            <label class="form-label">Hora</label>
            <input id="ee-time" type="time" class="form-input" value="${ev.time||''}">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Lugar</label>
            <input id="ee-location" class="form-input" value="${(ev.location||'').replace(/"/g,'&quot;')}">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label class="form-label">Descripción / objeto</label>
            <textarea id="ee-desc" class="form-textarea" style="min-height:70px">${ev.description||''}</textarea>
          </div>
        </div>

        <div>
          <label class="form-label">Participantes / asistentes</label>
          ${projAgents.length ? `
            <div style="font-size:10px;color:var(--cyan);margin-bottom:5px;font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.07em">Agentes del proyecto</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
              ${projAgents.map(buildBtn).join('')}
            </div>` : ''}
          ${otherAgents.length ? `
            <div style="font-size:10px;color:var(--text3);margin-bottom:5px;font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.07em">Otros agentes</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
              ${otherAgents.map(buildBtn).join('')}
            </div>` : ''}
          <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">
            <div style="font-size:10px;color:var(--text3);margin-bottom:5px;font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.07em">Añadir manualmente</div>
            <div style="display:flex;gap:8px">
              <input id="ep-manual-input" class="form-input" placeholder="Nombre libre..."
                onkeydown="if(event.key==='Enter'){App._addEPManual();event.preventDefault()}">
              <button class="btn btn-secondary" onclick="App._addEPManual()">＋</button>
            </div>
            <div id="ep-manual-list" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">
              ${this._epCurrent.filter(p=>!allAgents.find(a=>a.name===p)).map(p=>`
                <span class="chip chip-blue">👤 ${p}
                  <button onclick="App._removeEPManual('${p}',this.parentElement)" style="background:none;border:none;cursor:pointer;color:inherit;margin-left:4px">×</button>
                </span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `, 'modal-lg');

    modal.querySelector('.modal-footer').innerHTML = `
      <button class="btn btn-danger" style="margin-right:auto" onclick="document.querySelector('.modal-backdrop').remove();App.deleteEvent('${eventId}')">🗑️ Eliminar evento</button>
      <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="App.saveEditEvent('${eventId}')">💾 Guardar cambios</button>
    `;
    document.body.appendChild(modal);
  },

  async saveEditEvent(eventId) {
    const ev = await DB.get('events', eventId); if (!ev) return;
    const projId = document.getElementById('ee-project')?.value || ev.projectId;
    const proj   = projId ? await DB.get('projects', projId) : null;
    await DB.put('events', {
      ...ev,
      title:        document.getElementById('ee-title')?.value?.trim()    || ev.title,
      type:         document.getElementById('ee-type')?.value             || ev.type,
      date:         document.getElementById('ee-date')?.value             || ev.date,
      time:         document.getElementById('ee-time')?.value             || ev.time,
      location:     document.getElementById('ee-location')?.value?.trim() || ev.location,
      description:  document.getElementById('ee-desc')?.value?.trim()    || ev.description,
      projectId:    projId,
      project:      proj?.nombre || proj?.name || ev.project,
      participants: [...this._epCurrent],
    });
    document.querySelector('.modal-backdrop')?.remove();
    Toast.show('Evento actualizado ✓', 'success');
    this.navigate('event-detail', eventId);
  },

  async openEditParticipants(eventId) {
    const ev = await DB.get('events', eventId);
    if (!ev) return;
    const allAgents = await DB.getAll('contacts').catch(()=>[]);
    const projAgents  = allAgents.filter(a => (a.projectIds||[]).includes(ev.projectId||''));
    const otherAgents = allAgents.filter(a => !(a.projectIds||[]).includes(ev.projectId||''));

    // Current participants
    let current = [...(ev.participants||[])];

    const buildAgentBtn = (a) => {
      const selected = current.includes(a.name);
      return `<button class="btn btn-sm" id="ep-${a.id}"
        style="background:${selected?'var(--cyan)':'var(--surface2)'};
               border:1px solid ${selected?'var(--cyan)':'var(--border)'};
               color:${selected?'#141516':'var(--text)'};
               font-size:11px;text-transform:none;font-weight:${selected?'700':'normal'}"
        onclick="App._toggleEP('${a.id}','${a.name}',this)">
        ${this._agentIcon(a.role)} ${a.name}
      </button>`;
    };

    const modal = this.createModal('Participantes / Asistentes', `
      <div style="margin-bottom:12px">
        ${projAgents.length ? `
          <div style="font-size:10px;color:var(--cyan);margin-bottom:6px;font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.07em">Agentes del proyecto</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">
            ${projAgents.map(buildAgentBtn).join('')}
          </div>` : ''}
        ${otherAgents.length ? `
          <div style="font-size:10px;color:var(--text3);margin-bottom:6px;font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.07em">Otros agentes</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">
            ${otherAgents.map(buildAgentBtn).join('')}
          </div>` : ''}
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:6px;font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.07em">Añadir manualmente (nombre libre)</div>
          <div style="display:flex;gap:8px">
            <input id="ep-manual-input" class="form-input" placeholder="Nombre del asistente..."
              onkeydown="if(event.key==='Enter'){App._addEPManual();event.preventDefault()}">
            <button class="btn btn-secondary" onclick="App._addEPManual()">＋</button>
          </div>
          <div id="ep-manual-list" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">
            ${current.filter(p => !allAgents.find(a=>a.name===p)).map(p=>`
              <span class="chip chip-blue" id="ep-manual-${p.replace(/[^a-z0-9]/gi,'_')}">
                👤 ${p}
                <button onclick="App._removeEPManual('${p}',this.parentElement)" style="background:none;border:none;cursor:pointer;color:inherit;margin-left:4px">×</button>
              </span>`).join('')}
          </div>
        </div>
      </div>
    `);

    // Store current state for save
    this._epCurrent = current;
    this._epEventId = eventId;
    this._epAllAgents = allAgents;

    modal.querySelector('.modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="App.saveParticipants()">💾 Guardar participantes</button>
    `;
    document.body.appendChild(modal);
  },

  _epCurrent: [], _epEventId: null, _epAllAgents: [],

  _toggleEP(agentId, name, btn) {
    const idx = this._epCurrent.indexOf(name);
    if (idx >= 0) {
      this._epCurrent.splice(idx, 1);
      btn.style.background = 'var(--surface2)';
      btn.style.borderColor = 'var(--border)';
      btn.style.color = 'var(--text)';
      btn.style.fontWeight = 'normal';
    } else {
      this._epCurrent.push(name);
      btn.style.background = 'var(--cyan)';
      btn.style.borderColor = 'var(--cyan)';
      btn.style.color = '#141516';
      btn.style.fontWeight = '700';
    }
  },

  _addEPManual() {
    const input = document.getElementById('ep-manual-input');
    const val = (input?.value||'').trim(); if (!val) return;
    if (!this._epCurrent.includes(val)) {
      this._epCurrent.push(val);
      const list = document.getElementById('ep-manual-list');
      if (list) {
        const chip = document.createElement('span');
        chip.className = 'chip chip-blue';
        chip.innerHTML = `👤 ${val}<button onclick="App._removeEPManual('${val}',this.parentElement)" style="background:none;border:none;cursor:pointer;color:inherit;margin-left:4px">×</button>`;
        list.appendChild(chip);
      }
    }
    if (input) input.value = '';
  },

  _removeEPManual(name, chip) {
    const idx = this._epCurrent.indexOf(name);
    if (idx >= 0) this._epCurrent.splice(idx, 1);
    chip?.remove();
  },

  async saveParticipants() {
    const ev = await DB.get('events', this._epEventId); if (!ev) return;
    await DB.put('events', { ...ev, participants: [...this._epCurrent] });
    document.querySelector('.modal-backdrop')?.remove();
    Toast.show('Participantes guardados ✓', 'success');
    // Refresh event detail
    this.navigate('event-detail', this._epEventId);
  },

  async openExportModal(){
    const modal=this.createModal('Exportar / Compartir',`
      <div class="export-grid">
        <div class="export-option" onclick="App.exportZIP()"><div class="export-option-icon">🗜️</div><div class="export-option-label">ZIP completo</div></div>
        <div class="export-option" onclick="App.exportPDF()"><div class="export-option-icon">📄</div><div class="export-option-label">Informe PDF</div></div>
        <div class="export-option" onclick="App.openEmailComposer()"><div class="export-option-icon">📧</div><div class="export-option-label">Redactar y enviar</div></div>
        <div class="export-option" onclick="App.shareWhatsApp()"><div class="export-option-icon">💬</div><div class="export-option-label">WhatsApp</div></div>
      </div>
    `,'modal-lg');
    document.body.appendChild(modal);
  },

  async openEmailComposer() {
    document.querySelector('.modal-backdrop')?.remove();
    const ev      = await DB.get('events', this.currentEventId);
    const notes   = await DB.getAll('notes','eventId',this.currentEventId).catch(()=>[]);
    const allAgents = await DB.getAll('contacts').catch(()=>[]);
    const project = ev.projectId ? await DB.get('projects', ev.projectId) : null;
    const dateStr = ev.date ? new Date(ev.date+'T00:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '—';

    // Build suggested recipients: participants first, then all agents with email
    const participants = ev.participants||[];
    const agentsWithEmail = allAgents.filter(a=>a.email);
    // Group: participants con email, participantes sin email, resto de agentes con email
    const partWithEmail  = agentsWithEmail.filter(a=>participants.includes(a.name));
    const partNoEmail    = participants.filter(p=>!allAgents.find(a=>a.name===p&&a.email));
    const otherWithEmail = agentsWithEmail.filter(a=>!participants.includes(a.name));

    // Default subject and body
    const defaultSubject = `${ev.type==='obra'?'Informe visita de obra':'Acta de reunión'}: ${ev.title}`;
    const defaultBody =
      `Estimados/as,

Les remitimos el ${ev.type==='obra'?'informe de visita de obra':'acta de reunión'}:

` +
      `📋 ${ev.title}
📅 ${dateStr}
📍 ${ev.location||'—'}
🏗️ Proyecto: ${ev.project||'—'}
` +
      (project?.referencia?`📁 Expediente: ${project.referencia}
`:'') +
      `
Asistentes: ${participants.join(', ')||'—'}

` +
      `─────────────────────────────
${notes[0]?.content||'(Sin notas)'}
─────────────────────────────

` +
      `Quedamos a su disposición.

Un saludo,

Antalavera Arquitectura
antalavera@antalaveraarquitectura.com · 675 93 18 74`;

    // Initialize recipients list
    this._emailTo = [];

    const modal = this.createModal('📧 Redactar email', `
      <div style="display:flex;flex-direction:column;gap:12px">

        <!-- TO field -->
        <div class="form-group">
          <label class="form-label">Para (destinatarios)</label>
          <div id="email-to-chips" style="display:flex;flex-wrap:wrap;gap:5px;min-height:32px;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px"></div>
          <div style="display:flex;gap:6px">
            <input id="email-to-input" class="form-input" placeholder="email@ejemplo.com o nombre del agente"
              list="email-agents-datalist"
              onkeydown="if(event.key==='Enter'||event.key===','){App._addEmailTo();event.preventDefault()}">
            <datalist id="email-agents-datalist">
              ${agentsWithEmail.map(a=>`<option value="${a.email}" label="${a.name}">`).join('')}
            </datalist>
            <button class="btn btn-secondary" onclick="App._addEmailTo()">＋</button>
          </div>
        </div>

        <!-- Sugerencias rápidas -->
        <div>
          <div style="font-size:10px;color:var(--text3);font-family:var(--font-cond);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Añadir rápido</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${partWithEmail.map(a=>`
              <button class="btn btn-sm" style="font-size:11px;text-transform:none;background:var(--surface2);border:1px solid var(--cyan)"
                onclick="App._addEmailChip('${a.email}','${a.name}',this)">
                📧 ${a.name}
              </button>`).join('')}
            ${partNoEmail.map(p=>`
              <span class="chip chip-orange" title="Sin email registrado" style="font-size:10px">⚠️ ${p}</span>`).join('')}
            ${otherWithEmail.length ? `
              <details style="width:100%">
                <summary style="font-size:11px;color:var(--text3);cursor:pointer;margin-top:4px">Más agentes (${otherWithEmail.length})</summary>
                <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
                  ${otherWithEmail.map(a=>`
                    <button class="btn btn-sm" style="font-size:11px;text-transform:none;background:var(--surface2)"
                      onclick="App._addEmailChip('${a.email}','${a.name}',this)">
                      📧 ${a.name}
                    </button>`).join('')}
                </div>
              </details>` : ''}
          </div>
        </div>

        <!-- Subject -->
        <div class="form-group">
          <label class="form-label">Asunto</label>
          <input id="email-subject" class="form-input" value="${defaultSubject.replace(/"/g,'&quot;')}">
        </div>

        <!-- Body -->
        <div class="form-group">
          <label class="form-label">Cuerpo del mensaje</label>
          <textarea id="email-body" class="form-textarea" style="min-height:200px;font-family:var(--mono);font-size:12px">${defaultBody.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
        </div>

      </div>
    `, 'modal-lg');

    modal.querySelector('.modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="App._sendEmail()">📧 Abrir en cliente de correo</button>
    `;
    document.body.appendChild(modal);

    // Auto-add participants with email
    partWithEmail.forEach(a => this._addEmailChip(a.email, a.name, null));
  },

  _emailTo: [],

  _addEmailTo() {
    const input = document.getElementById('email-to-input');
    const val = (input?.value||'').trim(); if (!val) return;
    // Accept email directly or match agent name
    const allAgents = this._epAllAgents || [];
    const agent = allAgents.find(a=>a.name===val||a.email===val);
    const email = agent?.email || (val.includes('@') ? val : null);
    const label = agent?.name || val;
    if (email) this._addEmailChip(email, label, null);
    else if (val.includes('@')) this._addEmailChip(val, val, null);
    else { Toast.show('Introduce un email válido o selecciona un agente', 'error'); return; }
    if (input) input.value = '';
  },

  _addEmailChip(email, label, btn) {
    if (this._emailTo.includes(email)) return;
    this._emailTo.push(email);
    if (btn) { btn.style.background='var(--cyan)'; btn.style.color='#141516'; btn.disabled=true; }
    const chips = document.getElementById('email-to-chips');
    if (chips) {
      const chip = document.createElement('span');
      chip.className = 'chip chip-blue';
      chip.style.cursor = 'pointer';
      chip.title = email;
      chip.innerHTML = `📧 ${label} <span style="opacity:.6;margin-left:4px">×</span>`;
      chip.onclick = () => {
        const idx = this._emailTo.indexOf(email);
        if (idx>=0) this._emailTo.splice(idx,1);
        if (btn) { btn.style.background='var(--surface2)'; btn.style.color='var(--text)'; btn.disabled=false; }
        chip.remove();
      };
      chips.appendChild(chip);
    }
  },

  _sendEmail() {
    const to      = this._emailTo.join(',');
    const subject = encodeURIComponent(document.getElementById('email-subject')?.value||'');
    const body    = encodeURIComponent(document.getElementById('email-body')?.value||'');
    if (!to) { Toast.show('Añade al menos un destinatario', 'error'); return; }
    document.querySelector('.modal-backdrop')?.remove();
    window.open(`mailto:${to}?subject=${subject}&body=${body}`);
    Toast.show('Abriendo cliente de correo...', 'success');
  },

  async exportZIP(){
    document.querySelector('.modal-backdrop')?.remove();
    Toast.show('Generando ZIP...');
    const ev=await DB.get('events',this.currentEventId);
    const [media,audios,files,notes]=await Promise.all([DB.getAll('media','eventId',this.currentEventId),DB.getAll('audios','eventId',this.currentEventId),DB.getAll('files','eventId',this.currentEventId),DB.getAll('notes','eventId',this.currentEventId)]);
    if(!window.JSZip)await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip=new JSZip();const fn=`${ev.project?ev.project+'_':''}${this.slugify(ev.title)}_${ev.date||'sin-fecha'}`;const folder=zip.folder(fn);
    folder.file('acta.txt',`EVENTO: ${ev.title}\nTipo: ${ev.type==='obra'?'Visita de obra':'Reunión'}\nFecha: ${ev.date||'—'}\nLugar: ${ev.location||'—'}\nProyecto: ${ev.project||'—'}\nParticipantes: ${(ev.participants||[]).join(', ')||'—'}\n`);
    if(notes[0]?.content)folder.file('notas.txt',notes[0].content);
    const trans=audios.filter(a=>a.transcript?.trim());
    if(trans.length)folder.file('transcripciones.txt',trans.map((a,i)=>`--- Audio ${i+1} ---\n${a.transcript}`).join('\n\n'));
    const pf=folder.folder('fotos');for(let i=0;i<media.length;i++){const b=media[i].dataUrl?.split(',')[1];if(b)pf.file(`foto_${String(i+1).padStart(3,'0')}.${media[i].type?.includes('video')?'webm':'jpg'}`,b,{base64:true});}
    const af=folder.folder('audios');for(let i=0;i<audios.length;i++){const b=audios[i].dataUrl?.split(',')[1];if(b)af.file(`audio_${String(i+1).padStart(3,'0')}.webm`,b,{base64:true});}
    const ff=folder.folder('archivos');for(const f of files){const b=f.dataUrl?.split(',')[1];if(b)ff.file(f.name,b,{base64:true});}
    const blob=await zip.generateAsync({type:'blob'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=fn+'.zip';a.click();
    Toast.show('ZIP descargado ✓','success');
  },

  async shareEmail(){
    document.querySelector('.modal-backdrop')?.remove();
    const ev=await DB.get('events',this.currentEventId);const notes=await DB.getAll('notes','eventId',this.currentEventId).catch(()=>[]);
    window.open(`mailto:?subject=${encodeURIComponent((ev.type==='obra'?'Informe visita: ':'Acta reunión: ')+ev.title)}&body=${encodeURIComponent(`${ev.title}\nFecha: ${ev.date||'—'}\nLugar: ${ev.location||'—'}\n\n${notes[0]?.content||''}\n\n— Antalavera Arquitectura`)}`);
  },

  async shareWhatsApp(){
    document.querySelector('.modal-backdrop')?.remove();
    const ev=await DB.get('events',this.currentEventId);const notes=await DB.getAll('notes','eventId',this.currentEventId).catch(()=>[]);
    window.open(`https://wa.me/?text=${encodeURIComponent(`*${ev.type==='obra'?'🏗️ VISITA DE OBRA':'🤝 REUNIÓN'}*\n*${ev.title}*\n📅 ${ev.date||'—'}\n📍 ${ev.location||'—'}\n\n${(notes[0]?.content||'').slice(0,400)}\n\n_Antalavera Arquitectura_`)}`);
  },

  async exportPDF(){
    await generateAndDownloadPDF(App.currentEventId);
  },

  /* ─── Utilidades ─── */
  _agentColor(role){return{'Promotor':'#f5c518','Proyectista':'#29b6c8','Director de Obra':'#29b6c8','Director de Ejecución':'#00d4aa','Coordinador de Seguridad y Salud':'#f59e0b','Otros Técnicos':'#60a5fa','Contratista':'#c8302a','Subcontrata':'#e87070','Suministrador':'#a78bfa','Administración':'#8b5cf6'}[role]||'#5c6370';},
  _agentIcon(role){return{'Promotor':'💼','Proyectista':'📐','Director de Obra':'🏗️','Director de Ejecución':'📋','Coordinador de Seguridad y Salud':'⛑️','Contratista':'🔨','Subcontrata':'🔧','Suministrador':'📦'}[role]||'👤';},

  createModal(title, bodyHtml, extraClass=''){
    const bd=document.createElement('div');bd.className='modal-backdrop';
    bd.onclick=e=>{if(e.target===bd)bd.remove();};
    bd.innerHTML=`<div class="modal ${extraClass}"><div class="modal-header"><div class="modal-title">${title}</div><button class="btn btn-ghost btn-icon" onclick="document.querySelector('.modal-backdrop').remove()">✕</button></div><div class="modal-body">${bodyHtml}</div><div class="modal-footer"></div></div>`;
    return bd;
  },

  fileToDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(file);});},

  /* Comprime imagen a máx 1600px y calidad 0.82 — mantiene vídeos sin tocar */
  async compressImage(file, maxPx=1600, quality=0.82) {
    // Solo imágenes, no vídeos ni PDFs
    if (!file.type?.startsWith('image/')) return this.fileToDataUrl(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        // Escalar si supera maxPx
        if (width > maxPx || height > maxPx) {
          const ratio = Math.min(maxPx/width, maxPx/height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = url;
    });
  },
  formatSize(b){if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';return(b/1048576).toFixed(1)+'MB';},

  /* Formatea euros: XX.XXX.XXX,YY € */
  formatEUR(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return '—';
    return n.toLocaleString('es-ES', {
      style:           'currency',
      currency:        'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  },

  /* Input de importe: formatea al salir del campo */
  formatInputEUR(input) {
    const raw = input.value.replace(/[^\d,\.]/g, '').replace(',', '.');
    const n   = parseFloat(raw);
    if (!isNaN(n)) {
      input.dataset.value = n;          // guarda valor numérico real
      input.value         = n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  },

  /* Parsea un campo de importe formateado a número */
  parseEUR(input) {
    // Si tiene dataset.value lo usa, si no parsea el texto
    if (input?.dataset?.value) return parseFloat(input.dataset.value);
    const v = (input?.value || '').replace(/\./g, '').replace(',', '.');
    return parseFloat(v) || 0;
  },
  slugify(s){return(s||'evento').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40);},
  getFileIcon(name=''){const e=(name.split('.').pop()||'').toLowerCase();return{pdf:'📄',dwg:'📐',dxf:'📐',xlsx:'📊',xls:'📊',csv:'📊',docx:'📝',doc:'📝',jpg:'🖼️',jpeg:'🖼️',png:'🖼️',webp:'🖼️',mp4:'🎬',mov:'🎬',webm:'🎬',mp3:'🎵',wav:'🎵',m4a:'🎵'}[e]||'📎';},
  loadScript(src){return new Promise((res,rej)=>{if(document.querySelector(`script[src="${src}"]`)){res();return;}const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);});},
  checkInstallPrompt(){let dp;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();dp=e;const b=document.getElementById('install-btn');if(b){b.style.display='flex';b.onclick=()=>{dp.prompt();dp.userChoice.then(()=>b.style.display='none');};}});},
};

/* ── Toast ── */
const Toast={
  container:null,
  show(msg,type=''){
    if(!this.container){this.container=document.createElement('div');this.container.className='toast-container';document.body.appendChild(this.container);}
    const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=msg;
    this.container.appendChild(t);setTimeout(()=>t.remove(),3500);
  }
};

/* ── Herramienta de diagnóstico / limpieza de datos ── */
window.ObraAppDiag = {
  async listarTodo() {
    const [p, e, m, a, f, n, c] = await Promise.all([
      DB.getAll('projects'), DB.getAll('events'), DB.getAll('media'),
      DB.getAll('audios'), DB.getAll('files'), DB.getAll('notes'), DB.getAll('contacts')
    ]);
    console.table({ proyectos: p.length, eventos: e.length, fotos: m.length,
      audios: a.length, archivos: f.length, notas: n.length, contactos: c.length });
    console.log('Proyectos:', p.map(x=>({id:x.id, nombre:x.nombre||x.name})));
    console.log('Eventos:', e.map(x=>({id:x.id, titulo:x.title, proyecto:x.project, fecha:x.date})));
    return { proyectos:p, eventos:e };
  },
  async borrarEvento(id) {
    await DB.delete('events', id);
    console.log('Evento borrado:', id);
  },
  async borrarProyecto(id) {
    await DB.delete('projects', id);
    console.log('Proyecto borrado:', id);
  },
  async limpiarHuerfanos() {
    const proyectos = await DB.getAll('projects');
    const pIds = new Set(proyectos.map(p=>p.id));
    const eventos = await DB.getAll('events');
    let borrados = 0;
    for (const ev of eventos) {
      if (ev.projectId && !pIds.has(ev.projectId)) {
        await DB.delete('events', ev.id);
        borrados++;
        console.log('Evento huerfano borrado:', ev.title, ev.date);
      }
    }
    console.log('Limpieza completada. Borrados:', borrados, 'eventos huerfanos');
    Toast.show('Limpieza: ' + borrados + ' elementos huérfanos eliminados', 'success');
    return borrados;
  }
};

// Global error handler - evita que errores puntuales cierren la app
window.addEventListener('error', (e) => {
  console.error('Error global:', e.message, e.filename, e.lineno);
  // Solo mostrar toast si no es un error de red
  if (!e.message?.includes('fetch') && !e.message?.includes('network')) {
    Toast.show('Error: ' + (e.message||'desconocido') + ' — la app sigue funcionando', 'error');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Promise error:', e.reason);
  e.preventDefault(); // evita que aparezca en consola como error fatal
});

window.addEventListener('DOMContentLoaded',()=>App.init());
