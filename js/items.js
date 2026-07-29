/* ============================================================
   items.js — consumables, loot crates & legendary weapons.
   Pure data + roll/apply logic (no rendering). The game engine
   (game.js) reads these and spawns the world entities.

   Engine mapping notes:
     • 1 "tile" ≈ 50px, so "5 tile radius" ≈ 250px, "5m" ≈ 280px.
     • Consume time = seconds the player is channeling (vulnerable).
     • Adrenaline = a buff resource: while > 0 you move ~25% faster.
   ============================================================ */
const Items = (() => {

  /* ---------- CONSUMABLES ---------- */
  const CONSUMABLES = {
    // grenades (thrown) ---------------------------------------------------
    frag:      { name: 'Frag',       cat: 'grenade', mode: 'fuze',   icon: '💣', fuze: 5, damage: 100, falloff: 0.25, radius: 130 },
    impact:    { name: 'Impact Gren',cat: 'grenade', mode: 'impact', icon: '💥', damage: 50,  falloff: 0.25, radius: 105 },
    c4:        { name: 'C4',         cat: 'grenade', mode: 'c4',     icon: '🧿', fuze: 3, damage: 60,  falloff: 0.50, radius: 120, throwRange: 170 },
    smoke:     { name: 'Smoke',      cat: 'grenade', mode: 'smoke',  icon: '🌫️', fuze: 3, duration: 18, radius: 140 },
    flashbang: { name: 'Flashbang',  cat: 'grenade', mode: 'flash',  icon: '⚡', fuze: 5, radius: 280, blind: 3 },

    // tactical (deployed at your position) --------------------------------
    mine:      { name: 'Mine',       cat: 'tactical', mode: 'mine',  icon: '🔺', damage: 100, falloff: 1.0, radius: 95, trigger: 70, arm: 1 },
    barricade: { name: 'Barricade',  cat: 'tactical', mode: 'wall',  icon: '🧱', place: 5, life: 30, w: 120, h: 22 },
    ammobox:   { name: 'Ammo Box',   cat: 'tactical', mode: 'ammo',  icon: '📦', supply: 200, life: 45 },
    flag:      { name: 'Cool Flag',  cat: 'tactical', mode: 'flag',  icon: '🚩', radius: 250, adr: 10, speed: 0.25, life: 40 },

    // heals / boosts (self, channeled) -----------------------------------
    medkit:    { name: 'Medkit',     cat: 'heal', icon: '⛑️', hp: 100, time: 7.5 },
    bandage:   { name: 'Bandage',    cat: 'heal', icon: '🩹', hp: 15,  time: 2 },
    pills:     { name: 'Pills',      cat: 'heal', icon: '💊', adr: 50, time: 5 },
    soda:      { name: 'Soda',       cat: 'heal', icon: '🥤', adr: 25, time: 3 },
    stim:      { name: 'Stim',       cat: 'heal', icon: '💉', hp: 30, adr: 30, time: 0.5, revive: true },

    // call-in tokens ------------------------------------------------------
    jeep:      { name: 'Armored Jeep', cat: 'token', mode: 'vehicle', vehicle: 'jeep', icon: '🚙' },
    tank:      { name: 'Tank',         cat: 'token', mode: 'vehicle', vehicle: 'tank', icon: '🛡️' },
  };

  /* ---------- LOOT CRATES ---------- */
  // weighted tables straight from the design doc (weights are % chances)
  const CRATE_TABLES = {
    regular: [
      { id: 'bandage',        w: 25, label: 'Bandage' },
      { id: 'soda',           w: 15, label: 'Soda' },
      { id: 'stim',           w: 5,  label: 'Stim Injection' },
      { id: 'classConsumable',w: 25, label: 'Class Consumable' },
      { id: 'ammo',           w: 30, label: 'Ammo' },
    ],
    silver: [
      { id: 'soda',           w: 20, label: 'Soda' },
      { id: 'stim',           w: 10, label: 'Stim Injection' },
      { id: 'classConsumable',w: 20, label: 'Class Consumable' },
      { id: 'jeep',           w: 30, label: 'Armored Jeep' },
      { id: 'flag',           w: 20, label: 'Cool Flag' },
    ],
    gold: [
      { id: 'stim',           w: 20, label: 'Stim Injection' },
      { id: 'tank',           w: 20, label: 'Tank' },
      { id: 'jeep',           w: 30, label: 'Armored Jeep' },
      { id: 'legendary',      w: 30, label: 'Legendary Weapon' },
    ],
  };
  // how often each crate tier appears on the map
  const CRATE_RARITY = [ { tier: 'regular', w: 60 }, { tier: 'silver', w: 30 }, { tier: 'gold', w: 10 } ];
  const CRATE_STYLE = {
    regular: { color: '#8ea0c9', icon: '📦', name: 'Crate' },
    silver:  { color: '#cfd8ee', icon: '🎁', name: 'Silver Crate' },
    gold:    { color: '#ffcf4a', icon: '🏆', name: 'Gold Crate' },
  };

  // "Class Consumable" pool — what a class-exclusive drop can give
  const CLASS_CONSUMABLES = ['frag', 'impact', 'smoke', 'flashbang', 'mine', 'barricade', 'ammobox', 'c4'];

  function weightedPick(table) {
    const total = table.reduce((s, e) => s + e.w, 0);
    let r = Math.random() * total;
    for (const e of table) { if ((r -= e.w) <= 0) return e; }
    return table[table.length - 1];
  }
  const rollCrateTier = () => weightedPick(CRATE_RARITY).tier;
  const rollLoot = (tier) => weightedPick(CRATE_TABLES[tier]);
  const randomClassConsumable = () => CLASS_CONSUMABLES[Math.floor(Math.random() * CLASS_CONSUMABLES.length)];

  /* ---------- LEGENDARY WEAPONS ---------- */
  // additive stat deltas by weapon type (from the design table; blanks = mild generic buff)
  const LEGENDARY_MODS = {
    'Assault Rifle': { dDamage: 5, dFirerate: 1, dMag: 5, dReloadS: -0.3, dAcc: -0.4, dRec: -0.05, dHandS: -0.06, dWeight: -2, dFalloffPct: -1 },
    'Burst Rifle':   { dDamage: 3, dMag: 6, dReloadS: -0.2, dAcc: -0.4, dRec: -0.05, dHandS: -0.04, dWeight: -2, dFalloffPct: -1, dBurstDelayS: -0.03 },
    'LMG':           { dDamage: 3, dFirerate: 2, dMag: 15, dReloadS: -1.5, dAcc: -1, dRec: -0.02, dHandS: -0.1, dWeight: -3, dFalloffPct: -1 },
    'SMG':           { dDamage: 3, dFirerate: 2, dAcc: -0.4, dRec: -0.04, dMag: 6 },
    'Shotgun':       { dDamage: 2, dMag: 3, dReloadS: -0.3, dAcc: -0.5, dRec: -0.07, actionOverride: 'semi' }, // +2 per pellet
    'Sniper Rifle':  { dDamage: 4, dFirerate: -1, dMag: 5, dAcc: -0.3 },
    // undecided in the doc → a modest across-the-board bump so gold still feels special
    'DMR':           { dDamage: 6, dAcc: -0.3, dRec: -0.1, dMag: 4 },
    'Pistol':        { dDamage: 6, dFirerate: 1, dMag: 3, dAcc: -0.3 },
    'Carbine':       { dDamage: 4, dFirerate: 1, dMag: 5, dAcc: -0.3, dRec: -0.03 },
    'Launcher':      { dDamage: 15, dReloadS: -0.4 },
  };

  /* best weapon of a class = highest raw per-trigger damage in that class */
  function bestOfClass(className) {
    const group = Weapons.byClass()[className] || Weapons.list;
    return group.reduce((best, w) =>
      (w.damage * w.pellets * w.burst) > (best.damage * best.pellets * best.burst) ? w : best, group[0]);
  }

  /* produce the legendary ("Gold") version of a base weapon */
  function makeLegendary(baseWeapon) {
    const mods = LEGENDARY_MODS[baseWeapon.type] || {};
    return Weapons.withMods(baseWeapon, mods);
  }

  return {
    CONSUMABLES, CRATE_TABLES, CRATE_RARITY, CRATE_STYLE, LEGENDARY_MODS,
    weightedPick, rollCrateTier, rollLoot, randomClassConsumable,
    bestOfClass, makeLegendary,
  };
})();
