/* ============================================================
   auth.js — login / signup / guest / logout wiring
   ============================================================ */
const Auth = (() => {
  function showError(which, msg) {
    const el = document.querySelector(`[data-error="${which}"]`);
    if (el) el.textContent = msg || '';
  }

  function init() {
    // tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        const which = tab.dataset.authtab;
        document.getElementById('form-login').classList.toggle('is-active', which === 'login');
        document.getElementById('form-signup').classList.toggle('is-active', which === 'signup');
        showError('login', ''); showError('signup', '');
        SFX.click();
      });
    });

    // login
    document.getElementById('form-login').addEventListener('submit', (e) => {
      e.preventDefault();
      SFX.resume();
      const f = e.target;
      const username = f.username.value.trim();
      const password = f.password.value;
      const res = DB.verifyUser(username, password);
      if (!res.ok) { showError('login', res.error); return; }
      DB.setSession(username);
      f.reset();
      Screens.enterHome();
    });

    // signup
    document.getElementById('form-signup').addEventListener('submit', (e) => {
      e.preventDefault();
      SFX.resume();
      const f = e.target;
      const username = f.username.value.trim();
      const password = f.password.value;
      const confirm = f.confirm.value;
      if (password !== confirm) { showError('signup', 'Passwords do not match.'); return; }
      const res = DB.createUser(username, password);
      if (!res.ok) { showError('signup', res.error); return; }
      DB.setSession(username);
      f.reset();
      Toast.show('Account created — welcome to the squad!', 'good');
      Screens.enterHome();
    });

    // guest
    document.getElementById('btn-guest').addEventListener('click', () => {
      SFX.resume();
      DB.startGuest();
      Screens.enterHome();
    });

    // logout
    document.getElementById('btn-logout').addEventListener('click', () => {
      DB.clearSession();
      Screens.show('auth');
      Toast.show('Logged out.');
    });
  }

  return { init };
})();
