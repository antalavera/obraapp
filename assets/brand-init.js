/* ═══════════════════════════════════════════════════════════
   ANTALAVERA — Brand init, pre-config y módulo de email
   ═══════════════════════════════════════════════════════════ */

/* ─── Pre-configurar perfil del estudio si está vacío ─── */
(function seedStudioProfile() {
  const existing = localStorage.getItem('estudio_perfil');
  if (existing) {
    try { if (JSON.parse(existing).nombre) return; } catch {}
  }
  const defaults = {
    nombre: 'Antalavera Arquitectura',
    cif: '',
    direccion: 'Pza. Siete Revueltas nº21 A · 41620 Marchena (Sevilla)\nC/ Céspedes nº19 Bloque 4 Bajo A · 41004 Sevilla',
    telefono: '675 93 18 74',
    email: 'antalavera@antalaverarquitectura.com',
    web: 'antalaverarquitectura.com',
    firmante: 'Antonio Talavera Ramos',
    rol: 'Arquitecto',
    nif: '',
    colegio: 'COAAO — Colegio Oficial de Arquitectos de Andalucía Occidental',
    numColegiado: '',
  };
  localStorage.setItem('estudio_perfil', JSON.stringify(defaults));
  window.studioPerfil = defaults;
})();

/* ─── Colores corporativos para PDF ─── */
const BRAND = {
  dark:    [22, 23, 24],
  cyan:    [41, 182, 200],
  yellow:  [245, 197, 24],
  red:     [200, 48, 42],
  blue:    [40, 89, 168],
  white:   [240, 240, 240],
  gray:    [61, 66, 74],
};

/* ═══════════════════════════════════════════════════════════
   MÓDULO EMAIL — Envío desde la app
   Soporta: mailto: (universal) + Gmail API (si está conectado)
   ═══════════════════════════════════════════════════════════ */
const Email = {

  /* ─── Abrir modal de composición ─── */
  async openComposer(opts = {}) {
    const { eventId, subject: defSubject, body: defBody, attachments: defAttach } = opts;
    const ev = eventId ? await DB.get('events', eventId) : null;
    const contacts = await DB.getAll('contacts') || [];
    const estudio = Estudio.load();

    // Preparar lista de contactos rápidos del evento
    const eventContacts = ev?.participants || [];
    // Más contactos de la agenda asociados al proyecto del evento
    const projectContacts = contacts.filter(c => !ev || !ev.project || c.project === ev.project || !c.project);

    const allContacts = [...new Set([...eventContacts, ...projectContacts.map(c => `${c.name} <${c.email}>`)])].filter(Boolean);

    const dateStr = ev?.date ? new Date(ev.date + 'T00:00:00').toLocaleDateString('es-ES') : new Date().toLocaleDateString('es-ES');
    const defaultSubject = defSubject || (ev ? `${ev.type === 'obra' ? 'Informe visita de obra' : 'Acta de reunión'}: ${ev.title} — ${dateStr}` : 'Antalavera Arquitectura');
    const defaultBody = defBody || (ev ? this.buildEmailBody(ev, estudio) : '');

    const modal = App.createModal('📧 Enviar por email', `
      <div class="form-group">
        <label class="form-label">Para (destinatario)</label>
        <div id="to-chips" class="participant-list" style="min-height:32px"></div>
        <div style="display:flex;gap:8px">
          <input id="email-to-input" class="form-input" placeholder="nombre@email.com o selecciona de contactos"
            list="contacts-datalist" autocomplete="email"
            onkeydown="if(event.key==='Enter'||event.key===','){Email.addToRecipient();event.preventDefault()}">
          <button class="btn btn-secondary btn-sm" onclick="Email.addToRecipient()">＋</button>
        </div>
        <datalist id="contacts-datalist">
          ${allContacts.map(c => `<option value="${c}">`).join('')}
          ${contacts.map(c => c.email ? `<option value="${c.email}" label="${c.name}">` : '').join('')}
        </datalist>
        ${allContacts.length > 0 ? `
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
          ${allContacts.slice(0,8).map(c => `
            <button class="btn btn-sm" style="font-size:10px;padding:2px 7px;background:var(--surface3);border:1px solid var(--border-cyan);color:var(--cyan);text-transform:none"
              onclick="Email.addRecipientQuick('${c.replace(/'/g,"\\'")}')">
              ${c.split('<')[0].trim() || c}
            </button>`).join('')}
        </div>` : ''}
      </div>
      <div class="form-group">
        <label class="form-label">CC (opcional)</label>
        <input id="email-cc" class="form-input" placeholder="copia@email.com" list="contacts-datalist">
      </div>
      <div class="form-group">
        <label class="form-label">Asunto</label>
        <input id="email-subject" class="form-input" value="${defaultSubject.replace(/"/g,'&quot;')}">
      </div>
      <div class="form-group">
        <label class="form-label">Cuerpo del mensaje</label>
        <textarea id="email-body" class="form-textarea" style="min-height:180px;font-family:var(--font);font-size:13px">${defaultBody}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Adjuntos</label>
        <div id="attachments-list" style="margin-bottom:8px"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${ev ? `
          <button class="btn btn-secondary btn-sm" onclick="Email.attachEventPDF('${eventId}')">📄 Adjuntar informe PDF</button>
          <button class="btn btn-secondary btn-sm" onclick="Email.attachEventPhotos('${eventId}')">📷 Adjuntar fotos</button>
          <button class="btn btn-secondary btn-sm" onclick="Email.attachEventFiles('${eventId}')">📎 Adjuntar archivos</button>` : ''}
          <label class="btn btn-secondary btn-sm" style="cursor:pointer">
            📁 Adjuntar archivo...
            <input type="file" multiple style="display:none" onchange="Email.attachManual(event)">
          </label>
        </div>
      </div>
      <div id="email-size-warning" style="display:none;font-size:12px;color:var(--amber);margin-top:6px">
        ⚠️ Los adjuntos son grandes. Recomendamos enviar el PDF del informe + enlace a Drive en lugar de todas las fotos.
      </div>
    `, 'modal-lg');

    modal.querySelector('.modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
      <button class="btn btn-secondary" onclick="Email.sendMailto()">📧 Abrir en correo</button>
      ${DriveSync?.isConnected() ? `<button class="btn btn-primary" onclick="Email.sendGmail()">✈️ Enviar con Gmail</button>` : `<button class="btn btn-primary" onclick="Email.sendMailto()">✈️ Enviar</button>`}
    `;
    document.body.appendChild(modal);
    this._recipients = [];
    this._attachmentFiles = [];
  },

  buildEmailBody(ev, estudio) {
    const d = estudio || {};
    const date = ev.date ? new Date(ev.date + 'T00:00:00').toLocaleDateString('es-ES', {weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '—';
    return `Estimado/a,

Adjunto encontrará el ${ev.type === 'obra' ? 'informe de visita de obra' : 'acta de la reunión'} celebrada el ${date}${ev.location ? ' en ' + ev.location : ''}.

${ev.description ? 'OBJETO: ' + ev.description + '\n' : ''}
Para cualquier consulta, no dude en contactar con nosotros.

Un cordial saludo,

${d.firmante || 'Antonio Talavera Ramos'}
${d.rol || 'Arquitecto'}${d.numColegiado ? ' · Colegiado nº ' + d.numColegiado : ''}
${d.colegio ? d.colegio + '\n' : ''}
${d.nombre || 'Antalavera Arquitectura'}
${d.telefono ? 'Tel: ' + d.telefono : ''}
${d.email || 'antalavera@antalaverarquitectura.com'}
${d.web ? d.web : ''}

Este mensaje y sus adjuntos son confidenciales y se dirigen exclusivamente a su destinatario.`;
  },

  _recipients: [],
  _attachmentFiles: [],

  addToRecipient() {
    const input = document.getElementById('email-to-input');
    const val = input.value.trim();
    if (!val) return;
    // Basic validation
    if (!val.includes('@') && !val.includes('<')) { Toast.show('Email no válido', 'error'); return; }
    this._recipients.push(val);
    input.value = '';
    this.renderRecipients();
  },

  addRecipientQuick(val) {
    if (this._recipients.includes(val)) return;
    this._recipients.push(val);
    this.renderRecipients();
  },

  removeRecipient(i) { this._recipients.splice(i, 1); this.renderRecipients(); },

  renderRecipients() {
    const el = document.getElementById('to-chips');
    if (!el) return;
    el.innerHTML = this._recipients.map((r, i) => `
      <div class="participant-chip">${r}<button onclick="Email.removeRecipient(${i})">×</button></div>
    `).join('');
  },

  async attachEventPDF(eventId) {
    Toast.show('Generando PDF...');
    // Generate PDF blob using existing App.exportPDF logic but return blob
    await App.exportPDF(); // for now triggers download — TODO: capture blob for inline attach
    Toast.show('PDF generado. Adjúntalo manualmente con el botón de archivo.', 'success');
  },

  async attachEventPhotos(eventId) {
    const media = (await DB.getAll('media', 'eventId', eventId)).filter(m => !m.type?.includes('video'));
    for (const m of media.slice(0, 5)) {
      const binary = atob(m.dataUrl.split(',')[1]);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      const blob = new Blob([arr], { type: 'image/jpeg' });
      const file = new File([blob], `foto_${Date.now()}.jpg`, { type: 'image/jpeg' });
      this._attachmentFiles.push(file);
    }
    this.renderAttachments();
    if (media.length > 5) Toast.show(`Se adjuntan 5 de ${media.length} fotos (límite email)`);
  },

  async attachEventFiles(eventId) {
    const files = (await DB.getAll('files', 'eventId', eventId)).filter(f => !f._isSig);
    for (const f of files) {
      const binary = atob(f.dataUrl.split(',')[1]);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      const blob = new Blob([arr], { type: f.type });
      const file = new File([blob], f.name, { type: f.type });
      this._attachmentFiles.push(file);
    }
    this.renderAttachments();
  },

  attachManual(event) {
    this._attachmentFiles.push(...Array.from(event.target.files));
    this.renderAttachments();
  },

  renderAttachments() {
    const el = document.getElementById('attachments-list');
    if (!el) return;
    const totalSize = this._attachmentFiles.reduce((s, f) => s + f.size, 0);
    el.innerHTML = this._attachmentFiles.map((f, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--surface3);border-radius:4px;margin-bottom:4px;font-size:12px">
        <span>${App.getFileIcon(f.name, f.type)}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
        <span style="color:var(--text3);font-family:var(--mono)">${App.formatSize(f.size)}</span>
        <button onclick="Email.removeAttachment(${i})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:15px">×</button>
      </div>`).join('');
    const warn = document.getElementById('email-size-warning');
    if (warn) warn.style.display = totalSize > 5 * 1024 * 1024 ? 'block' : 'none';
  },

  removeAttachment(i) { this._attachmentFiles.splice(i, 1); this.renderAttachments(); },

  /* ─── Enviar via mailto: ─── */
  sendMailto() {
    const to = this._recipients.join(', ');
    const cc = document.getElementById('email-cc')?.value || '';
    const subject = document.getElementById('email-subject')?.value || '';
    const body = document.getElementById('email-body')?.value || '';
    if (!to) { Toast.show('Añade al menos un destinatario', 'error'); return; }
    const url = `mailto:${encodeURIComponent(to)}`
      + `?${cc ? 'cc=' + encodeURIComponent(cc) + '&' : ''}`
      + `subject=${encodeURIComponent(subject)}`
      + `&body=${encodeURIComponent(body)}`;
    window.open(url);
    if (this._attachmentFiles.length > 0) {
      Toast.show('Adjunta los archivos manualmente en tu cliente de correo', 'success');
    }
    document.querySelector('.modal-backdrop')?.remove();
  },

  /* ─── Enviar via Gmail API ─── */
  async sendGmail() {
    const to = this._recipients.join(', ');
    const cc = document.getElementById('email-cc')?.value || '';
    const subject = document.getElementById('email-subject')?.value || '';
    const body = document.getElementById('email-body')?.value || '';
    if (!to) { Toast.show('Añade al menos un destinatario', 'error'); return; }
    if (!DriveSync.isConnected()) { Toast.show('Conecta Google Drive/Gmail primero', 'error'); return; }

    Toast.show('Enviando...');
    try {
      const estudio = Estudio.load();
      const fromName = estudio.nombre || 'Antalavera Arquitectura';

      // Build MIME message
      let mime = [
        `From: ${fromName} <${DriveSync.userEmail}>`,
        `To: ${to}`,
        cc ? `Cc: ${cc}` : '',
        `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
        `MIME-Version: 1.0`,
      ].filter(Boolean);

      if (this._attachmentFiles.length === 0) {
        mime.push('Content-Type: text/plain; charset=UTF-8', '', body);
      } else {
        const boundary = 'boundary_' + Date.now();
        mime.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '');
        mime.push(`--${boundary}`);
        mime.push('Content-Type: text/plain; charset=UTF-8', '', body, '');

        for (const file of this._attachmentFiles) {
          const b64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result.split(',')[1]);
            reader.readAsDataURL(file);
          });
          mime.push(`--${boundary}`);
          mime.push(`Content-Type: ${file.type || 'application/octet-stream'}`);
          mime.push(`Content-Disposition: attachment; filename="${file.name}"`);
          mime.push('Content-Transfer-Encoding: base64', '', b64, '');
        }
        mime.push(`--${boundary}--`);
      }

      const raw = btoa(unescape(encodeURIComponent(mime.join('\r\n')))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      await DriveSync.api('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw });
      document.querySelector('.modal-backdrop')?.remove();
      Toast.show('Email enviado correctamente ✓', 'success');
    } catch(e) {
      Toast.show('Error al enviar: ' + e.message, 'error');
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   CONTACTOS — Agenda de agentes de la edificación
   ═══════════════════════════════════════════════════════════ */
const ContactsView = {
  roles: [
    // Agentes de la edificación según LOE (Ley 38/1999)
    'Promotor',
    'Proyectista',
    'Director de Obra',
    'Director de Ejecución',
    'Coordinador de Seguridad y Salud',
    'Otros Técnicos',
    'Contratista',
    'Subcontrata',
    'Suministrador',
    // Otras entidades
    'Administración',
    'Notaría',
    'Registro de la Propiedad',
    'Organismo de Control (OCA)',
    'Compañía de Seguros',
    'Otros',
  ],

  async render(content, title, actions) {
    title.textContent = 'Contactos / Agentes';
    actions.innerHTML = `<button class="btn btn-primary" onclick="ContactsView.openNew()">＋ Nuevo contacto</button>`;

    const contacts = await DB.getAll('contacts') || [];
    const projects = await DB.getAll('projects');

    // Group by role
    const byRole = {};
    contacts.forEach(c => {
      const r = c.role || 'Otros';
      if (!byRole[r]) byRole[r] = [];
      byRole[r].push(c);
    });

    content.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px" id="contacts-grid">
        ${contacts.length === 0 ? `<div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">👥</div>
          <div class="empty-title">Sin contactos</div>
          <div class="empty-sub">Añade promotores, constructores, instaladores y otros agentes de la edificación</div>
        </div>` : ''}
      </div>
    `;

    const grid = document.getElementById('contacts-grid');
    contacts.sort((a,b) => (a.name||'').localeCompare(b.name||'')).forEach(c => {
      grid.appendChild(this.buildContactCard(c));
    });
  },

  buildContactCard(c) {
    const div = document.createElement('div');
    div.className = 'card card-sm';
    div.style.borderLeft = `3px solid ${this.roleColor(c.role)}`;
    const initials = (c.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:38px;height:38px;border-radius:50%;background:${this.roleColor(c.role)}22;border:1px solid ${this.roleColor(c.role)}44;display:flex;align-items:center;justify-content:center;font-family:var(--font-cond);font-weight:800;color:${this.roleColor(c.role)};font-size:14px;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-cond);font-size:15px;font-weight:700;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
          <div style="font-size:11px;color:${this.roleColor(c.role)};font-family:var(--font-cond);font-weight:700;text-transform:uppercase;letter-spacing:.07em">${c.role||'—'}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text3);display:grid;grid-template-columns:auto 1fr;gap:2px 8px">
        ${c.company ? `<span>Empresa:</span><span style="color:var(--text2)">${c.company}</span>` : ''}
        ${c.email   ? `<span>Email:</span><a href="mailto:${c.email}" style="color:var(--cyan);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.email}</a>` : ''}
        ${c.phone   ? `<span>Tel:</span><a href="tel:${c.phone}" style="color:var(--text2)">${c.phone}</a>` : ''}
        ${c.project ? `<span>Obra:</span><span style="color:var(--text2)">${c.project}</span>` : ''}
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        ${c.email ? `<button class="btn btn-sm btn-secondary" onclick="Email.openComposer({subject:'',body:'Estimado ${(c.name||'').split(' ')[0]},\n\n'});document.getElementById('email-to-input').value='${c.email}';Email.addToRecipient()">📧 Email</button>` : ''}
        ${c.phone ? `<a class="btn btn-sm btn-ghost" href="tel:${c.phone}">📞 Llamar</a>` : ''}
        ${c.phone ? `<a class="btn btn-sm btn-ghost" href="https://wa.me/${c.phone.replace(/\D/g,'')}?text=Estimado%20${encodeURIComponent((c.name||'').split(' ')[0])}," target="_blank">💬 WhatsApp</a>` : ''}
        <button class="btn btn-sm btn-ghost" onclick="ContactsView.openEdit('${c.id}')">✏️</button>
        <button class="btn btn-sm btn-ghost" onclick="ContactsView.deleteContact('${c.id}')">🗑️</button>
      </div>
    `;
    return div;
  },

  roleColor(role) {
    const m = {
      'Promotor':                        '#f5c518',
      'Proyectista':                     '#29b6c8',
      'Director de Obra':                '#29b6c8',
      'Director de Ejecución':           '#00d4aa',
      'Coordinador de Seguridad y Salud':'#f59e0b',
      'Otros Técnicos':                  '#60a5fa',
      'Contratista':                     '#c8302a',
      'Subcontrata':                     '#e87070',
      'Suministrador':                   '#a78bfa',
      'Administración':                  '#8b5cf6',
      'Notaría':                         '#ec4899',
      'Registro de la Propiedad':        '#d946ef',
      'Organismo de Control (OCA)':      '#f97316',
      'Compañía de Seguros':             '#22c55e',
    };
    return m[role] || '#5c6370';
  },

  async openNew() {
    this.openForm(null);
  },

  async openEdit(id) {
    const c = await DB.get('contacts', id);
    this.openForm(c);
  },

  openForm(contact, preAssignProjectId) {
    const c = contact || {};
    this._preAssignProjectId = preAssignProjectId || null;
    DB.getAll('projects').then(ps => {
      const sel = document.getElementById('contact-project');
      if (sel) ps.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.nombre; if ((c.projectIds||[]).includes(p.id)||p.id===preAssignProjectId) o.selected = true; sel.appendChild(o); });
    });

    const modal = App.createModal(contact ? 'Editar contacto' : 'Nuevo contacto', `
      <div class="form-grid">
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Nombre completo *</label>
          <input id="contact-name" class="form-input" value="${c.name||''}" placeholder="Juan García López">
        </div>
        <div class="form-group">
          <label class="form-label">Rol / función</label>
          <select id="contact-role" class="form-select">
            ${this.roles.map(r => `<option value="${r}" ${c.role===r?'selected':''}>${r}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Empresa / entidad</label>
          <input id="contact-company" class="form-input" value="${c.company||''}" placeholder="Constructora XYZ S.L.">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input id="contact-email" class="form-input" type="email" value="${c.email||''}" placeholder="contacto@empresa.com">
        </div>
        <div class="form-group">
          <label class="form-label">Teléfono</label>
          <input id="contact-phone" class="form-input" type="tel" value="${c.phone||''}" placeholder="600 000 000">
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Asignar a proyecto</label>
          <select id="contact-project" class="form-select">
            <option value="">— Sin asignar (BD general) —</option>
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Notas</label>
          <textarea id="contact-notes" class="form-textarea" style="min-height:70px" placeholder="Notas sobre este contacto...">${c.notes||''}</textarea>
        </div>
      </div>
    `);
    modal.querySelector('.modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="ContactsView.saveContact('${c.id||''}')">💾 Guardar contacto</button>
    `;
    document.body.appendChild(modal);
  },

  async saveContact(id) {
    const name = document.getElementById('contact-name')?.value?.trim();
    if (!name) { Toast.show('El nombre es obligatorio', 'error'); return; }
    const data = {
      name,
      role:    document.getElementById('contact-role')?.value    || '',
      company: document.getElementById('contact-company')?.value?.trim() || '',
      email:   document.getElementById('contact-email')?.value?.trim()   || '',
      phone:   document.getElementById('contact-phone')?.value?.trim()   || '',
      notes:   document.getElementById('contact-notes')?.value?.trim()   || '',
    };
    // Asignar a proyecto si se seleccionó uno
    const selProj = document.getElementById('contact-project')?.value;
    const existingIds = id ? ((await DB.get('contacts', id))?.projectIds || []) : [];
    const preId = ContactsView._preAssignProjectId;
    const allIds = new Set([...existingIds]);
    if (selProj) allIds.add(selProj);
    if (preId)   allIds.add(preId);
    data.projectIds = [...allIds];
    if (id) data.id = id;
    await DB.put('contacts', data);
    document.querySelector('.modal-backdrop')?.remove();
    Toast.show('Agente guardado ✓', 'success');
    // Volver al proyecto si veníamos de uno
    const returnProject = preId || selProj;
    ContactsView._preAssignProjectId = null;
    if (returnProject && App.currentProjectId) App.navigate('project-detail', App.currentProjectId);
    else App.navigate('agents');
  },

  async deleteContact(id) {
    if (!confirm('¿Eliminar este contacto?')) return;
    await DB.delete('contacts', id);
    Toast.show('Contacto eliminado');
    App.navigate('contacts');
  }
};

/* ─── Override navigate to add contacts & email ─── */
const _brandOrigNavigate = App.navigate ? App.navigate.bind(App) : function(){};
App.navigate = function(view, param) {
  if (view === 'contacts' || view === 'agents') {
    this.currentView = 'agents';
    document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === 'agents'));
    ContactsView.render(document.getElementById('main-content'), document.getElementById('topbar-title'), document.getElementById('topbar-actions'));
    return;
  }
  _brandOrigNavigate(view, param);
  // Añadir botón de notificaciones en perfil
  if (view === 'perfil') {
    setTimeout(() => {
      const main = document.getElementById('main-content');
      if (!main || document.getElementById('notif-card')) return;
      const card = document.createElement('div');
      card.id = 'notif-card';
      card.className = 'card mt-3';
      card.innerHTML = `
        <div class="section-header mb-2">
          <div class="section-title">🔔 Notificaciones</div>
          <span id="notif-status" style="font-size:12px;color:var(--text3)">Comprobando...</span>
        </div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:12px">
          Recibe alertas en tu dispositivo: eventos del día, plazos de fin de obra, incidencias abiertas y proyectos sin actividad.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="notif-toggle-btn">🔔 Activar notificaciones</button>
          <button class="btn btn-ghost" onclick="Notificaciones.probar()">📨 Prueba</button>
        </div>
      `;
      main.appendChild(card);
      // Actualizar botón según estado real
      setTimeout(() => Notificaciones._actualizarBoton(), 100);
      // Añadir tarjeta de transcripción
      if (typeof Transcripcion !== 'undefined') {
        Transcripcion.renderConfigCard(main);
      }
    }, 200);
  }
};

/* ─── Add "Send email" button to event detail topbar ─── */
/* renderEventDetail ya incluye todos los botones necesarios en app.js */

/* ─── Add contacts store to DB if not exists ─── */
const _origDbOpen = DB.open ? DB.open.bind(DB) : async function(){};
DB.open = async function() {
  const db = await _origDbOpen();
  // contacts store is added in v2 upgrade
  return db;
};

/* ─── Stamp metadata on every media captured ─── */
// Override buildMediaItem to show stamp
const _brandOrigBuildMedia = App._buildMediaItem ? App._buildMediaItem.bind(App) : (App.buildMediaItem ? App.buildMediaItem.bind(App) : null);
if (_brandOrigBuildMedia) {
  App.buildMediaItem = function(m) {
    const div = _brandOrigBuildMedia(m);
    if (m.createdAt || m.lat) {
      const stamp = document.createElement('div');
      stamp.className = 'media-stamp';
      const d = m.createdAt ? new Date(m.createdAt) : null;
      const dateStr = d ? `${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}` : '';
      const gpsStr = m.lat ? `📍${m.lat.toFixed(4)},${m.lng.toFixed(4)}` : '';
      stamp.textContent = [dateStr, gpsStr].filter(Boolean).join(' ');
      div.appendChild(stamp);
    }
    return div;
  };
}

/* ─── DB upgrade to add contacts store ─── */
// Patch DB open to handle contacts
const _rawOpen = DB.open ? DB.open.bind(DB) : async function(){};
DB.open = function() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB.name, 3); // bump version to add contacts
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const stores = ['projects','events','media','audios','files','notes','contacts'];
      const indexes = {
        projects: [['name','name']],
        events: [['date','date'],['projectId','projectId'],['type','type']],
        media: [['eventId','eventId']],
        audios: [['eventId','eventId']],
        files: [['eventId','eventId']],
        notes: [['eventId','eventId']],
        contacts: [['role','role'],['project','project']],
      };
      stores.forEach(name => {
        let store;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: 'id' });
        } else {
          store = e.target.transaction.objectStore(name);
        }
        (indexes[name]||[]).forEach(([idxName, path]) => {
          if (!store.indexNames.contains(idxName)) store.createIndex(idxName, path);
        });
      });
    };
    req.onsuccess = (e) => { DB.db = e.target.result; resolve(DB.db); };
    req.onerror = () => reject(req.error);
  });
};

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    Estudio.load();
    const el = document.getElementById('sidebar-estudio-name');
    // sidebar already has brand name built-in
  }, 300);
});

/* ═══════════════════════════════════════════════════════════
   CONTACTOS LOE v2 — Pestañas por agente según Ley 38/1999
   ═══════════════════════════════════════════════════════════ */
// Override the ContactsView.render with tabbed LOE view
ContactsView.LOE_GROUPS = [
  {
    tab: 'Técnicos',
    roles: ['Promotor','Proyectista','Director de Obra','Director de Ejecución','Coordinador de Seguridad y Salud','Otros Técnicos'],
    icon: '📐',
    color: 'var(--cyan)',
  },
  {
    tab: 'Contratación',
    roles: ['Contratista','Subcontrata','Suministrador'],
    icon: '🔨',
    color: 'var(--red-corp)',
  },
  {
    tab: 'Otras',
    roles: ['Administración','Notaría','Registro de la Propiedad','Organismo de Control (OCA)','Compañía de Seguros','Otros'],
    icon: '🏛️',
    color: '#8b5cf6',
  },
];

ContactsView._currentTab = 0;

ContactsView.render = async function(content, title, actions) {
  title.textContent = 'Contactos — Agentes de la edificación';
  actions.innerHTML = `
    <div class="search-box" style="width:220px"><span style="color:var(--text3)">🔍</span><input id="contact-search" placeholder="Buscar..." oninput="ContactsView.filterContacts(this.value)"></div>
    <button class="btn btn-primary" onclick="ContactsView.openNew()">＋ Nuevo contacto</button>
  `;

  const contacts = await DB.getAll('contacts') || [];
  const tab = this._currentTab;

  content.innerHTML = `
    <!-- Cabecera LOE -->
    <div class="card mb-3" style="padding:12px 16px;border-left:3px solid var(--cyan)">
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;letter-spacing:.1em">
        Agentes de la edificación — Ley 38/1999 de Ordenación de la Edificación (LOE)
      </div>
    </div>

    <!-- Tabs por grupo LOE -->
    <div class="tabs-bar">
      ${this.LOE_GROUPS.map((g, i) => `
        <button class="tab-btn ${tab===i?'active':''}" onclick="ContactsView._currentTab=${i};ContactsView.render(document.getElementById('main-content'),document.getElementById('topbar-title'),document.getElementById('topbar-actions'))">
          ${g.icon} ${g.tab}
          <span class="badge-count" style="background:${g.color};color:#fff;margin-left:4px">
            ${contacts.filter(c => g.roles.includes(c.role)).length || ''}
          </span>
        </button>`).join('')}
    </div>

    <!-- Cards del grupo activo -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px" id="contacts-grid">
    </div>
  `;

  this._allContacts = contacts;
  this.renderGroup(contacts, this.LOE_GROUPS[tab].roles);
};

ContactsView.renderGroup = function(contacts, roles) {
  const grid = document.getElementById('contacts-grid');
  if (!grid) return;
  const filtered = contacts.filter(c => roles.includes(c.role || 'Otros'));
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">👤</div>
      <div class="empty-title">Sin contactos en este grupo</div>
      <div class="empty-sub">Añade los agentes de la edificación de tus proyectos</div>
      <button class="btn btn-primary" onclick="ContactsView.openNew()">＋ Añadir agente</button>
    </div>`;
    return;
  }
  // Sort by role (following LOE order) then by name
  const roleOrder = [...ContactsView.LOE_GROUPS.flatMap(g => g.roles)];
  filtered.sort((a,b) => (roleOrder.indexOf(a.role)-roleOrder.indexOf(b.role)) || (a.name||'').localeCompare(b.name||''));
  grid.innerHTML = '';
  filtered.forEach(c => grid.appendChild(ContactsView.buildContactCard(c)));
};

ContactsView.filterContacts = function(q) {
  q = q.toLowerCase();
  const allContacts = this._allContacts || [];
  const roles = this.LOE_GROUPS[this._currentTab].roles;
  const filtered = allContacts.filter(c =>
    roles.includes(c.role || 'Otros') &&
    (c.name?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q))
  );
  this.renderGroup(filtered, roles);
};

ContactsView.buildContactCard = function(c) {
  const div = document.createElement('div');
  div.className = 'card card-sm';
  div.style.cssText = `border-left:3px solid ${this.roleColor(c.role)};cursor:default`;
  const initials = (c.name||'?').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
  div.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
      <div style="width:40px;height:40px;border-radius:50%;background:${this.roleColor(c.role)}18;border:1px solid ${this.roleColor(c.role)}40;display:flex;align-items:center;justify-content:center;font-family:var(--font-cond);font-weight:800;color:${this.roleColor(c.role)};font-size:14px;flex-shrink:0">${initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-cond);font-size:15px;font-weight:700;color:var(--white);line-height:1.2">${c.name || '—'}</div>
        <div style="font-size:10px;color:${this.roleColor(c.role)};font-family:var(--font-cond);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-top:2px">${c.role || '—'}</div>
        ${c.company ? `<div style="font-size:12px;color:var(--text3);margin-top:2px">${c.company}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px">
        <button style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:2px" onclick="ContactsView.openEdit('${c.id}')" title="Editar">✏️</button>
        <button style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:2px" onclick="ContactsView.deleteContact('${c.id}')" title="Eliminar">🗑️</button>
      </div>
    </div>
    <div style="font-size:12px;color:var(--text2);display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin-bottom:10px;align-items:center">
      ${c.email   ? `<span style="color:var(--text3)">✉️</span><a href="mailto:${c.email}" style="color:var(--cyan);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.email}</a>` : ''}
      ${c.phone   ? `<span style="color:var(--text3)">📞</span><a href="tel:${c.phone}" style="color:var(--text2)">${c.phone}</a>` : ''}
      ${c.project ? `<span style="color:var(--text3)">🏗️</span><span>${c.project}</span>` : ''}
      ${c.cif     ? `<span style="color:var(--text3)">CIF</span><span style="font-family:var(--mono)">${c.cif}</span>` : ''}
    </div>
    <div style="display:flex;gap:5px;flex-wrap:wrap">
      ${c.email ? `<button class="btn btn-sm btn-secondary" onclick="Email.openComposer({});setTimeout(()=>{document.getElementById('email-to-input').value='${c.email}';Email.addToRecipient()},100)">📧 Email</button>` : ''}
      ${c.phone ? `<a class="btn btn-sm btn-ghost" href="tel:${c.phone}" style="text-decoration:none">📞 Llamar</a>` : ''}
      ${c.phone ? `<a class="btn btn-sm btn-ghost" href="https://wa.me/${c.phone.replace(/\D/g,'')}?text=Estimado%20${encodeURIComponent((c.name||'').split(' ')[0])}," target="_blank" style="text-decoration:none">💬 WA</a>` : ''}
    </div>
    ${c.notes ? `<div style="margin-top:8px;font-size:11px;color:var(--text3);border-top:1px solid var(--border);padding-top:7px;font-style:italic">${c.notes}</div>` : ''}
  `;
  return div;
};

ContactsView.openForm = function(contact) {
  const c = contact || {};
  const modal = App.createModal(contact ? 'Editar agente' : 'Nuevo agente de la edificación', `
    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Nombre completo / Razón social *</label>
        <input id="contact-name" class="form-input" value="${c.name||''}" placeholder="Juan García López / Constructora XYZ S.L.">
      </div>
      <div class="form-group">
        <label class="form-label">Rol LOE</label>
        <select id="contact-role" class="form-select">
          <optgroup label="— Agentes técnicos (LOE) —">
            <option value="Promotor" ${c.role==='Promotor'?'selected':''}>Promotor</option>
            <option value="Proyectista" ${c.role==='Proyectista'?'selected':''}>Proyectista</option>
            <option value="Director de Obra" ${c.role==='Director de Obra'?'selected':''}>Director de Obra</option>
            <option value="Director de Ejecución" ${c.role==='Director de Ejecución'?'selected':''}>Director de Ejecución</option>
            <option value="Coordinador de Seguridad y Salud" ${c.role==='Coordinador de Seguridad y Salud'?'selected':''}>Coordinador de Seguridad y Salud</option>
            <option value="Otros Técnicos" ${c.role==='Otros Técnicos'?'selected':''}>Otros Técnicos</option>
          </optgroup>
          <optgroup label="— Contratación —">
            <option value="Contratista" ${c.role==='Contratista'?'selected':''}>Contratista</option>
            <option value="Subcontrata" ${c.role==='Subcontrata'?'selected':''}>Subcontrata</option>
            <option value="Suministrador" ${c.role==='Suministrador'?'selected':''}>Suministrador</option>
          </optgroup>
          <optgroup label="— Otras entidades —">
            <option value="Administración" ${c.role==='Administración'?'selected':''}>Administración</option>
            <option value="Notaría" ${c.role==='Notaría'?'selected':''}>Notaría</option>
            <option value="Registro de la Propiedad" ${c.role==='Registro de la Propiedad'?'selected':''}>Registro de la Propiedad</option>
            <option value="Organismo de Control (OCA)" ${c.role==='Organismo de Control (OCA)'?'selected':''}>Organismo de Control (OCA)</option>
            <option value="Compañía de Seguros" ${c.role==='Compañía de Seguros'?'selected':''}>Compañía de Seguros</option>
            <option value="Otros" ${c.role==='Otros'?'selected':''}>Otros</option>
          </optgroup>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">CIF / NIF</label>
        <input id="contact-cif" class="form-input" value="${c.cif||''}" placeholder="B12345678 / 12345678A">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input id="contact-email" class="form-input" type="email" value="${c.email||''}" placeholder="nombre@empresa.com">
      </div>
      <div class="form-group">
        <label class="form-label">Teléfono</label>
        <input id="contact-phone" class="form-input" type="tel" value="${c.phone||''}" placeholder="600 000 000">
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Empresa / entidad</label>
        <input id="contact-company" class="form-input" value="${c.company||''}" placeholder="Nombre de la empresa">
      </div>
      <div class="form-group">
        <label class="form-label">Dirección</label>
        <input id="contact-addr" class="form-input" value="${c.address||''}" placeholder="Calle, número, ciudad">
      </div>
      <div class="form-group">
        <label class="form-label">Proyecto / obra asociada</label>
        <input id="contact-project" class="form-input" value="${c.project||''}" placeholder="Nombre del proyecto">
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Notas</label>
        <textarea id="contact-notes" class="form-textarea" style="min-height:70px" placeholder="Número de colegiado, especialidad, observaciones...">${c.notes||''}</textarea>
      </div>
    </div>
  `);
  modal.querySelector('.modal-footer').innerHTML = `
    <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
    <button class="btn btn-primary" onclick="ContactsView.saveContact('${c.id||''}')">💾 Guardar</button>
  `;
  document.body.appendChild(modal);
};

ContactsView.saveContact = async function(id) {
  const name = document.getElementById('contact-name')?.value?.trim();
  if (!name) { Toast.show('El nombre es obligatorio', 'error'); return; }
  const data = {
    name,
    role:    document.getElementById('contact-role')?.value || 'Otros',
    cif:     document.getElementById('contact-cif')?.value?.trim() || '',
    email:   document.getElementById('contact-email')?.value?.trim() || '',
    phone:   document.getElementById('contact-phone')?.value?.trim() || '',
    company: document.getElementById('contact-company')?.value?.trim() || '',
    address: document.getElementById('contact-addr')?.value?.trim() || '',
    project: document.getElementById('contact-project')?.value?.trim() || '',
    notes:   document.getElementById('contact-notes')?.value?.trim() || '',
  };
  if (id) data.id = id;
  await DB.put('contacts', data);
  document.querySelector('.modal-backdrop')?.remove();
  Toast.show('Contacto guardado ✓', 'success');
  ContactsView.render(document.getElementById('main-content'), document.getElementById('topbar-title'), document.getElementById('topbar-actions'));
};

ContactsView.openNew = function() { this.openForm(null); };
ContactsView.openEdit = async function(id) {
  const c = await DB.get('contacts', id);
  this.openForm(c);
};
ContactsView.deleteContact = async function(id) {
  if (!confirm('¿Eliminar este contacto?')) return;
  await DB.delete('contacts', id);
  Toast.show('Contacto eliminado');
  this.render(document.getElementById('main-content'), document.getElementById('topbar-title'), document.getElementById('topbar-actions'));
};
