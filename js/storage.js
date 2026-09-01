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
      perk: 'none',              // the one passive you deploy with (js/perks.js)
      /* Three saved kits, the way every shooter since Modern Warfare has done
         it: the gun and the passive, named, switchable from the loadout screen
         without rebuilding the set piece by piece. `null` is an empty slot. */
      presets: [null, null, null],
      activePreset: -1,
      /* The last few matches, newest first, and the numbers worth beating.
         A results screen you can only read once tells you how you did; a
         history tells you whether you are getting better. */
      history: [],
      best: { kills: 0, streak: 0, score: 0 },
      // missions (regenerated daily)
      missions: null,
      missionsDate: null,
      /* Whether this account has been through Basic Training. Only the home
         screen reads it, to stop recommending the tutorial to somebody who
         has already taken it. `hydrate` fills it in for older profiles. */
      tutorialDone: false,
    };
  }

  /* Fill in anything a profile saved by an older build has never heard of.
     Without this, every field added after a player's first launch reads
     undefined forever, because the defaults above only apply to brand new
     accounts. Only missing keys are written — nothing is overwritten. */
  function hydrate(p) {
    if (!p) return p;
    const base = freshProfile(p.username);
    for (const k of Object.keys(base)) if (p[k] === undefined) p[k] = base[k];
    return p;
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
      if (s === '__guest__') return hydrate(read('bs_guest', freshProfile('Guest')));
      const users = this.getUsers();
      return users[s] ? hydrate(users[s].profile) : null;
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

    /* ---- device settings ----
       Merged over the defaults rather than falling back to them wholesale:
       `read` only returns the fallback when the key is absent entirely, so a
       device that has ever saved settings would otherwise read `undefined` for
       every option added afterwards. */
    getSettings: () => Object.assign({
      volume: 70, sfx: true, sensitivity: 100, quality: 'medium', dmgNumbers: true,
      /* Deliberately absent: `botLevel`.

         It used to be listed here as 5, which was harmless while these were a
         wholesale fallback — the object was only consulted when no settings
         existed at all. Now that they are merged over the defaults, a listed
         value is always present, and `getSettings().botLevel || BotAI.DEFAULT`
         stopped ever reaching BotAI.DEFAULT. Every player who had never
         touched the slider silently dropped from difficulty 7 to 5.

         Leaving it out keeps the fallback where the game expects it, in
         js/botai.js, rather than having two places disagree about it. */
      keybinds: {},       // action -> [code, code]; only what differs from stock (js/controls.js)
      /* Sight. `teamColors` recolours the world for players who cannot separate
         the stock red and green: 'teams' is the normal per-squad palette,
         'friendfoe' paints your side one colour and everyone else another, in
         a pairing chosen for the common forms of colour blindness. */
      teamColors: 'teams',        // teams | friendfoe
      foeColor: '#ff9d2e',        // what the other side is painted in friendfoe
      // The reticle. 'system' keeps the browser's crosshair cursor.
      crosshair: 'dynamic',       // system | dot | cross | dynamic
      crosshairSize: 10,
      crosshairColor: '#7ff2c1',
      // How much of the world is on screen; 100 is the tuned default.
      fov: 100,
      /* Walls and props stand up and cast their own sides, which is what makes
         a building read as a building from above. It costs a little to draw
         and it hides a sliver of floor behind each wall, so it can be turned
         off for a flat, strictly top-down world. */
      flatWorld: false,
    }, read(KEY_SETTINGS, {})),
    saveSettings: (s) => write(KEY_SETTINGS, s),
    freshProfile,
  };
})();
