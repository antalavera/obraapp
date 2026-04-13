/* ═══════════════════════════════════════════════
   GEO MODULE — Geolocalización y mapa
   Usa Leaflet + OpenStreetMap (sin coste)
   ═══════════════════════════════════════════════ */
const Geo = {
  map: null,
  currentMarkers: [],
  watchId: null,

  /* Obtener posición actual */
  getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no disponible en este dispositivo'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        err => reject(new Error(err.message)),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  },

  /* Geocodificación inversa (coordenadas → dirección) usando Nominatim */
  async reverseGeocode(lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, {
        headers: { 'Accept-Language': 'es' }
      });
      const data = await r.json();
      return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  },

  /* Geocodificación directa (dirección → coordenadas) */
  async geocode(address) {
    try {
      const q = encodeURIComponent(address);
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
        headers: { 'Accept-Language': 'es' }
      });
      const data = await r.json();
      if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name };
      return null;
    } catch { return null; }
  },

  /* Inicializar mapa Leaflet en un contenedor */
  initMap(containerId, lat = 40.4168, lng = -3.7038, zoom = 15) {
    if (this.map) { this.map.remove(); this.map = null; }
    // Cargar Leaflet si no está
    if (!window.L) {
      console.warn('Leaflet no cargado todavía');
      return null;
    }
    this.map = L.map(containerId, { zoomControl: true }).setView([lat, lng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(this.map);
    return this.map;
  },

  /* Añadir marker al mapa */
  addMarker(lat, lng, label = '', color = '#f97316') {
    if (!this.map) return;
    const icon = L.divIcon({
      html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3)"></div>`,
      className: '', iconAnchor: [7, 7]
    });
    const marker = L.marker([lat, lng], { icon });
    if (label) marker.bindPopup(`<strong>${label}</strong>`);
    marker.addTo(this.map);
    this.currentMarkers.push(marker);
    return marker;
  },

  clearMarkers() {
    this.currentMarkers.forEach(m => m.remove());
    this.currentMarkers = [];
  },

  destroyMap() {
    if (this.map) { this.map.remove(); this.map = null; }
  },

  /* Renderizar panel de mapa para evento */
  async renderMapTab(eventId) {
    const ev = await DB.get('events', eventId);
    const media = (await DB.getAll('media', 'eventId', eventId)).filter(m => m.lat);

    let centerLat = ev.lat || 40.4168;
    let centerLng = ev.lng || -3.7038;

    const html = `
      <div class="card mb-3">
        <div class="section-header mb-3">
          <div>
            <div class="section-title">Ubicación del evento</div>
            <div class="section-sub" id="location-address">${ev.location || 'Sin dirección registrada'}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary" onclick="Geo.locateNow('${eventId}')">📍 Localizar ahora</button>
            <button class="btn btn-secondary" onclick="Geo.searchAddress('${eventId}')">🔍 Buscar dirección</button>
          </div>
        </div>
        <div id="map-container" style="height:380px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border)"></div>
        ${ev.lat ? `
        <div style="margin-top:10px;display:flex;gap:12px;font-size:13px;color:var(--text2)">
          <span>🌐 Lat: <strong>${ev.lat?.toFixed(6)}</strong></span>
          <span>Lng: <strong>${ev.lng?.toFixed(6)}</strong></span>
          <span>±${ev.accuracy ? Math.round(ev.accuracy) + 'm' : '—'}</span>
          <a href="https://www.google.com/maps?q=${ev.lat},${ev.lng}" target="_blank" class="btn btn-ghost btn-sm">Ver en Google Maps ↗</a>
        </div>` : ''}
      </div>
      ${media.length > 0 ? `
      <div class="card">
        <div class="section-title mb-3">📷 Fotos geoetiquetadas (${media.length})</div>
        <div class="media-grid">
          ${media.map(m => `
            <div class="media-item" style="cursor:default">
              <img src="${m.dataUrl}" alt="">
              <div class="media-item-overlay" style="opacity:1;background:linear-gradient(transparent,rgba(0,0,0,.7))">
                <div class="media-caption">📍 ${m.lat?.toFixed(4)}, ${m.lng?.toFixed(4)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : ''}
    `;

    const container = document.getElementById('tab-mapa');
    if (!container) return;
    container.innerHTML = html;

    // Init map after DOM is ready
    setTimeout(() => {
      this.initMap('map-container', centerLat, centerLng, ev.lat ? 16 : 13);
      if (ev.lat) this.addMarker(ev.lat, ev.lng, ev.title || 'Evento', '#f97316');
      media.forEach(m => this.addMarker(m.lat, m.lng, '📷 Foto', '#0ea5e9'));
    }, 100);
  },

  async locateNow(eventId) {
    const isElectron = !!(window.electronAPI?.isElectron);
    if (isElectron) {
      Toast.show('GPS no disponible en PC — usa "Buscar dirección" o el campo manual', 'error');
      // Highlight the search button
      const btn = document.querySelector('[onclick*="searchAddress"]');
      if (btn) { btn.style.animation = 'pulse 0.5s ease 3'; btn.focus(); }
      return;
    }
    const btn = document.querySelector('[onclick*="locateNow"]');
    if (btn) { btn.textContent = '⏳ Localizando...'; btn.disabled = true; }
    try {
      Toast.show('Obteniendo ubicación GPS...');
      const pos = await this.getCurrentPosition();
      const address = await this.reverseGeocode(pos.lat, pos.lng);
      const ev = await DB.get('events', eventId);
      await DB.put('events', { ...ev, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, location: ev.location || address });
      Toast.show('Ubicación GPS registrada ✓', 'success');
      await this.renderMapTab(eventId);
    } catch (e) {
      const msg = e.message.includes('denied') ? 'Permiso de ubicación denegado — actívalo en ajustes del navegador'
                : e.message.includes('timeout') ? 'Tiempo agotado — asegúrate de tener señal GPS'
                : 'Error GPS: ' + e.message;
      Toast.show(msg, 'error');
      if (btn) { btn.textContent = '📍 Localizar ahora'; btn.disabled = false; }
    }
  },

  async searchAddress(eventId) {
    // Show inline search UI instead of prompt()
    const section = document.querySelector('#tab-mapa .section-header');
    if (!section) { this._promptSearchAddress(eventId); return; }
    if (document.getElementById('geo-search-box')) return; // already open
    const box = document.createElement('div');
    box.id = 'geo-search-box';
    box.style.cssText = 'margin-top:12px;display:flex;gap:8px;align-items:center';
    box.innerHTML = `
      <input id="geo-addr-input" class="form-input" placeholder="Calle, municipio, código postal..." style="flex:1"
        onkeydown="if(event.key==='Enter') Geo.doSearchAddress('${eventId}')">
      <button class="btn btn-primary" onclick="Geo.doSearchAddress('${eventId}')">🔍 Buscar</button>
      <button class="btn btn-ghost" onclick="document.getElementById('geo-search-box')?.remove()">✕</button>
    `;
    section.after(box);
    document.getElementById('geo-addr-input')?.focus();
  },

  async doSearchAddress(eventId) {
    const input = document.getElementById('geo-addr-input');
    const addr  = input?.value?.trim();
    if (!addr) { Toast.show('Introduce una dirección', 'error'); return; }
    const btn = document.querySelector('#geo-search-box .btn-primary');
    if (btn) { btn.textContent = '⏳ Buscando...'; btn.disabled = true; }
    Toast.show('Buscando dirección...');
    const result = await this.geocode(addr);
    if (!result) {
      Toast.show('Dirección no encontrada — prueba con más detalle', 'error');
      if (btn) { btn.textContent = '🔍 Buscar'; btn.disabled = false; }
      return;
    }
    const ev = await DB.get('events', eventId);
    await DB.put('events', { ...ev, lat: result.lat, lng: result.lng, location: addr });
    document.getElementById('geo-search-box')?.remove();
    Toast.show('Ubicación establecida ✓', 'success');
    await this.renderMapTab(eventId);
  },

  async _promptSearchAddress(eventId) {
    const addr = prompt('Introduce la dirección:');
    if (!addr) return;
    const result = await this.geocode(addr);
    if (!result) { Toast.show('Dirección no encontrada', 'error'); return; }
    const ev = await DB.get('events', eventId);
    await DB.put('events', { ...ev, lat: result.lat, lng: result.lng, location: addr });
    Toast.show('Ubicación establecida ✓', 'success');
    await this.renderMapTab(eventId);
  },

  /* Obtener coords de la cámara y guardarlas con la foto */
  async getPhotoLocation() {
    try {
      const pos = await Promise.race([
        this.getCurrentPosition(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
      ]);
      return { lat: pos.lat, lng: pos.lng };
    } catch { return null; }
  }
};
