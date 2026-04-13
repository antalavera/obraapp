/* ═══════════════════════════════════════════════
   NOTIFICACIONES — ObraApp
   Alertas locales programadas para Surface y Android
   ═══════════════════════════════════════════════ */

const Notificaciones = {

  _permiso: false,
  _intervalo: null,

  /* Solicitar permiso al usuario */
  async solicitarPermiso() {
    if (!('Notification' in window)) {
      Toast.show('Este dispositivo no soporta notificaciones', 'error');
      return false;
    }
    if (Notification.permission === 'granted') {
      this._permiso = true;
      return true;
    }
    if (Notification.permission === 'denied') {
      Toast.show('Notificaciones bloqueadas — actívalas en ajustes del navegador', 'error');
      return false;
    }
    const result = await Notification.requestPermission();
    this._permiso = result === 'granted';
    if (this._permiso) {
      Toast.show('✅ Notificaciones activadas', 'success');
      this.init();
    }
    setTimeout(() => this._actualizarBoton(), 100);
    return this._permiso;
  },

  /* Inicializar: comprobar alertas cada 30 minutos */
  async init() {
    if (Notification.permission !== 'granted') return;
    this._permiso = true;
    await this.comprobarAlertas();
    // Comprobar cada 30 minutos
    if (this._intervalo) clearInterval(this._intervalo);
    this._intervalo = setInterval(() => this.comprobarAlertas(), 30 * 60 * 1000);
    // Escuchar clicks en notificaciones desde el SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'NOTIFICATION_CLICK') {
          const { view, id } = e.data.data || {};
          if (view === 'event-detail' && id) {
            App.currentEventId = id;
            App.navigate('event-detail', id);
          } else if (view === 'project-detail' && id) {
            App.navigate('project-detail', id);
          } else {
            App.navigate('dashboard');
          }
        }
      });
    }
  },

  async comprobarAlertas() {
    if (!this._permiso) return;

    const [projects, events] = await Promise.all([
      DB.getAll('projects').catch(() => []),
      DB.getAll('events').catch(() => []),
    ]);

    const today     = new Date();
    const todayStr  = today.toISOString().slice(0, 10);
    const manana    = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    const in7days   = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

    const notifsSent = JSON.parse(localStorage.getItem('notifs_sent_' + todayStr) || '{}');
    const marcarEnviada = (key) => {
      notifsSent[key] = true;
      localStorage.setItem('notifs_sent_' + todayStr, JSON.stringify(notifsSent));
    };

    // ── Eventos de mañana (aviso el día anterior) ──
    const evManana = events.filter(e => e.date === manana);
    for (const ev of evManana) {
      const key = 'ev_manana_' + ev.id;
      if (!notifsSent[key]) {
        this.enviar(
          `📅 ${ev.title}`,
          `Mañana${ev.time ? ' a las ' + ev.time : ''} · ${ev.project || ''}`,
          { view: 'event-detail', id: ev.id },
          'aviso'
        );
        marcarEnviada(key);
      }
    }

    // ── Eventos de hoy (al abrir la app) ──
    const evHoy = events.filter(e => e.date === todayStr);
    for (const ev of evHoy) {
      const key = 'ev_hoy_' + ev.id;
      if (!notifsSent[key]) {
        this.enviar(
          `📅 Hoy: ${ev.title}`,
          `${ev.time ? 'A las ' + ev.time + ' · ' : ''}${ev.project || ''}`,
          { view: 'event-detail', id: ev.id },
          'info'
        );
        marcarEnviada(key);
      }
    }

    // ── Plazos de fin de obra críticos ──
    for (const p of projects) {
      if (!p.fechaFin) continue;
      if (!['En ejecución', 'En tramitación', 'Licencia obtenida'].includes(p.estado)) continue;
      const fin  = new Date(p.fechaFin + 'T00:00:00');
      const dias = Math.ceil((fin - today) / 86400000);
      const nombre = p.nombre || p.name || 'Proyecto';

      if (dias === 7) {
        const key = 'plazo_7_' + p.id;
        if (!notifsSent[key]) {
          this.enviar('⏰ Fin de obra en 7 días', nombre + ' · ' + p.fechaFin, { view: 'project-detail', id: p.id }, 'aviso');
          marcarEnviada(key);
        }
      }
      if (dias === 1) {
        const key = 'plazo_1_' + p.id;
        if (!notifsSent[key]) {
          this.enviar('🚨 Fin de obra mañana', nombre + ' · ' + p.fechaFin, { view: 'project-detail', id: p.id }, 'urgente');
          marcarEnviada(key);
        }
      }
      if (dias < 0 && dias >= -3) {
        const key = 'plazo_vencido_' + p.id + '_' + todayStr;
        if (!notifsSent[key]) {
          this.enviar('🚨 Plazo vencido', nombre + ' · Venció hace ' + Math.abs(dias) + ' días', { view: 'project-detail', id: p.id }, 'urgente');
          marcarEnviada(key);
        }
      }
    }

    // ── Incidencias abiertas (recordatorio semanal) ──
    const diaSemana = today.getDay(); // 1 = lunes
    if (diaSemana === 1) {
      for (const p of projects) {
        const abiertas = (p.incidencias || []).filter(i => !i.cerrada);
        if (!abiertas.length) continue;
        const key = 'incidencias_' + p.id + '_semana_' + todayStr;
        if (!notifsSent[key]) {
          this.enviar(
            `⚠️ ${abiertas.length} incidencia${abiertas.length > 1 ? 's' : ''} abierta${abiertas.length > 1 ? 's' : ''}`,
            (p.nombre || p.name || '') + ' · ' + abiertas.map(i => i.texto).join(', ').slice(0, 60),
            { view: 'project-detail', id: p.id },
            'peligro'
          );
          marcarEnviada(key);
        }
      }
    }
  },

  enviar(titulo, cuerpo, data = {}, nivel = 'info') {
    if (!this._permiso) return;
    try {
      // Electron PC: usa API nativa de Windows
      if (window.electronAPI?.showNotification) {
        window.electronAPI.showNotification({ title: titulo, body: cuerpo });
        return;
      }
      // Android / Surface navegador: via Service Worker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(titulo, {
            body:    cuerpo,
            icon:    '/assets/icons/icon-192.png',
            badge:   '/assets/icons/icon-64.png',
            data,
            tag:     JSON.stringify(data),
            vibrate: nivel === 'urgente' ? [200, 100, 200, 100, 200] : [100],
            requireInteraction: nivel === 'urgente' || nivel === 'peligro',
          });
        });
        return;
      }
      // Fallback: Web Notification API directa
      const n = new Notification(titulo, {
        body: cuerpo,
        icon: '/assets/icons/icon-192.png',
      });
      n.onclick = () => {
        window.focus();
        const { view, id } = data;
        if (view === 'event-detail'   && id) { App.currentEventId = id; App.navigate('event-detail', id); }
        else if (view === 'project-detail' && id) App.navigate('project-detail', id);
        else App.navigate('dashboard');
        n.close();
      };
      setTimeout(() => n.close(), 8000);
    } catch(e) {
      console.warn('Notificación fallida:', e);
    }
  },

  /* Probar notificación manualmente */
  async probar() {
    // En Electron no necesita permiso del navegador
    if (window.electronAPI?.showNotification) {
      await window.electronAPI.showNotification({
        title: '🔔 Notificación de prueba',
        body:  'Antalavera ObraApp — Las alertas funcionan correctamente en Windows',
      });
      Toast.show('Notificación enviada — mira la esquina inferior derecha de Windows ✓', 'success');
      return;
    }
    // Web / Android: necesita permiso
    if (Notification.permission !== 'granted') {
      const ok = await this.solicitarPermiso();
      if (!ok) return;
    }
    this._permiso = true;
    this.enviar(
      '🔔 Notificación de prueba',
      'Antalavera ObraApp — Las alertas funcionan correctamente en este dispositivo',
      { view: 'dashboard' },
      'info'
    );
    Toast.show('Notificación enviada — comprueba el centro de notificaciones ✓', 'success');
  },

  /* Desactivar: no se puede revocar permiso por JS, se informa al usuario */
  desactivar() {
    clearInterval(this._intervalo);
    this._intervalo = null;
    this._permiso   = false;
    Toast.show('Notificaciones pausadas ✓');
    setTimeout(() => Notificaciones._actualizarBoton(), 50);
  },

  _actualizarBoton() {
    const btn  = document.getElementById('notif-toggle-btn');
    const stat = document.getElementById('notif-status');
    if (!btn) return;
    const granted = Notification.permission === 'granted';
    const activas = granted && this._permiso;

    if (activas) {
      btn.textContent = '🔕 Pausar notificaciones';
      btn.className   = 'btn btn-secondary';
      btn.onclick     = () => { Notificaciones.desactivar(); };
      if (stat) { stat.textContent = '✅ Activas'; stat.style.color = 'var(--green)'; }
    } else if (granted && !this._permiso) {
      btn.textContent = '🔔 Reactivar notificaciones';
      btn.className   = 'btn btn-primary';
      btn.onclick     = () => { Notificaciones._permiso = true; Notificaciones.init(); Notificaciones._actualizarBoton(); };
      if (stat) { stat.textContent = '⏸️ Pausadas'; stat.style.color = 'var(--yellow-corp)'; }
    } else {
      btn.textContent = '🔔 Activar notificaciones';
      btn.className   = 'btn btn-primary';
      btn.onclick     = () => Notificaciones.solicitarPermiso().then(() => Notificaciones._actualizarBoton());
      if (stat) { stat.textContent = Notification.permission === 'denied' ? '🚫 Bloqueadas' : 'Sin activar'; stat.style.color = 'var(--text3)'; }
    }
  },

  get activas() {
    return Notification.permission === 'granted' && this._permiso;
  }
};

/* Auto-inicializar si ya hay permiso */
window.addEventListener('DOMContentLoaded', () => {
  if (Notification.permission === 'granted') {
    Notificaciones._permiso = true;
    Notificaciones.init();
  }
  setTimeout(() => Notificaciones._actualizarBoton(), 500);
});
