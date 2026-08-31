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
    /* Silver is the middle of the ladder: better armour and the useful
       consumables, and the transport moves up to gold where it belongs — a
       jeep out of a common box was the single most valuable thing on the map
       arriving from the second-cheapest source. */
    silver: [
      { id: 'soda',           w: 14, label: 'Soda' },
      { id: 'stim',           w: 14, label: 'Stim Injection' },
      { id: 'medkit',         w: 10, label: 'Medkit' },
      { id: 'classConsumable',w: 18, label: 'Class Consumable' },
      { id: 'flag',           w: 8,  label: 'Cool Flag' },
      { id: 'armorT2',        w: 28, label: 'Armor T2' },
      { id: 'jeep',           w: 8,  label: 'Armored Jeep' },
    ],
    /* Gold is the top of the ladder a box can reach. A legendary is still the
       headline, but it is now one outcome in four of a crate that is itself
       one in twenty-five — so finding one is an event rather than a fact of
       the map. */
    gold: [
      { id: 'legendary',      w: 25, label: 'Legendary Weapon' },
      { id: 'armorT3',        w: 26, label: 'Armor T3' },
      { id: 'jeep',           w: 18, label: 'Armored Jeep' },
      { id: 'tank',           w: 13, label: 'Tank' },
      { id: 'medkit',         w: 10, label: 'Medkit' },
      { id: 'stim',           w: 8,  label: 'Stim Injection' },
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
  /* ---------- how often each tier appears ----------
     Was 60/30/10, and a gold crate carried a legendary a third of the time —
     so three per cent of every box on the map was a gold gun, and a map holds
     about a thousand boxes. Thirty-two legendaries for sixteen players is two
     each: at that supply the "legendary" is the baseline and every stock
     weapon is a strictly worse version of what everybody is already carrying.

     Gold is now genuinely uncommon, and the legendary inside it is the
     uncommon outcome of an uncommon box. The guaranteed sources — a chest at
     the end of a tunnel, a supply drop the whole map was told about — are
     unchanged, because those are places you fight over rather than boxes you
     walk past. */
  const CRATE_RARITY = [ { tier: 'regular', w: 72 }, { tier: 'silver', w: 24 }, { tier: 'gold', w: 4 } ];
  /* ---------- the supply drop ----------
     What a plane puts on the map halfway through a match. Richer than a chest
     — this is the best loot in the game — but there is only ever one of it,
     everybody is told where it landed, and it takes long enough to open that
     doing so is a decision rather than a reflex. The point is not the loot; it
     is that for thirty seconds the whole map has the same destination. */
  CRATE_TABLES.airdrop = [
    { id: 'legendary',       w: 30, label: 'Legendary Weapon' },
    { id: 'armorT3',         w: 18, label: 'Armor T3' },
    { id: 'tank',            w: 12, label: 'Tank' },
    { id: 'medkit',          w: 12, label: 'Medkit' },
    { id: 'stim',            w: 10, label: 'Stim Injection' },
    { id: 'classConsumable', w: 10, label: 'Class Consumable' },
    { id: 'jeep',            w: 8,  label: 'Armored Jeep' },
  ];

  const CRATE_STYLE = {
    regular: { color: '#8ea0c9', icon: '📦', name: 'Crate' },
    silver:  { color: '#cfd8ee', icon: '🎁', name: 'Silver Crate' },
    gold:    { color: '#ffcf4a', icon: '🏆', name: 'Gold Crate' },
    chest:   { color: '#e0913a', icon: '🧰', name: 'Chest' },
    medical: { color: '#c46bff', icon: '⛑️', name: 'Medical Cache' },
    industrial: { color: '#9bacc9', icon: '🔧', name: 'Supply Crate' },
    military: { color: '#4a6280', icon: '🎖️', name: 'Ammo Cache' },
    furniture: { color: '#b08a55', icon: '🔍', name: 'Search' },
    airdrop: { color: '#7ff2c1', icon: '🪂', name: 'Supply Drop' },
  };

  /* How many rolls opening one of these gives you, and how long it takes.
     A crate is one roll and instant; a chest is three and takes a moment,
     which is what makes standing over one a risk worth taking. */
  const CRATE_PAYOUT = {
    // four rolls, and the longest open in the game — you are standing still in
    // the open, at a spot every squad was told about
    airdrop: { rolls: 4, openMs: 2200 },
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
  /* ---------- what "gold" means ----------
     It used to mean something different in every hand. Measured against the
     base weapon of each class, the old table gave a sniper +4% damage and an
     SMG +40% — so a gold SMG collapsed its time-to-kill from fourteen rounds
     to ten while a gold sniper was a rounding error, and whether the best gun
     in the game was worth picking up depended entirely on which class it was.

     The rework holds two lines:

       • DAMAGE MOVES A LITTLE, THE SAME LITTLE. Roughly a tenth, across the
         board, and never enough to cross a shots-to-kill breakpoint on its
         own. A legendary should win a fight it was going to win anyway, not
         change the arithmetic of the fight.

       • THE REST OF THE UPLIFT IS FEEL. Magazine, reload, recoil, handling,
         falloff — the things that make a weapon pleasant to hold rather than
         mathematically superior. That is what makes gold worth carrying
         without making stock weapons worthless.

     Snipers and launchers get almost no damage at all, because both already
     kill in one and more damage buys them literally nothing. */
  const LEGENDARY_MODS = {
    'Assault Rifle': { dDamage: 1, dFirerate: 1, dMag: 10, dReloadS: -0.5, dAcc: -0.5, dRec: -0.06, dHandS: -0.06, dWeight: -3, dFalloffPct: -2 },
    'Burst Rifle':   { dDamage: 2, dMag: 10, dReloadS: -0.4, dAcc: -0.5, dRec: -0.06, dHandS: -0.05, dWeight: -3, dFalloffPct: -2, dBurstDelayS: -0.04 },
    /* No damage on these two. Their per-round figures are small enough that a
       single point is a 7-13% jump, which is exactly the size that walks a
       shots-to-kill count down a step — so their uplift goes into rate, which
       shortens the kill continuously instead of in a jump. */
    'LMG':           { dFirerate: 3, dMag: 50, dReloadS: -1.8, dAcc: -1, dRec: -0.04, dHandS: -0.1, dWeight: -4, dFalloffPct: -2 },
    'SMG':           { dFirerate: 3, dMag: 12, dReloadS: -0.4, dAcc: -0.5, dRec: -0.05, dWeight: -2 },
    // no extra pellet damage: a shotgun already one-shots at contact, so the
    // gold version gets the semi-auto action and the reload instead
    'Shotgun':       { dMag: 4, dReloadS: -0.5, dAcc: -0.6, dRec: -0.08, actionOverride: 'semi' },
    // it already kills in one — what it wants is more of them, faster
    'Sniper Rifle':  { dMag: 6, dFirerate: 1, dReloadS: -0.8, dAcc: -0.4, dRec: -0.05, dHandS: -0.08 },
    'DMR':           { dDamage: 2, dFirerate: 1, dAcc: -0.4, dRec: -0.12, dMag: 8, dReloadS: -0.4 },
    'Pistol':        { dDamage: 3, dFirerate: 2, dMag: 6, dReloadS: -0.3, dAcc: -0.4 },
    'Carbine':       { dDamage: 1, dFirerate: 1, dMag: 10, dReloadS: -0.5, dAcc: -0.4, dRec: -0.04, dWeight: -2 },
    // one in the tube either way; what changes is how fast the next one is
    'Launcher':      { dReloadS: -0.9, dAcc: -0.4, dHandS: -0.1 },
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
