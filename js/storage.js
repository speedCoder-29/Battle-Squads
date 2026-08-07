/* ============================================================
   storage.js — local persistence layer
   Everything lives in localStorage for this prototype.
   Swap these functions for API calls to add a real backend.
   ============================================================ */
const DB = (() => {
  const KEY_USERS = 'bs_users';          // { username: { password, profile } }
  const KEY_SESSION = 'bs_session';      // current username (or "__guest__")
  const KEY_SETTINGS = 'bs_settings';    // device settings (per browser)

  const read = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
    catch { return fallback; }
  };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  /* ---- default player profile ---- */
  function freshProfile(username) {
    return {
      username,
      avatar: '🎯',
      level: 1,
      xp: 0,               // account xp
      credits: 500,
      gems: 25,
      // stats
      wins: 0,
      matches: 0,
      kills: 0,
      // battle pass
      bpTier: 1,
      bpXp: 0,
      // loadout — all weapons unlocked in this prototype build
      weapon: Weapons.default,
      unlockedWeapons: Weapons.allIds(),
      skins: [],                 // skin ids owned (account-wide)
      weaponSkins: {},           // weaponId -> skin id
      attachments: {},           // weaponId -> [attachment name]
      ammo: {},                  // weaponId -> specialized ammo name
      // missions (regenerated daily)
      missions: null,
      missionsDate: null,
    };
  }

  return {
    /* ---- users ---- */
    getUsers: () => read(KEY_USERS, {}),
    saveUsers: (u) => write(KEY_USERS, u),

    createUser(username, password) {
      const users = this.getUsers();
      if (users[username]) return { ok: false, error: 'That callsign is already taken.' };
      users[username] = { password, profile: freshProfile(username) };
      this.saveUsers(users);
      return { ok: true };
    },

    verifyUser(username, password) {
      const users = this.getUsers();
      const u = users[username];
      if (!u) return { ok: false, error: 'No account with that callsign.' };
      if (u.password !== password) return { ok: false, error: 'Incorrect password.' };
      return { ok: true };
    },

    /* ---- session ---- */
    setSession: (username) => localStorage.setItem(KEY_SESSION, username),
    getSession: () => localStorage.getItem(KEY_SESSION),
    clearSession: () => localStorage.removeItem(KEY_SESSION),

    /* ---- profile of the active player ---- */
    getProfile() {
      const s = this.getSession();
      if (!s) return null;
      if (s === '__guest__') return read('bs_guest', freshProfile('Guest'));
      const users = this.getUsers();
      return users[s] ? users[s].profile : null;
    },

    saveProfile(profile) {
      const s = this.getSession();
      if (!s) return;
      if (s === '__guest__') { write('bs_guest', profile); return; }
      const users = this.getUsers();
      if (users[s]) { users[s].profile = profile; this.saveUsers(users); }
    },

    startGuest() {
      this.setSession('__guest__');
      write('bs_guest', freshProfile('Guest'));
    },

    /* ---- device settings ---- */
    getSettings: () => read(KEY_SETTINGS, {
      volume: 70, sfx: true, sensitivity: 100, quality: 'medium', dmgNumbers: true,
      botLevel: 5,        // 1-10, see js/botai.js
      keybinds: {},       // action -> [code, code]; only what differs from stock (js/controls.js)
    }),
    saveSettings: (s) => write(KEY_SETTINGS, s),
    freshProfile,
  };
})();
