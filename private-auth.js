(() => {
  const AUTH_API_URL = '';
  const AUTH_KEY = 'barometre-auth-session-v1';
  let selectedUserId = '';
  let authError = '';
  let authBusy = false;

  const safeParse = value => {
    try { return JSON.parse(value); } catch { return null; }
  };

  const readSession = () => {
    const s = safeParse(sessionStorage.getItem(AUTH_KEY) || 'null');
    if (!s?.token || !s?.user?.id) return null;
    if (s.expiresAt && Date.now() >= new Date(s.expiresAt).getTime()) {
      sessionStorage.removeItem(AUTH_KEY);
      return null;
    }
    return s;
  };

  let authSession = readSession();

  const persistNoUser = () => {
    state.currentUserId = null;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  };

  const applySession = session => {
    authSession = session;
    if (session?.user?.id) {
      state.currentUserId = session.user.id;
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(AUTH_KEY);
      persistNoUser();
    }
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>'\"]/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '\"':'&quot;'
  }[c]));

  role = r => r === 'admin' ? 'PATRON' : r === 'employee' ? 'EMPLOYÉ' : 'EXTRA';

  login = id => {
    selectedUserId = id;
    authError = '';
    persistNoUser();
    render();
  };

  window.cancelPrivateLogin = () => {
    selectedUserId = '';
    authError = '';
    render();
  };

  window.submitPrivatePin = async event => {
    event.preventDefault();
    if (authBusy) return;

    const user = state.users.find(u => u.id === selectedUserId && u.active);
    const pin = String(new FormData(event.currentTarget).get('pin') || '').trim();

    if (!user) {
      authError = 'Utilisateur introuvable.';
      render();
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      authError = 'Entre un code à 4 chiffres.';
      render();
      return;
    }
    if (!AUTH_API_URL) {
      authError = 'Connexion privée en attente du serveur du Baromètre.';
      render();
      return;
    }

    authBusy = true;
    authError = '';
    render();

    try {
      const response = await fetch(`${AUTH_API_URL.replace(/\/$/, '')}/barometre-auth`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({userId: user.id, pin})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.token || !data?.user?.id) {
        throw new Error(data?.message || 'Code incorrect.');
      }
      const allowed = state.users.find(u => u.id === data.user.id && u.active);
      if (!allowed) throw new Error('Compte non autorisé.');

      applySession({
        token: data.token,
        user: {id: allowed.id, name: data.user.name || allowed.name, role: data.user.role || allowed.role},
        expiresAt: data.expiresAt || null
      });
      selectedUserId = '';
      authError = '';
    } catch (error) {
      applySession(null);
      authError = error?.message || 'Connexion impossible.';
    } finally {
      authBusy = false;
      render();
    }
  };

  logout = () => {
    applySession(null);
    selectedUserId = '';
    authError = '';
    render();
  };

  loginScreen = () => {
    const user = state.users.find(u => u.id === selectedUserId && u.active);
    const body = user
      ? `<button class="auth-back" onclick="cancelPrivateLogin()">← Retour</button>
         <h1>Code personnel</h1>
         <p>Entre le code de ${escapeHtml(user.name)}.</p>
         <div class="pin-user"><div class="person-avatar ${user.role === 'extra' ? 'extra' : ''}">${escapeHtml(initials(user.name))}</div><div><b>${escapeHtml(user.name)}</b><span>${role(user.role)}</span></div></div>
         <form class="pin-panel" onsubmit="submitPrivatePin(event)">
           <input class="pin-input" name="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="4" pattern="[0-9]{4}" placeholder="••••" autofocus>
           <div class="auth-error">${escapeHtml(authError)}</div>
           <button class="btn gold" style="width:100%;margin-top:4px" type="submit" ${authBusy ? 'disabled' : ''}>${authBusy ? 'Vérification…' : 'Se connecter'}</button>
           <p class="auth-note">Le code n’est jamais enregistré dans ce téléphone.</p>
         </form>`
      : `<h1>Connexion privée</h1><p>Choisis ton profil puis entre ton code personnel.</p>
         ${state.users.filter(u => u.active).map(u => `<div class="login-user"><div><b>${escapeHtml(u.name)}</b><span>${role(u.role)}</span></div><button class="btn soft" onclick="login('${u.id}')">Code</button></div>`).join('')}`;

    return `<div class="login-screen"><div class="login-card"><div class="login-logo"><img src="${LOGO}" alt="Le Baromètre"></div><div class="login-body">${body}</div></div></div>`;
  };

  const style = document.createElement('style');
  style.textContent = `
    .auth-back{border:0;background:transparent;color:var(--muted);font-size:10px;padding:0 0 12px;cursor:pointer}
    .pin-user{display:flex;align-items:center;gap:10px;margin:4px 0 14px;padding:10px 12px;background:var(--panel-2);border:1px solid var(--line);border-radius:12px}
    .pin-user .person-avatar{width:34px;height:34px;flex:0 0 34px}
    .pin-user b{display:block;font-size:11px}.pin-user span{display:block;font-size:8px;color:var(--muted);margin-top:2px}
    .pin-input{width:100%;box-sizing:border-box;background:#09090a;color:var(--text);border:1px solid var(--line);border-radius:12px;padding:14px 12px;text-align:center;font-size:22px;letter-spacing:10px;outline:none}
    .pin-input:focus{border-color:rgba(216,168,69,.6);box-shadow:0 0 0 3px var(--gold-soft)}
    .auth-error{min-height:18px;color:#e99898;font-size:9px;margin:8px 0 4px;text-align:center}
    .auth-note{font-size:8px!important;color:var(--muted)!important;text-align:center;margin-top:10px!important}
    .login-user button{min-width:74px}
  `;
  document.head.appendChild(style);

  if (authSession?.user?.id && state.users.some(u => u.id === authSession.user.id && u.active)) {
    state.currentUserId = authSession.user.id;
  } else {
    authSession = null;
    persistNoUser();
  }

  document.documentElement.style.visibility = 'visible';
  render();
})();
