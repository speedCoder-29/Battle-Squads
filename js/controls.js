/* ============================================================
   controls.js — what every key does, and how to change it.

   The bindings used to be a switch statement on e.code buried in
   game.js, which meant the only way to play on a layout that isn't
   QWERTY — or to move dash off Shift because your browser eats it —
   was to edit the source. They live here now: one table of actions,
   a per-device override saved with the rest of the settings, and a
   reverse lookup the input handler consults instead of hardcoding.

   Two bindings per action, because the defaults have always offered
   both WASD and the arrow keys and taking that away to gain
   rebinding would be a poor trade.
   ============================================================ */
const Controls = (() => {

  /* The order here is the order the settings panel lists them in, so it
     reads as movement, then fighting, then everything else. */
  const ACTIONS = [
    { id: 'up',         name: 'Move up',        group: 'Movement', keys: ['KeyW', 'ArrowUp'] },
    { id: 'down',       name: 'Move down',      group: 'Movement', keys: ['KeyS', 'ArrowDown'] },
    { id: 'left',       name: 'Move left',      group: 'Movement', keys: ['KeyA', 'ArrowLeft'] },
    { id: 'right',      name: 'Move right',     group: 'Movement', keys: ['KeyD', 'ArrowRight'] },
    { id: 'dash',       name: 'Dash',           group: 'Movement', keys: ['ShiftLeft', 'ShiftRight'] },

    { id: 'reload',     name: 'Reload',         group: 'Combat',   keys: ['KeyR'] },
    { id: 'grenade',    name: 'Throw grenade',  group: 'Combat',   keys: ['KeyQ'] },
    { id: 'tactical',   name: 'Tactical',       group: 'Combat',   keys: ['KeyC'] },
    { id: 'heal',       name: 'Heal',           group: 'Combat',   keys: ['KeyF'] },
    { id: 'tool',       name: 'Tool',           group: 'Combat',   keys: ['KeyV'] },
    { id: 'token',      name: 'Call-in',        group: 'Combat',   keys: ['KeyB'] },
    { id: 'airstrike',  name: 'Airstrike',      group: 'Combat',   keys: ['KeyG'] },

    { id: 'interact',   name: 'Use / open',     group: 'World',    keys: ['KeyE'] },
    { id: 'ping',       name: 'Ping wheel',     group: 'World',    keys: ['KeyZ'] },
    { id: 'emote',      name: 'Emote wheel',    group: 'World',    keys: ['KeyX'] },
    { id: 'scoreboard', name: 'Scoreboard',     group: 'World',    keys: ['Tab'] },
    { id: 'pause',      name: 'Pause / back',   group: 'World',    keys: ['Escape'] },
  ];
  const byId = Object.fromEntries(ACTIONS.map(a => [a.id, a]));
  const defaults = () => Object.fromEntries(ACTIONS.map(a => [a.id, a.keys.slice()]));

  /* Actions the movement code polls every frame rather than acting on once.
     They are the ones where a key going *up* matters as much as going down. */
  const HELD = new Set(['up', 'down', 'left', 'right', 'scoreboard', 'ping', 'emote']);

  /* ---------- storage ----------
     Only the bindings that differ from stock are saved, so adding an action
     later gives everyone its default rather than nothing at all. */
  let cache = null;
  function all() {
    if (cache) return cache;
    const saved = (DB.getSettings() || {}).keybinds || {};
    cache = defaults();
    for (const id of Object.keys(cache)) {
      const k = saved[id];
      if (Array.isArray(k) && k.length) cache[id] = k.slice(0, 2);
    }
    return cache;
  }
  function save(map) {
    const s = DB.getSettings();
    const base = defaults();
    const diff = {};
    for (const id of Object.keys(map)) {
      if (map[id].join('|') !== base[id].join('|')) diff[id] = map[id];
    }
    s.keybinds = diff;
    DB.saveSettings(s);
    cache = map;
    lookup = null;
    listeners.forEach(fn => fn(map));
  }
  const listeners = [];
  const onChange = (fn) => listeners.push(fn);

  /* ---------- the lookup the game actually uses ----------
     Built once and thrown away whenever a binding changes, so the keydown
     handler is a single map read rather than a walk over every action. */
  let lookup = null;
  function actionFor(code) {
    if (!lookup) {
      lookup = {};
      const map = all();
      for (const id of Object.keys(map)) for (const code2 of map[id]) if (code2) lookup[code2] = id;
    }
    return lookup[code] || null;
  }

  /* ---------- rebinding ---------- */
  /* A key can only mean one thing. Assigning one that is already spoken for
     takes it off the other action rather than leaving two actions fighting
     over it — and if that empties the other action, it says so. */
  function bind(actionId, slot, code) {
    const map = all();
    if (!map[actionId]) return { ok: false, error: 'Unknown action' };
    if (code === 'Escape' && actionId !== 'pause') {
      return { ok: false, error: 'Escape is needed to leave menus' };
    }
    let stolenFrom = null;
    for (const id of Object.keys(map)) {
      const at = map[id].indexOf(code);
      if (at < 0 || (id === actionId && at === slot)) continue;
      map[id] = map[id].filter((_, i) => i !== at);
      stolenFrom = id;
    }
    const keys = map[actionId].slice();
    keys[slot] = code;
    map[actionId] = keys.filter(Boolean).slice(0, 2);
    save(map);
    return { ok: true, stolenFrom: stolenFrom && stolenFrom !== actionId ? byId[stolenFrom].name : null };
  }
  function clear(actionId, slot) {
    const map = all();
    if (!map[actionId]) return;
    map[actionId] = map[actionId].filter((_, i) => i !== slot);
    save(map);
  }
  function reset() { save(defaults()); }

  /* ---------- naming keys for humans ----------
     e.code is a physical-key name: fine for a lookup table, unreadable on a
     button. "KeyW" is W, "ArrowUp" is an arrow, "ShiftLeft" is Left Shift. */
  const SPECIAL = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    AltLeft: 'L Alt', AltRight: 'R Alt',
    Space: 'Space', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', Backspace: 'Bksp',
    CapsLock: 'Caps', ContextMenu: 'Menu', MetaLeft: 'L Meta', MetaRight: 'R Meta',
  };
  function label(code) {
    if (!code) return '—';
    if (SPECIAL[code]) return SPECIAL[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    if (/^F\d+$/.test(code)) return code;
    return code;
  }
  /* what to print for an action, e.g. "W / ↑" */
  const labelFor = (id) => (all()[id] || []).map(label).join(' / ') || '—';

  /* Keys the browser will not let a game keep, or that would strand someone
     in a match with no way out. Refused at the point of binding. */
  const FORBIDDEN = new Set(['F5', 'F11', 'F12', 'MetaLeft', 'MetaRight']);
  const isBindable = (code) => !!code && !FORBIDDEN.has(code);

  return {
    ACTIONS, HELD, byId,
    all, save, reset, bind, clear, onChange,
    actionFor, label, labelFor, isBindable, defaults,
  };
})();
