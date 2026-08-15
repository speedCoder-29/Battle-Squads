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
  /* Explosive & Tactical Balance Philosophy (survev.io-inspired):
     • Grenades → area denial with steep falloff (high center dmg, edges weak)
     • Deployables → higher risk than throws (arm delay, LOS checks, expose your position)
     • Sentry → mobile threat requiring team focus; elevated to DPS ~120 vs rifles ~150
     • Utility (smoke, flash, flag) → objective play, not raw kills
     • All explosives scale via distance formula: dmg * (1 - d / radius) * falloff
     → Higher falloff = steeper drop-off at edges, forces center-mass commitment
  */
  const CONSUMABLES = {
    // grenades (thrown) ---------------------------------------------------
    frag:      { name: 'Frag',       cat: 'grenade', mode: 'fuze',   icon: '💣', fuze: 3.2, damage: 110, falloff: 0.30, radius: 160 },
    impact:    { name: 'Impact Gren',cat: 'grenade', mode: 'impact', icon: '💥', damage: 65,  falloff: 0.35, radius: 110 },
    c4:        { name: 'C4',         cat: 'grenade', mode: 'c4',     icon: '🧿', fuze: 3, damage: 95,  falloff: 0.55, radius: 125, throwRange: 170 },
    smoke:     { name: 'Smoke',      cat: 'grenade', mode: 'smoke',  icon: '🌫️', fuze: 3, duration: 18, radius: 140 },
    flashbang: { name: 'Flashbang',  cat: 'grenade', mode: 'flash',  icon: '⚡', fuze: 4.5, radius: 270, blind: 2.8 },

    // tactical (deployed at your position) --------------------------------
    mine:      { name: 'Mine',       cat: 'tactical', mode: 'mine',  icon: '🔺', damage: 115, falloff: 1.0, radius: 110, trigger: 75, arm: 1.2 },
    barricade: { name: 'Barricade',  cat: 'tactical', mode: 'wall',  icon: '🧱', place: 5, life: 60, w: 120, h: 22 },
    ammobox:   { name: 'Ammo Box',   cat: 'tactical', mode: 'ammo',  icon: '📦', supply: 200, life: 45 },
    flag:      { name: 'Cool Flag',  cat: 'tactical', mode: 'flag',  icon: '🚩', radius: 250, adr: 10, speed: 0.25, life: 40 },
    // 14 tiles of reach — short of an assault rifle, so a sentry holds a room
    // or a doorway rather than a whole approach
    sentry:    { name: 'Sentry Gun', cat: 'tactical', mode: 'sentry',icon: '🔫', hp: 180, range: 700, damage: 15.8, rof: 7.5, life: 75 },

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
  // Regional loot pools for distinctive buildings
  const CRATE_TABLES = {
    regular: [
      { id: 'bandage',        w: 20, label: 'Bandage' },
      { id: 'soda',           w: 15, label: 'Soda' },
      { id: 'stim',           w: 5,  label: 'Stim Injection' },
      { id: 'classConsumable',w: 20, label: 'Class Consumable' },
      { id: 'ammo',           w: 25, label: 'Ammo' },
      { id: 'armorT1',        w: 15, label: 'Armor T1' },
    ],
    silver: [
      { id: 'soda',           w: 15, label: 'Soda' },
      { id: 'stim',           w: 10, label: 'Stim Injection' },
      { id: 'classConsumable',w: 15, label: 'Class Consumable' },
      { id: 'jeep',           w: 25, label: 'Armored Jeep' },
      { id: 'flag',           w: 15, label: 'Cool Flag' },
      { id: 'armorT2',        w: 20, label: 'Armor T2' },
    ],
    gold: [
      { id: 'stim',           w: 15, label: 'Stim Injection' },
      { id: 'tank',           w: 15, label: 'Tank' },
      { id: 'jeep',           w: 20, label: 'Armored Jeep' },
      { id: 'legendary',      w: 30, label: 'Legendary Weapon' },
      { id: 'armorT3',        w: 20, label: 'Armor T3' },
    ],
    /* A chest is the thing at the end of the tunnel. It pays out three times
       rather than once (see CRATE_PAYOUT), so it is worth the walk down and
       worth fighting somebody over — and it takes long enough to open that
       doing so in the open is a decision rather than a reflex. */
    chest: [
      { id: 'legendary',      w: 26, label: 'Legendary Weapon' },
      { id: 'armorT3',        w: 20, label: 'Armor T3' },
      { id: 'stim',           w: 14, label: 'Stim Injection' },
      { id: 'medkit',         w: 12, label: 'Medkit' },
      { id: 'classConsumable',w: 12, label: 'Class Consumable' },
      { id: 'tank',           w: 8,  label: 'Tank' },
      { id: 'jeep',           w: 8,  label: 'Armored Jeep' },
    ],
    /* What you find in the furniture. Searching a locker is not opening a
       crate — it is quick, it is everywhere, and it mostly turns up something
       small. The point is that a furnished room is worth walking through
       rather than worth looking at. */
    furniture: [
      { id: 'ammo',           w: 30, label: 'Ammo' },
      { id: 'bandage',        w: 22, label: 'Bandage' },
      { id: 'soda',           w: 14, label: 'Soda' },
      { id: 'classConsumable',w: 12, label: 'Class Consumable' },
      { id: 'pills',          w: 10, label: 'Pills' },
      { id: 'armorT1',        w: 8,  label: 'Armor T1' },
      { id: 'stim',           w: 4,  label: 'Stim Injection' },
    ],
    /* Regional pools — building-type loot tied to theme */
    medical: [
      { id: 'bandage',        w: 25, label: 'Bandage' },
      { id: 'medkit',         w: 20, label: 'Medkit' },
      { id: 'stim',           w: 15, label: 'Stim Injection' },
      { id: 'pills',          w: 15, label: 'Pills' },
      { id: 'ammo',           w: 15, label: 'Ammo' },
      { id: 'armorT1',        w: 10, label: 'Armor T1' },
    ],
    industrial: [
      { id: 'ammo',           w: 30, label: 'Ammo' },
      { id: 'classConsumable',w: 25, label: 'Class Consumable' },
      { id: 'bandage',        w: 15, label: 'Bandage' },
      { id: 'armorT2',        w: 20, label: 'Armor T2' },
      { id: 'mine',           w: 10, label: 'Mine' },
    ],
    military: [
      { id: 'ammo',           w: 25, label: 'Ammo' },
      { id: 'classConsumable',w: 20, label: 'Class Consumable' },
      { id: 'frag',           w: 15, label: 'Frag Grenade' },
      { id: 'stim',           w: 10, label: 'Stim Injection' },
      { id: 'armorT3',        w: 20, label: 'Armor T3' },
      { id: 'sentry',         w: 10, label: 'Sentry Gun' },
    ],
  };
  // how often each crate tier appears on the map
  const CRATE_RARITY = [ { tier: 'regular', w: 60 }, { tier: 'silver', w: 30 }, { tier: 'gold', w: 10 } ];
  const CRATE_STYLE = {
    regular: { color: '#8ea0c9', icon: '📦', name: 'Crate' },
    silver:  { color: '#cfd8ee', icon: '🎁', name: 'Silver Crate' },
    gold:    { color: '#ffcf4a', icon: '🏆', name: 'Gold Crate' },
    chest:   { color: '#e0913a', icon: '🧰', name: 'Chest' },
    medical: { color: '#c46bff', icon: '⛑️', name: 'Medical Cache' },
    industrial: { color: '#9bacc9', icon: '🔧', name: 'Supply Crate' },
    military: { color: '#4a6280', icon: '🎖️', name: 'Ammo Cache' },
    furniture: { color: '#b08a55', icon: '🔍', name: 'Search' },
  };

  /* How many rolls opening one of these gives you, and how long it takes.
     A crate is one roll and instant; a chest is three and takes a moment,
     which is what makes standing over one a risk worth taking. */
  const CRATE_PAYOUT = {
    chest: { rolls: 3, openMs: 1400 },
    gold: { rolls: 1, openMs: 0 },
    furniture: { rolls: 1, openMs: 0 },
  };
  const payoutFor = (tier) => CRATE_PAYOUT[tier] || { rolls: 1, openMs: 0 };

  // "Class Consumable" pool — fallback when we don't know the opener's class
  const CLASS_CONSUMABLES = ['frag', 'impact', 'smoke', 'flashbang', 'mine', 'barricade', 'ammobox', 'c4'];
  // a class drop should really give *your* kit (see Classes.CLASSES)
  const classConsumableFor = (className) => {
    const c = (typeof Classes !== 'undefined') && Classes.CLASSES[className];
    return c ? c.consumable : randomClassConsumable();
  };

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
    CONSUMABLES, CRATE_TABLES, CRATE_RARITY, CRATE_STYLE, CRATE_PAYOUT, payoutFor, LEGENDARY_MODS,
    weightedPick, rollCrateTier, rollLoot, randomClassConsumable, classConsumableFor,
    bestOfClass, makeLegendary,
  };
})();
