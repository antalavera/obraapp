/* DRIVE FIX — Solo reemplaza el onclick del boton Conectar */

function fixConnectButton() {
  // Buscar el boton "Conectar con Google" existente
  var btns = document.querySelectorAll('button');
  var connectBtn = null;
  btns.forEach(function(b) {
    if (b.textContent.includes('Conectar con Google')) connectBtn = b;
  });
  if (!connectBtn || connectBtn.dataset.fixed) return;
  connectBtn.dataset.fixed = '1';

  connectBtn.onclick = function() {
    var id = (document.getElementById('drive-client-id')?.value || '').trim();
    var sc = (document.getElementById('drv-client-secret')?.value ||
              document.getElementById('drive-client-secret')?.value || '').trim();

    if (!id) { alert('Introduce el Client ID'); return; }
    if (!sc) { alert('Introduce el Client Secret'); return; }

    localStorage.setItem('drive_client_id',     id);
    localStorage.setItem('drive_client_secret', sc);
    localStorage.setItem('oauth_client_id',     id);  // backup key

    // PKCE sincrono
    var arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    var verifier = btoa(String.fromCharCode.apply(null, arr))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    localStorage.setItem('oauth_verifier', verifier);

    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      .then(function(digest) {
        var challenge = btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
          .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');

        // En Electron usamos el servidor local; en web usamos la URL actual
        var isElectron = !!(window.electronAPI && window.electronAPI.isElectron);
        var isGitHub   = window.location.hostname.includes('github.io');
        var REDIRECT = isElectron
          ? 'http://127.0.0.1:3737'
          : isGitHub
            ? 'https://antalavera.github.io/obraapp/'
            : window.location.origin;

        var SCOPES = 'https://www.googleapis.com/auth/drive.file '
                   + 'https://www.googleapis.com/auth/gmail.send '
                   + 'https://www.googleapis.com/auth/userinfo.email';

        var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
          + '?client_id='             + encodeURIComponent(id)
          + '&redirect_uri='          + encodeURIComponent(REDIRECT)
          + '&response_type=code'
          + '&scope='                 + encodeURIComponent(SCOPES)
          + '&code_challenge='        + challenge
          + '&code_challenge_method=S256'
          + '&access_type=offline'
          + '&prompt=consent';

        window.__oauthCode = function(code) {
          fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'client_id='      + encodeURIComponent(id)
                + '&client_secret=' + encodeURIComponent(sc)
                + '&code='          + encodeURIComponent(code)
                + '&code_verifier=' + encodeURIComponent(localStorage.getItem('oauth_verifier') || '')
                + '&redirect_uri='  + encodeURIComponent(REDIRECT)
                + '&grant_type=authorization_code'
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.error) { alert('Error: ' + data.error + ' - ' + (data.error_description||'')); return; }
            localStorage.setItem('drive_token', data.access_token);
            localStorage.setItem('drive_token_ts', String(Date.now() + (data.expires_in||3600)*1000));
            if (data.refresh_token) localStorage.setItem('drive_refresh_token', data.refresh_token);
            return fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: 'Bearer ' + data.access_token }
            });
          })
          .then(function(r) { return r && r.json(); })
          .then(function(info) {
            if (!info) return;
            localStorage.setItem('drive_user_email', info.email || '');
            // Actualizar estado en sidebar
            var sidebarStatus = document.getElementById('drive-sidebar-status');
            if (sidebarStatus) sidebarStatus.textContent = '\u2601\ufe0f ' + info.email;
            // Recargar perfil para mostrar conectado
            App.navigate('perfil');
            alert('\u2713 Google Drive conectado como ' + info.email);
          })
          .catch(function(e) { alert('Error: ' + e.message); });
        };

        if (isElectron && typeof window.electronAPI.oauthStart === 'function') {
          // Electron: servidor local captura el código
          window.electronAPI.oauthStart({ authUrl: authUrl })
            .catch(function(e) { alert('Error IPC: ' + e.message); });
        } else {
          // Web/Android: redirigir a Google y volver
          // Guardar estado para recuperar al volver
          localStorage.setItem('oauth_pending', '1');
          localStorage.setItem('oauth_redirect', window.location.href);
          // En móvil los popups están bloqueados — redirigir directamente
          window.location.href = authUrl;
        }
      })
      .catch(function(e) { alert('Error PKCE: ' + e.message); });
  };
}

function showDriveStatus() {
  var email = localStorage.getItem('drive_user_email');
  var token = localStorage.getItem('drive_token');
  var tokenTs = parseInt(localStorage.getItem('drive_token_ts') || '0');
  var connected = !!(token && tokenTs > Date.now() && email);

  // Buscar el panel de Drive (el div.card que contiene drive-client-id)
  var clientIdInput = document.getElementById('drive-client-id');
  if (!clientIdInput) return;
  var card = clientIdInput.closest('.card') || clientIdInput.closest('[class*="card"]');
  if (!card) return;

  // Eliminar estado anterior si existe
  var old = card.querySelector('#drv-connection-status');
  if (old) old.remove();

  // Crear nuevo indicador de estado
  var statusDiv = document.createElement('div');
  statusDiv.id = 'drv-connection-status';
  statusDiv.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:14px;'
    + 'padding:10px 12px;border-radius:8px;background:var(--surface2);font-size:13px;';

  if (connected) {
    statusDiv.innerHTML = '<div style="width:10px;height:10px;border-radius:50%;background:#22c55e;flex-shrink:0"></div>'
      + '<span style="color:#22c55e;font-weight:600">✓ Conectado como: ' + email + '</span>'
      + '<button onclick="Estudio.desconectarDrive()" style="margin-left:auto;padding:3px 10px;border-radius:6px;'
      + 'border:1px solid rgba(255,255,255,.15);background:transparent;color:var(--text3);font-size:11px;cursor:pointer">'
      + 'Desconectar</button>';
  } else {
    statusDiv.innerHTML = '<div style="width:10px;height:10px;border-radius:50%;background:var(--text3);flex-shrink:0"></div>'
      + '<span style="color:var(--text3)">No conectado</span>';
  }

  // Insertar al principio del card, después del título
  var title = card.querySelector('.section-title');
  if (title) title.after(statusDiv);
  else card.insertBefore(statusDiv, card.firstChild);

  // Mostrar/ocultar botones según estado
  var allBtns = card.querySelectorAll('button');
  allBtns.forEach(function(b) {
    var txt = b.textContent.trim();
    if (txt.includes('Conectar con Google')) {
      b.style.display = connected ? 'none' : '';
    }
    if (txt.includes('Guardar credenciales')) {
      b.style.display = connected ? 'none' : '';
    }
    if (txt.includes('Desconectar')) {
      b.style.display = connected ? '' : 'none';
    }
  });

  // Ocultar/mostrar campos de credenciales si ya conectado
  var inputs = card.querySelectorAll('input[type="password"], input[id="drive-client-id"]');
  inputs.forEach(function(inp) {
    var group = inp.closest('.form-group') || inp.parentNode;
    if (group) group.style.display = connected ? 'none' : '';
  });
  var hints = card.querySelectorAll('details');
  hints.forEach(function(d) { d.style.display = connected ? 'none' : ''; });
}

// Observer para detectar cuando aparece el perfil
var _dObs = new MutationObserver(function() {
  var t = document.getElementById('topbar-title');
  if (t && t.textContent.includes('Perfil')) {
    setTimeout(fixConnectButton, 400);
    setTimeout(showDriveStatus, 500);
  }
});
document.addEventListener('DOMContentLoaded', function() {
  _dObs.observe(document.body, { childList: true, subtree: true });

  // Procesar codigo OAuth pendiente (vuelta de redireccion en movil/web)
  var pendingCode = localStorage.getItem('oauth_code_pending');
  if (pendingCode) {
    localStorage.removeItem('oauth_code_pending');
    // Esperar a que la app arranque y luego procesar
    setTimeout(function() {
      if (window.__oauthCode) {
        window.__oauthCode(pendingCode);
      } else {
        // Reconstruir el handler con datos guardados
        var id = localStorage.getItem('oauth_client_id') || localStorage.getItem('drive_client_id') || '';
        var sc = localStorage.getItem('drive_client_secret') || '';
        var verifier = localStorage.getItem('oauth_verifier') || '';
        var isGitHub2  = window.location.hostname.includes('github.io');
        var REDIRECT = isGitHub2 ? 'https://antalavera.github.io/obraapp/' : window.location.origin;

        // Debug info visible
        console.log('[OAuth] pendingCode found, id:', !!id, 'sc:', !!sc, 'verifier:', !!verifier, 'redirect:', REDIRECT);

        if (!id || !sc) {
          var msg = 'No se encontraron las credenciales de Google. Ve a Perfil del estudio e introduce Client ID y Client Secret antes de conectar.';
          Toast && Toast.show(msg, 'error');
          alert(msg);
          return;
        }
        if (!verifier) {
          var msg2 = 'Error de sesión OAuth. Inténtalo de nuevo desde Perfil del estudio.';
          Toast && Toast.show(msg2, 'error');
          return;
        }
        if (id && sc && verifier) {
          fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'client_id='      + encodeURIComponent(id)
                + '&client_secret=' + encodeURIComponent(sc)
                + '&code='          + encodeURIComponent(pendingCode)
                + '&code_verifier=' + encodeURIComponent(verifier)
                + '&redirect_uri='  + encodeURIComponent(REDIRECT)
                + '&grant_type=authorization_code'
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.error) { alert('Error Drive: ' + data.error); return; }
            localStorage.setItem('drive_token', data.access_token);
            localStorage.setItem('drive_token_ts', String(Date.now() + (data.expires_in||3600)*1000));
            if (data.refresh_token) localStorage.setItem('drive_refresh_token', data.refresh_token);
            return fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: 'Bearer ' + data.access_token }
            });
          })
          .then(function(r) { return r && r.json(); })
          .then(function(info) {
            if (!info) return;
            localStorage.setItem('drive_user_email', info.email || '');

            var sidebarStatus = document.getElementById('drive-sidebar-status');
            if (sidebarStatus) {
              sidebarStatus.textContent = '☁️ Drive: ' + info.email;
              sidebarStatus.style.color = 'rgba(41,182,200,.8)';
            }

            if (typeof DriveDB !== 'undefined') {
              DriveDB.accessToken   = localStorage.getItem('drive_token');
              DriveDB.userEmail     = info.email;
              DriveDB.CLIENT_ID     = localStorage.getItem('drive_client_id') || '';
              DriveDB.CLIENT_SECRET = localStorage.getItem('drive_client_secret') || '';
              DriveDB.ensureFolders().then(function() {
                return DB.getAll('events');
              }).then(function(events) {
                if (!events || !events.length) return;
                var chain = Promise.resolve();
                events.forEach(function(ev) {
                  chain = chain.then(function() {
                    return DriveDB.pushEvent(ev.id, function(){}).catch(function(){});
                  });
                });
                return chain;
              }).then(function() {
                return DriveDB.pushContacts().catch(function(){});
              }).catch(function(){});
            }

            if (typeof App !== 'undefined') App.navigate('perfil');
            alert('✓ Google Drive conectado como ' + info.email);
          })
          .catch(function(e) { alert('Error: ' + e.message); });
        }
      }
    }, 3000);
  }
});

/* ── Panel de diagnóstico y limpieza de datos ── */
async function addDiagPanel(card) {
  var existing = document.getElementById('diag-panel');
  if (existing) { existing.remove(); return; }

  var projects = await DB.getAll('projects').catch(function(){return [];});
  var events   = await DB.getAll('events').catch(function(){return [];});
  var pIds     = new Set(projects.map(function(p){return p.id;}));
  var orphans  = events.filter(function(e){return e.projectId && !pIds.has(e.projectId);});

  var panel = document.createElement('div');
  panel.id  = 'diag-panel';
  panel.style.cssText = 'margin-top:10px;border:1px solid var(--border);border-radius:8px;overflow:hidden;font-size:12px';

  // Header
  var hdr = document.createElement('div');
  hdr.style.cssText = 'background:var(--surface2);padding:10px 14px;display:flex;justify-content:space-between;align-items:center';
  hdr.innerHTML = '<strong>📊 BD local: ' + projects.length + ' proyectos · ' + events.length + ' eventos · ' + orphans.length + ' huérfanos</strong>';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.textContent = '✕';
  closeBtn.onclick = function(){ panel.remove(); };
  hdr.appendChild(closeBtn);
  panel.appendChild(hdr);

  // List
  var list = document.createElement('div');
  list.style.cssText = 'max-height:350px;overflow-y:auto;padding:8px';

  if (projects.length === 0 && events.length === 0) {
    list.innerHTML = '<div style="color:var(--green);padding:10px">✅ Base de datos local vacía — no hay nada que subir a Drive</div>';
  }

  projects.forEach(function(p) {
    var evCount = events.filter(function(e){return e.projectId===p.id;}).length;
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border)';
    var info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML = '<div style="color:var(--white);font-weight:600">🏗️ ' + (p.nombre||p.name||'Sin nombre') + '</div>' +
      '<div style="color:var(--text3)">ID: ' + p.id.slice(0,20) + '... · ' + evCount + ' eventos</div>';
    var del = document.createElement('button');
    del.className = 'btn btn-danger btn-sm';
    del.textContent = '🗑️ Borrar';
    del.style.fontSize = '11px';
    del.onclick = (function(pid){ return function(){ diagDeleteProject(pid); }; })(p.id);
    row.appendChild(info);
    row.appendChild(del);
    list.appendChild(row);
  });

  if (orphans.length > 0) {
    var orphanHdr = document.createElement('div');
    orphanHdr.style.cssText = 'padding:8px;background:rgba(200,48,42,.1);color:var(--red);font-weight:700';
    orphanHdr.textContent = '⚠️ Eventos huérfanos (proyecto ya no existe):';
    list.appendChild(orphanHdr);
    orphans.forEach(function(e) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border)';
      var info = document.createElement('div');
      info.style.flex = '1';
      info.innerHTML = '<div style="color:var(--white)">📋 ' + (e.title||'Sin título') + ' · ' + (e.date||'') + '</div>' +
        '<div style="color:var(--text3)">proyectoId: ' + (e.projectId||'').slice(0,20) + '...</div>';
      var del = document.createElement('button');
      del.className = 'btn btn-danger btn-sm';
      del.textContent = '🗑️ Borrar';
      del.style.fontSize = '11px';
      del.onclick = (function(eid){ return function(){ diagDeleteEvent(eid); }; })(e.id);
      row.appendChild(info);
      row.appendChild(del);
      list.appendChild(row);
    });
  }
  panel.appendChild(list);

  // Footer actions
  var footer = document.createElement('div');
  footer.style.cssText = 'padding:10px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border)';
  var btnAll = document.createElement('button');
  btnAll.className = 'btn btn-danger btn-sm';
  btnAll.textContent = '🗑️ BORRAR TODO (reset completo)';
  btnAll.onclick = diagDeleteAll;
  var btnOrph = document.createElement('button');
  btnOrph.className = 'btn btn-secondary btn-sm';
  btnOrph.textContent = '🧹 Borrar solo huérfanos';
  btnOrph.onclick = diagCleanOrphans;
  footer.appendChild(btnAll);
  footer.appendChild(btnOrph);
  panel.appendChild(footer);

  card.appendChild(panel);
}

window.diagDeleteProject = async function(id) {
  if (!confirm('Borrar este proyecto y sus eventos de la BD local?')) return;
  var evs = await DB.getAll('events').catch(function(){return [];});
  for (var ev of evs.filter(function(e){return e.projectId===id;})) {
    for (var s of ['media','audios','files','notes']) {
      var items = await DB.getAll(s,'eventId',ev.id).catch(function(){return [];});
      for (var item of items) await DB.delete(s,item.id).catch(function(){});
    }
    await DB.delete('events',ev.id).catch(function(){});
  }
  await DB.delete('projects',id).catch(function(){});
  Toast.show('Proyecto eliminado de BD local','success');
  document.getElementById('diag-panel')?.remove();
  if (typeof App !== 'undefined') App.navigate('projects');
};

window.diagDeleteEvent = async function(id) {
  if (!confirm('Borrar este evento de la BD local?')) return;
  for (var s of ['media','audios','files','notes']) {
    var items = await DB.getAll(s,'eventId',id).catch(function(){return [];});
    for (var item of items) await DB.delete(s,item.id).catch(function(){});
  }
  await DB.delete('events',id).catch(function(){});
  Toast.show('Evento eliminado','success');
  document.getElementById('diag-panel')?.remove();
};

window.diagDeleteAll = async function() {
  if (!confirm('BORRAR TODA la BD local? Se eliminan TODOS los proyectos, eventos, fotos y archivos. No se puede deshacer.')) return;
  if (!confirm('Segunda confirmacion: borrar todo?')) return;
  for (var store of ['projects','events','media','audios','files','notes','contacts']) {
    var items = await DB.getAll(store).catch(function(){return [];});
    for (var item of items) await DB.delete(store,item.id).catch(function(){});
  }
  Toast.show('Base de datos local reiniciada','success');
  document.getElementById('diag-panel')?.remove();
  if (typeof App !== 'undefined') App.navigate('dashboard');
};

window.diagCleanOrphans = async function() {
  var projects = await DB.getAll('projects').catch(function(){return [];});
  var pIds = new Set(projects.map(function(p){return p.id;}));
  var events = await DB.getAll('events').catch(function(){return [];});
  var count = 0;
  for (var ev of events) {
    if (ev.projectId && !pIds.has(ev.projectId)) {
      for (var s of ['media','audios','files','notes']) {
        var items = await DB.getAll(s,'eventId',ev.id).catch(function(){return [];});
        for (var item of items) await DB.delete(s,item.id).catch(function(){});
      }
      await DB.delete('events',ev.id).catch(function(){});
      count++;
    }
  }
  Toast.show('Limpieza: ' + count + ' eventos huerfanos eliminados','success');
  document.getElementById('diag-panel')?.remove();
};

/* ── Botones de sincronización separados ── *//* ── Botones de sincronización separados ── */
function addSyncButton() {
  if (document.getElementById('drv-sync-btn')) return;
  var clientIdInput = document.getElementById('drive-client-id');
  var mainContent   = document.getElementById('main-content');
  if (!clientIdInput && !mainContent) return;
  var card = clientIdInput
    ? (clientIdInput.closest('.card') || clientIdInput.parentNode)
    : mainContent;
  if (!card) return;

  // Contenedor con dos botones
  var wrap = document.createElement('div');
  wrap.id = 'drv-sync-wrap';
  wrap.style.cssText = 'margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px';

  // Botón SUBIR (Push)
  var btnUp = document.createElement('button');
  btnUp.id = 'drv-sync-btn';
  btnUp.className = 'btn btn-primary';
  btnUp.innerHTML = '↑ Subir a Drive';
  btnUp.title = 'Sube todos los datos locales a Google Drive (no borra nada de Drive)';

  // Botón DESCARGAR (Pull)
  var btnDown = document.createElement('button');
  btnDown.id = 'drv-pull-btn';
  btnDown.className = 'btn btn-secondary';
  btnDown.innerHTML = '↓ Descargar de Drive';
  btnDown.title = 'Descarga desde Google Drive lo que no tengas en local (no borra nada local)';

  // Log compartido
  var getLog = function() {
    var log = document.getElementById('drv-log');
    if (!log) {
      log = document.createElement('div');
      log.id = 'drv-log';
      log.style.cssText = 'margin-top:8px;font-size:11px;font-family:monospace;color:var(--text3);max-height:180px;overflow-y:auto;background:var(--bg);padding:8px;border-radius:6px;grid-column:1/-1';
      wrap.appendChild(log);
    }
    log.innerHTML = '';
    return log;
  };

  var checkSync = function() {
    if (typeof Sync === 'undefined') { Toast.show('Módulo Sync no cargado','error'); return false; }
    if (!Sync.isConnected) { Toast.show('No conectado a Drive — pulsa Conectar primero','error'); return false; }
    return true;
  };

  // ── PUSH ──
  btnUp.onclick = async function() {
    if (!checkSync()) return;
    btnUp.disabled = btnDown.disabled = true;
    btnUp.textContent = '⏳ Subiendo...';
    var log = getLog();
    var addLog = function(msg) { log.innerHTML += msg + '<br>'; log.scrollTop = log.scrollHeight; };
    try {
      var ev = await DB.getAll('events').catch(function(){return [];});
      var pr = await DB.getAll('projects').catch(function(){return [];});
      addLog('↑ Subiendo ' + pr.length + ' proyectos, ' + ev.length + ' eventos...');
      const s1 = typeof DriveCore !== 'undefined' ? DriveCore : Sync;
      await s1.push(function(msg) { addLog('  ' + msg); });
      addLog('✅ Subida completada');
      Toast.show('Datos subidos a Drive ✓', 'success');
    } catch(e) {
      addLog('❌ Error: ' + e.message);
      Toast.show('Error al subir: ' + e.message, 'error');
    }
    btnUp.textContent = '↑ Subir a Drive';
    btnUp.disabled = btnDown.disabled = false;
  };

  // ── PULL ──
  btnDown.onclick = async function() {
    if (!checkSync()) return;
    var confirmed = confirm('Descargar desde Drive: importara lo que no tengas en local. NO borra nada local. Continuar?');
    if (!confirmed) return;
    btnUp.disabled = btnDown.disabled = true;
    btnDown.textContent = '⏳ Descargando...';
    var log = getLog();
    var addLog = function(msg) { log.innerHTML += msg + '<br>'; log.scrollTop = log.scrollHeight; };
    try {
      addLog('↓ Leyendo datos desde Drive...');
      const s2 = typeof DriveCore !== 'undefined' ? DriveCore : Sync;
      await s2.pull(function(msg) { addLog('  ' + msg); });
      addLog('✅ Descarga completada');
      Toast.show('Datos descargados desde Drive ✓', 'success');
      setTimeout(function() {
        if (typeof App !== 'undefined') App.navigate(App.currentView);
      }, 1500);
    } catch(e) {
      addLog('❌ Error: ' + e.message);
      Toast.show('Error al descargar: ' + e.message, 'error');
    }
    btnDown.textContent = '↓ Descargar de Drive';
    btnUp.disabled = btnDown.disabled = false;
  };

  // Botón limpiar datos huérfanos
  var btnClean = document.createElement('button');
  btnClean.className = 'btn btn-ghost';
  btnClean.style.cssText = 'margin-top:6px;width:100%;font-size:12px;color:var(--text3)';
  btnClean.textContent = '🧹 Limpiar datos huérfanos';
  btnClean.title = 'Elimina eventos vinculados a proyectos que ya no existen';
  btnClean.onclick = async function() {
    if (typeof ObraAppDiag !== 'undefined') {
      await ObraAppDiag.limpiarHuerfanos();
      if (typeof App !== 'undefined') App.navigate(App.currentView);
    }
  };

  wrap.appendChild(btnUp);
  wrap.appendChild(btnDown);
  card.appendChild(wrap);
  card.appendChild(btnClean);

  // Panel de diagnóstico — ver y limpiar BD local
  var btnDiag = document.createElement('button');
  btnDiag.className = 'btn btn-ghost';
  btnDiag.style.cssText = 'margin-top:4px;width:100%;font-size:12px;color:var(--text3)';
  btnDiag.textContent = '🔍 Ver y gestionar base de datos local';
  btnDiag.onclick = function() { addDiagPanel(card); };
  card.appendChild(btnDiag);
}

// Añadir botón sync cuando aparece el perfil
var _origObs = _dObs;
var _syncObs = new MutationObserver(function() {
  var t = document.getElementById('topbar-title');
  if (t && t.textContent.includes('Perfil')) {
    setTimeout(addSyncButton, 600);
  }
});
document.addEventListener('DOMContentLoaded', function() {
  _syncObs.observe(document.body, { childList: true, subtree: true });
});
