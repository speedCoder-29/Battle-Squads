/* ============================================================
   _shared.js — loads the browser data modules under Node.

   weapons.js, combat.js, classes.js and items.js are plain IIFEs
   that assign a global. That is exactly what a browser wants and
   exactly what CommonJS does not, so this evaluates them in a
   sandbox and re-exports the results.

   It exists so js/roomsim.js can `require('./_shared')` on the
   server and read the same tables the browser reads, rather than
   anyone keeping a second copy of the numbers.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = ['weapons.js', 'combat.js', 'classes.js', 'items.js'];

const sandbox = { console, Math, JSON, Date };
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}

// top-level `const` in a vm script is script-scoped rather than a property of
// the context, so reach the modules by evaluating inside it
module.exports = vm.runInContext('({ Weapons, Combat, Classes, Items })', ctx);

/* ---------- the map, on a machine with no screen ----------
   The dedicated server has to fight the match in the same buildings the
   players can see, and the generator that makes those buildings lives in
   game.js — a browser module. Rather than keep a second generator here (which
   would drift, and would have to stay bit-identical to be worth anything), the
   real one runs against a stub canvas: nothing is ever drawn, we only ask it
   what it built.

   Costs about half a second per map, once, when a room is created. */
const WORLD_FILES = ['weapons.js', 'sprites.js', 'terrain.js', 'nav.js', 'skins.js', 'shop.js',
  'net.js', 'roomsim.js', 'p2p.js', 'botai.js', 'combat.js', 'classes.js', 'structures.js',
  'items.js', 'storage.js', 'audio.js', 'progression.js', 'screens.js', 'game.js'];

let worldCtx = null;
function worldSandbox() {
  if (worldCtx) return worldCtx;
  const noop = () => {};
  const ctx2d = new Proxy({}, {
    get: (t, p) => {
      if (p === 'canvas') return { width: 1280, height: 720 };
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop: noop });
      if (p === 'measureText') return () => ({ width: 40 });
      return () => undefined;
    },
    set: () => true,
  });
  const el = () => ({
    style: {}, dataset: {}, value: '', checked: false, textContent: '', innerHTML: '',
    width: 1280, height: 720,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, appendChild: noop, remove: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0 }), getContext: () => ctx2d,
    querySelectorAll: () => [],
  });
  const store = {};
  const box = {
    console: { log: noop, warn: noop, error: noop }, Math, JSON, Date, parseInt, parseFloat,
    Set, Map, Array, Object, String, Number, isNaN, isFinite, Error, Promise, RegExp,
    document: { getElementById: el, querySelector: el, querySelectorAll: () => [], createElement: el, body: el(), head: el() },
    window: { addEventListener: noop, innerWidth: 1280, innerHeight: 720, location: { search: '' } },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    performance: { now: () => Date.now() },
    requestAnimationFrame: noop, setTimeout: noop, setInterval: noop,
    clearInterval: noop, clearTimeout: noop, confirm: () => false, alert: noop,
  };
  box.globalThis = box; box.self = box;
  worldCtx = vm.createContext(box);
  for (const f of WORLD_FILES) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), worldCtx, { filename: f });
  }
  vm.runInContext(`for (const k in SFX) if (typeof SFX[k] === 'function') SFX[k] = () => {};
    DB.startGuest();
    const _p = DB.getProfile(); Progression.ensureMissions(_p); Progression.ensureLoadout(_p); DB.saveProfile(_p);`,
  worldCtx);
  return worldCtx;
}

/* Generate `mode`'s map from `seed` and return what the simulation needs of
   it: collision rects and the capture points. Deterministic — the same seed
   gives the players the same world. */
function buildWorld(mode, seed) {
  const c = worldSandbox();
  c.__mode = mode; c.__seed = seed >>> 0;
  return vm.runInContext(
    'Game.start(__mode, __seed), ({ walls: Game.netWorld(), objectives: Game.netObjectives() })', c);
}

module.exports.buildWorld = buildWorld;
