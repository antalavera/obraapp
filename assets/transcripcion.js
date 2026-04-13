/* ═══════════════════════════════════════════════
   TRANSCRIPCIÓN AUTOMÁTICA — ObraApp
   Soporta: OpenAI Whisper + Groq Whisper
   Configuración en Perfil del estudio
   ═══════════════════════════════════════════════ */

const Transcripcion = {

  /* Obtener configuración guardada */
  getConfig() {
    return {
      servicio: localStorage.getItem('transcripcion_servicio') || 'groq', // 'openai' | 'groq'
      apiKey:   localStorage.getItem('transcripcion_api_key')  || '',
      idioma:   localStorage.getItem('transcripcion_idioma')   || 'auto', // 'es' | 'auto'
    };
  },

  saveConfig(servicio, apiKey, idioma) {
    localStorage.setItem('transcripcion_servicio', servicio);
    localStorage.setItem('transcripcion_api_key',  apiKey);
    localStorage.setItem('transcripcion_idioma',   idioma);
  },

  isConfigured() {
    const { apiKey } = this.getConfig();
    return apiKey.trim().length > 10;
  },

  /* ── Transcribir un audioId de la BD ── */
  async transcribir(audioId) {
    if (!this.isConfigured()) {
      const ok = await this.mostrarConfigModal();
      if (!ok) return;
    }

    const audio = await DB.get('audios', audioId);
    if (!audio?.dataUrl) { Toast.show('Audio no encontrado', 'error'); return; }

    // Indicador visual
    const statusEl = document.getElementById('transcript-'+audioId);
    if (statusEl) {
      statusEl.textContent = '⏳ Transcribiendo...';
      statusEl.style.color = 'var(--cyan)';
      statusEl.classList.remove('empty');
    }
    const btn = document.querySelector(`[onclick*="transcribirAudio('${audioId}')"]`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Procesando...'; }

    try {
      const texto = await this._enviarAWhisper(audio.dataUrl, audio.type);

      // Guardar en BD
      await DB.put('audios', { ...audio, transcript: texto });

      // Actualizar UI
      if (statusEl) {
        statusEl.textContent = texto;
        statusEl.style.color = '';
        statusEl.classList.remove('empty');
      }
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Transcribir'; }

      // Recargar tab de audio para mostrar botón copiar
      if (typeof App !== 'undefined') await App.loadTabAudio(audio.eventId);

      Toast.show('Transcripción completada ✓', 'success');
      return texto;

    } catch(e) {
      console.error('Transcripción error:', e);
      if (statusEl) { statusEl.textContent = '❌ Error: ' + e.message; statusEl.style.color = 'var(--red)'; }
      if (btn)     { btn.disabled = false; btn.textContent = '🤖 Transcribir'; }
      Toast.show('Error al transcribir: ' + e.message, 'error');
    }
  },

  /* ── Enviar audio a Whisper (OpenAI o Groq) ── */
  async _enviarAWhisper(dataUrl, mimeType) {
    const { servicio, apiKey, idioma } = this.getConfig();

    // Convertir dataUrl a Blob
    const byteStr = atob(dataUrl.split(',')[1]);
    const arr     = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
    const blob    = new Blob([arr], { type: mimeType || 'audio/webm' });

    // El API de Whisper requiere un archivo con extensión reconocida
    const ext  = (mimeType || 'audio/webm').includes('mp4') ? 'mp4'
               : (mimeType || '').includes('mp3') ? 'mp3'
               : (mimeType || '').includes('wav') ? 'wav'
               : (mimeType || '').includes('m4a') ? 'm4a'
               : 'webm';
    const file = new File([blob], `audio.${ext}`, { type: blob.type });

    // Tamaño máximo: 25MB para OpenAI, ~25MB para Groq
    if (file.size > 24 * 1024 * 1024) {
      throw new Error('El audio supera 24MB. Divide la grabación en partes más cortas.');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', 'whisper-1');
    if (idioma !== 'auto') formData.append('language', idioma);
    formData.append('response_format', 'text');

    const endpoints = {
      openai: 'https://api.openai.com/v1/audio/transcriptions',
      groq:   'https://api.groq.com/openai/v1/audio/transcriptions',
    };

    const url = endpoints[servicio] || endpoints.groq;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      const msg = err?.error?.message || res.statusText;
      if (res.status === 401) throw new Error('API Key incorrecta o sin permisos');
      if (res.status === 429) throw new Error('Límite de peticiones alcanzado — espera un momento');
      throw new Error(msg);
    }

    const text = await res.text();
    return text.trim();
  },

  /* ── Modal de configuración ── */
  async mostrarConfigModal() {
    return new Promise(resolve => {
      const cfg = this.getConfig();
      const modal = App.createModal('🤖 Configurar transcripción automática', `
        <div style="display:flex;flex-direction:column;gap:14px">

          <div style="background:rgba(41,182,200,.08);border:1px solid rgba(41,182,200,.25);border-radius:8px;padding:12px;font-size:12px;color:var(--text2)">
            <strong style="color:var(--cyan)">¿Cómo funciona?</strong><br>
            Las grabaciones se envían de forma segura a la API de Whisper (IA de reconocimiento de voz) y se devuelve el texto transcrito. No se almacena nada en servidores externos.
          </div>

          <div class="form-group">
            <label class="form-label">Servicio</label>
            <select id="ts-servicio" class="form-select" onchange="Transcripcion._onServicioChange(this.value)">
              <option value="groq"   ${cfg.servicio==='groq'  ?'selected':''}>Groq Whisper — Gratis hasta 7.200 min/día</option>
              <option value="openai" ${cfg.servicio==='openai'?'selected':''}>OpenAI Whisper — 0,006€/min, alta precisión</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" id="ts-api-label">API Key de ${cfg.servicio === 'openai' ? 'OpenAI' : 'Groq'}</label>
            <div style="display:flex;gap:6px">
              <input id="ts-apikey" type="password" class="form-input" value="${cfg.apiKey}"
                placeholder="${cfg.servicio === 'openai' ? 'sk-...' : 'gsk_...'}" style="flex:1;font-family:var(--mono);font-size:12px">
              <button class="btn btn-ghost btn-icon" onclick="var i=document.getElementById('ts-apikey');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁️':'🙈'" title="Mostrar">👁️</button>
            </div>
            <div id="ts-api-link" style="font-size:11px;color:var(--text3);margin-top:4px">
              ${cfg.servicio === 'openai'
                ? '🔑 Obtén tu API Key en <a href="https://platform.openai.com/api-keys" target="_blank" style="color:var(--cyan)">platform.openai.com/api-keys</a>'
                : '🔑 Obtén tu API Key gratis en <a href="https://console.groq.com/keys" target="_blank" style="color:var(--cyan)">console.groq.com/keys</a>'}
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Idioma</label>
            <select id="ts-idioma" class="form-select">
              <option value="auto" ${cfg.idioma==='auto'?'selected':''}>🌍 Detección automática</option>
              <option value="es"   ${cfg.idioma==='es'  ?'selected':''}>🇪🇸 Español</option>
              <option value="en"   ${cfg.idioma==='en'  ?'selected':''}>🇬🇧 English</option>
            </select>
          </div>
        </div>
      `);

      modal.querySelector('.modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="document.querySelector('.modal-backdrop').remove()">Cancelar</button>
        <button class="btn btn-secondary" onclick="Transcripcion._probarConexion()">🔗 Probar conexión</button>
        <button class="btn btn-primary" onclick="Transcripcion._guardarConfig(true)">💾 Guardar</button>
      `;
      document.body.appendChild(modal);

      // Resolver cuando se cierre el modal
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.modal-backdrop')) {
          observer.disconnect();
          resolve(this.isConfigured());
        }
      });
      observer.observe(document.body, { childList: true });
    });
  },

  _onServicioChange(servicio) {
    const label  = document.getElementById('ts-api-label');
    const input  = document.getElementById('ts-apikey');
    const link   = document.getElementById('ts-api-link');
    if (label) label.textContent = `API Key de ${servicio === 'openai' ? 'OpenAI' : 'Groq'}`;
    if (input) input.placeholder = servicio === 'openai' ? 'sk-...' : 'gsk_...';
    if (link)  link.innerHTML = servicio === 'openai'
      ? '🔑 Obtén tu API Key en <a href="https://platform.openai.com/api-keys" target="_blank" style="color:var(--cyan)">platform.openai.com/api-keys</a>'
      : '🔑 Obtén tu API Key gratis en <a href="https://console.groq.com/keys" target="_blank" style="color:var(--cyan)">console.groq.com/keys</a>';
  },

  _guardarConfig(cerrarModal = false) {
    const servicio = document.getElementById('ts-servicio')?.value || 'groq';
    const apiKey   = document.getElementById('ts-apikey')?.value?.trim() || '';
    const idioma   = document.getElementById('ts-idioma')?.value || 'auto';
    if (!apiKey) { Toast.show('Introduce una API Key', 'error'); return; }
    this.saveConfig(servicio, apiKey, idioma);
    Toast.show('Configuración guardada ✓', 'success');
    if (cerrarModal) document.querySelector('.modal-backdrop')?.remove();
  },

  async _probarConexion() {
    const servicio = document.getElementById('ts-servicio')?.value;
    const apiKey   = document.getElementById('ts-apikey')?.value?.trim();
    if (!apiKey) { Toast.show('Introduce una API Key primero', 'error'); return; }

    Toast.show('Probando conexión...');
    try {
      // Probar con un audio silencioso de 1 segundo (WAV mínimo)
      const wav = this._silentWav();
      const form = new FormData();
      form.append('file', new File([wav], 'test.wav', { type: 'audio/wav' }));
      form.append('model', 'whisper-1');
      form.append('response_format', 'text');

      const url = servicio === 'openai'
        ? 'https://api.openai.com/v1/audio/transcriptions'
        : 'https://api.groq.com/openai/v1/audio/transcriptions';

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (res.status === 401) throw new Error('API Key incorrecta');
      if (!res.ok && res.status !== 400) throw new Error('Error ' + res.status);

      Toast.show('✅ Conexión correcta — API Key válida', 'success');
    } catch(e) {
      Toast.show('❌ ' + e.message, 'error');
    }
  },

  /* WAV silencioso mínimo para probar la conexión */
  _silentWav() {
    const sr = 8000, dur = 1, ch = 1, bps = 16;
    const samples = sr * dur, dataLen = samples * ch * (bps/8);
    const buf = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buf);
    const w = (o,v,s=4) => { if(s===4) view.setUint32(o,v,true); else if(s===2) view.setUint16(o,v,true); else view.setUint8(o,v); };
    [82,73,70,70].forEach((b,i)=>w(i,b,1));
    w(4,36+dataLen); [87,65,86,69,102,109,116,32].forEach((b,i)=>w(8+i,b,1));
    w(16,16); w(20,1,2); w(22,ch,2); w(24,sr); w(28,sr*ch*(bps/8)); w(32,ch*(bps/8),2); w(34,bps,2);
    [100,97,116,97].forEach((b,i)=>w(36+i,b,1)); w(40,dataLen);
    return buf;
  },

  /* ── Tarjeta de configuración para Perfil del estudio ── */
  renderConfigCard(container) {
    if (!container) return;
    const cfg = this.getConfig();
    const card = document.createElement('div');
    card.id = 'transcripcion-card';
    card.className = 'card mt-3';
    card.innerHTML = `
      <div class="section-header mb-2">
        <div class="section-title">🎙️ Transcripción automática</div>
        <span style="font-size:12px;color:${this.isConfigured()?'var(--green)':'var(--text3)'}">
          ${this.isConfigured() ? '✅ Configurada · ' + (cfg.servicio==='groq'?'Groq Whisper':'OpenAI Whisper') : 'Sin configurar'}
        </span>
      </div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">
        Convierte automáticamente tus grabaciones de voz en texto usando inteligencia artificial (Whisper).
        Funciona en español y detecta automáticamente el idioma.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="Transcripcion.mostrarConfigModal()">
          ${this.isConfigured() ? '⚙️ Cambiar configuración' : '🤖 Configurar transcripción'}
        </button>
        ${this.isConfigured() ? `<button class="btn btn-ghost" onclick="Transcripcion._probarDesde()">🔗 Probar conexión</button>` : ''}
      </div>
    `;
    container.appendChild(card);
  },

  async _probarDesde() {
    const cfg = this.getConfig();
    // Crear modal temporal solo para probar
    const servOld = document.getElementById('ts-servicio');
    if (servOld) return; // ya hay modal abierto
    const fakeModal = { servicio: cfg.servicio, apiKey: cfg.apiKey };
    // Simular elementos del DOM temporalmente
    const tempSel = { value: cfg.servicio };
    const tempInput = { value: cfg.apiKey, trim: () => cfg.apiKey };
    const origSel   = document.getElementById;
    const mockGet   = (id) => id==='ts-servicio'?tempSel:id==='ts-apikey'?tempInput:origSel.call(document,id);
    document.getElementById = mockGet;
    await this._probarConexion();
    document.getElementById = origSel;
  },
};

/* Exponer función global para uso desde audio items */
window.transcribirAudio = (audioId) => Transcripcion.transcribir(audioId);
