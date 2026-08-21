/* ============================================================
   perks.js — one passive trait you bring into the match.

   The design table is the roster. Everything in it is here, with
   the numbers as written.

   Two entries are not from the table and are marked `extra`:

     • Diver, because the loot table requires it — a Swimming Pool
       holds a silver crate "must have Diver perk", and without the
       perk that crate is either free or unreachable.
     • Juggernaut, Field Medic, Breacher and Ghost, which were
       written to fill the gap before the table existed. They are
       kept rather than deleted, but they are not canon; dropping
       them is a matter of deleting their entries here.

   Design rules:
     • You get exactly one. Picking Jogger means not picking Beefy.
     • Every perk hooks something that already exists — armour
       weight, adrenaline, magazine size, the toughness ladder —
       rather than adding a parallel system nobody can see.
     • Anything that changes movement, health or reload has to be
       known by the authoritative room as well as the client, or
       the two disagree. Those are `synced`, and js/party.js sends
       the id with the join.
   ============================================================ */
const Perks = (() => {

  const PERKS = {
    none: {
      id: 'none', name: 'No Perk', icon: '—',
      blurb: 'Nothing. A perfectly reasonable choice.',
      effects: [], mods: {},
    },

    /* ---------- the design table ---------- */
    sprinter: {
      id: 'sprinter', name: 'Sprinter', icon: '🏃', synced: true,
      blurb: 'Adrenaline carries you further than it carries anyone else.',
      effects: ['+25% adrenaline speed buff'],
      mods: { adrenSpeedMult: 1.25 },
    },
    jogger: {
      id: 'jogger', name: 'Jogger', icon: '👟', synced: true,
      blurb: 'Quicker on your feet, all the time, with no setup.',
      effects: ['+10% movement speed'],
      mods: { speedMult: 1.10 },
    },
    kevlar: {
      id: 'kevlar', name: 'Kevlar Vest', icon: '🦺',
      blurb: 'A tenth of everything, off the top.',
      effects: ['+10% damage reduction'],
      mods: { dr: 0.10 },
    },
    flak: {
      id: 'flak', name: 'Flak Jacket', icon: '🧥',
      blurb: 'Grenades, launchers and barrels stop deciding fights.',
      effects: ['+90% explosion damage reduction'],
      mods: { explosiveMult: 0.10 },
    },
    cargo: {
      id: 'cargo', name: 'Cargo Pants', icon: '👖',
      blurb: 'Two more of whatever you are carrying.',
      effects: ['+2 consumable limit'],
      mods: { consumablePlus: 2 },
    },
    bulletstrap: {
      id: 'bulletstrap', name: 'Bullet Strap', icon: '🎽', synced: true,
      blurb: 'Two more magazines on the chest — or a belt of shells.',
      effects: ['+2 magazines', '+18 shells on a shotgun'],
      mods: { magsPlus: 2, shellsPlus: 18 },
    },
    satellite: {
      id: 'satellite', name: 'Portable Satellite', icon: '📡',
      blurb: 'Gunfire you can hear becomes gunfire you can see.',
      effects: ['Shots around you show a direction and a range'],
      mods: { sound: true },
    },
    scavenger: {
      id: 'scavenger', name: 'Scavenger', icon: '🎒',
      blurb: 'Trees and walls are worth breaking, not just going round.',
      effects: ['20% chance of crate loot from anything you destroy'],
      mods: { salvage: 0.20 },
    },
    beefy: {
      id: 'beefy', name: 'Beefy', icon: '💪', synced: true,
      blurb: 'One more rifle round of living.',
      effects: ['+10 max HP'],
      mods: { hpPlus: 10 },
    },
    quickhands: {
      id: 'quickhands', name: 'Quick Hands', icon: '🤲', synced: true,
      blurb: 'The reload you didn’t think you had time for.',
      effects: ['-20% reload time', '-20% handling (faster to aim)'],
      mods: { reloadMult: 0.80, handlingMult: 0.80 },
    },
    weightlifter: {
      id: 'weightlifter', name: 'Weight Lifter', icon: '🏋️', synced: true,
      blurb: 'The heavy guns stop feeling heavy.',
      effects: ['-30% of the speed a heavy weapon costs you'],
      mods: { weightRelief: 0.30 },
    },

    /* ---------- required by the loot table ---------- */
    /* ---------- beyond the table ----------
       Marked `extra` so the design-table checks can tell them apart from the
       eleven the table specifies. */
    lockpick: {
      id: 'lockpick', name: 'Lockpick', icon: '🔧', extra: true,
      blurb: 'Every locker has a false bottom if you know where to look.',
      effects: ['Searching furniture gives a second item'],
      mods: { furnitureBonus: 1 },
    },
    trenchrunner: {
      id: 'trenchrunner', name: 'Trench Runner', icon: '🥾', synced: true, extra: true,
      blurb: 'Wire is something to cross, not something to go round.',
      effects: ['Barbed wire does not slow you'],
      mods: { ignoreHazardSlow: true },
    },

    diver: {
      id: 'diver', name: 'Diver', icon: '🤿', synced: true, extra: true,
      blurb: 'Water doesn’t slow you, and you can reach what sank in it.',
      effects: ['Full speed swimming', 'Opens Swimming Pool crates'],
      mods: { swim: true },
    },

    /* ---------- written before the table existed ---------- */
    juggernaut: {
      id: 'juggernaut', name: 'Juggernaut', icon: '🛡️', synced: true, extra: true,
      blurb: 'Plate carries like cloth — a T3 vest with none of the weight.',
      effects: ['Armour costs no movement speed'],
      mods: { noArmourWeight: true },
    },
    medic: {
      id: 'medic', name: 'Field Medic', icon: '⛑️', synced: true, extra: true,
      blurb: 'Adrenaline goes further and works harder.',
      effects: ['Adrenaline burns half as fast', '+50% adrenaline healing'],
      mods: { adrenBurnMult: 0.5, adrenRegenMult: 1.5 },
    },
    breacher: {
      id: 'breacher', name: 'Breacher', icon: '🔨', extra: true,
      blurb: 'Walls are a suggestion. Doors are a formality.',
      effects: ['+1 tool Structure Pierce', 'Double damage to structures'],
      mods: { piercePlus: 1, structureMult: 2 },
    },
    ghost: {
      id: 'ghost', name: 'Ghost', icon: '🌫️', extra: true,
      blurb: 'Cover keeps working while you move, and nobody hears you coming.',
      effects: ['Bushes conceal you while moving', 'Gunfire draws no attention'],
      mods: { moveConceal: true, silent: true },
    },
  };

  const list = Object.values(PERKS);
  const byId = (id) => PERKS[id] || PERKS.none;
  /* Does this agent have that perk? Takes the agent rather than the id so
     every call site reads the same way, and so an agent with no perk field
     at all — a bot, a vehicle — simply answers no. */
  const has = (a, id) => !!a && a.perk === id;
  /* One perk's numbers, read off whoever is holding it. `dflt` is what you
     get when they have no perk, or a perk that doesn't touch this. */
  const mod = (a, key, dflt) => {
    const m = byId(a && a.perk).mods;
    return m[key] !== undefined ? m[key] : dflt;
  };
  /* the ids the room has to be told about, because they change the numbers
     both sides compute independently */
  const SYNCED = list.filter(p => p.synced).map(p => p.id);

  /* ---------- the weapon you actually carry ----------
     Bullet Strap is the one perk that rewrites the gun rather than the body,
     so it has to be applied wherever a weapon is built — the client's loadout
     and the room's join — or the two disagree about how many rounds are in
     the magazine. One function, called by both.

     A shotgun counts in shells: the table gives it 18 rather than two more
     tubes, because two more tubes of an M870 is ten shells and two more
     magazines of an M16 is forty. */
  function applyToWeapon(weapon, perk) {
    if (!weapon) return weapon;
    const m = byId(perk).mods;
    if (!m.magsPlus && !m.shellsPlus && !m.handlingMult) return weapon;
    const shellFed = (weapon.pellets || 1) > 1;
    const extra = shellFed ? (m.shellsPlus || 0) : weapon.mag * (m.magsPlus || 0);
    return {
      ...weapon,
      mag: weapon.mag + extra,
      // Quick Hands also lightens the gun in the hands. Handling is the
      // aim-down-sights time; it is currently a displayed stat rather than a
      // simulated one, so this shows up in the gunsmith and is ready for the
      // day ADS stops being instant.
      handling: weapon.handling * (m.handlingMult || 1),
    };
  }

  /* Max HP, which Beefy raises. Combat owns the base figure per target class;
     this is the one place a perk is allowed to move it. */
  const maxHpFor = (base, perk) => base + (byId(perk).mods.hpPlus || 0);

  return { PERKS, list, byId, has, mod, SYNCED, applyToWeapon, maxHpFor, DEFAULT: 'none' };
})();

/* the shared sim requires this on the server, where there are no globals */
if (typeof module === 'object' && module.exports) module.exports = Perks;
