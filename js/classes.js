/* ============================================================
   classes.js — the 10 playable classes and their tools.

   A player's class comes from the weapon they have equipped
   (every gun in the roster belongs to exactly one class), so
   picking a gun in the Loadout screen picks the class with it.

   Engine mapping notes:
     • Melee Range is in design "units" — RANGE_UNIT px each.
     • Structure Damage / Pierce apply to walls, sandbags, barbed
       wire and player-built cover (see game.js structures).
     • Tools with no melee damage are passive gadgets: pressing
       [V] toggles them instead of swinging.
   ============================================================ */
const Classes = (() => {
  const RANGE_UNIT = 24;                 // 1 melee range unit ≈ 24px
  const px = (units) => units * RANGE_UNIT;

  /* ---------- TOOLS ----------
     Melee balance rationale (survev-inspired):
       • Damage is moderate (35-55 per swing) so melees can't one-shot as easily
       • Range is short (2-4 range units = 48-96px) so melees need commitment
       • Cooldowns force deliberate swings: 0.4–0.7s means DPS caps out ~100
       • Pierce is scaled per tool type: wire/sandbag clearing adds utility
       • Shield / Building / Revive are tactical tools with movement tradeoffs
     Raw TTK: P90 at close range ≈ 0.5s (5 rounds); bayonet ≈ 2.5s (3 swings).
     Melees win only inside rooms or through surprise; open field = rifle wins.
  */
  const TOOLS = {
    bayonet: {
      id: 'bayonet', name: 'Bayonet', icon: '🗡️',
      melee: 38, range: px(3.5), structure: 5, pierce: 1, cooldown: 0.45,
      clears: 'wire',                                   // shreds barbed wire in one swing
      effects: ['Barbed Wire Clearing'],
    },
    binoculars: {
      id: 'binoculars', name: 'Binoculars', icon: '🔭',
      melee: 0, range: 0, structure: 0, pierce: 0, cooldown: 0,
      passive: true, zoom: 2, slow: 0.65, noFire: true, // holding binos = can't shoot
      effects: ['2x Zoom'],
    },
    'trench-spade': {
      id: 'trench-spade', name: 'Trench Spade', icon: '🛠️',
      melee: 32, range: px(3), structure: 10, pierce: 2, cooldown: 0.5,
      clears: 'sandbag', digs: true,                    // can dig a covering trench
      effects: ['Sandbag Clearing', 'Trench Digging'],
    },
    'fire-axe': {
      id: 'fire-axe', name: 'Fire Axe', icon: '🪓',
      melee: 45, range: px(3), structure: 25, pierce: 2, cooldown: 0.55,
      vs: { wood: 3 },                                  // 3x damage to wooden structures
      effects: ['3x Wood Damage'],
    },
    'riot-shield': {
      id: 'riot-shield', name: 'Riot Shield', icon: '🛡️',
      melee: 28, range: px(2.5), structure: 15, pierce: 2, cooldown: 0.6,
      shield: true, slow: 0.35, adsOnlyFire: true,      // only shoot while scoping
      effects: ['100% Damage Reduction (front, while scoping)', '-35% Speed', 'Can only shoot while scoping'],
    },
    nvg: {
      id: 'nvg', name: 'Night Vision Goggles', icon: '🥽',
      melee: 0, range: 0, structure: 0, pierce: 0, cooldown: 0,
      passive: true, nightFov: 0.25,                    // +25% spotting range, green tint
      effects: ['25% Night FOV'],
    },
    ghillie: {
      id: 'ghillie', name: 'Ghillie Suit', icon: '🌿',
      melee: 0, range: 0, structure: 0, pierce: 0, cooldown: 0,
      passive: true, camo: true,                        // invisible to bots in grass while still
      effects: ['Camouflage on grass'],
    },
    'stone-hammer': {
      id: 'stone-hammer', name: 'Stone Hammer', icon: '🔨',
      melee: 55, range: px(3), structure: 55, pierce: 3, cooldown: 0.8,
      builds: { type: 'wood', thickness: 0.5, length: 3, max: 8 },   // 50 HP, toughness 3
      effects: ['Building'],
    },
    defibrillator: {
      id: 'defibrillator', name: 'Defibrillator', icon: '⚡',
      melee: 0, range: px(2), structure: 0, pierce: 0, cooldown: 60,
      revive: true,
      effects: ['Instant Revive'],
    },
    'heat-goggles': {
      id: 'heat-goggles', name: 'Heat Vision Goggles', icon: '🌡️',
      melee: 0, range: 0, structure: 0, pierce: 0, cooldown: 0,
      passive: true, heat: 700,                         // see bodies through walls within 700px
      effects: ['Heat Detection'],
    },
  };

  /* ---------- CLASSES ---------- */
  // speed = multiplier on the equipped weapon's move speed
  // consumable = what you deploy with; limit = most you can ever carry of it
  const RAW = [
    ['Rifleman',      1,    'bayonet',       'frag',      3, 6,
      'The jack of all trades in battles: able to cover medium to long ranges with their assault rifle and are very versatile.'],
    ['Scout',         1.25, 'binoculars',    'pills',     3, 4,
      'Explore, observe and gather critical information about enemy positions and placements.'],
    ['Gunner',        1,    'trench-spade',  'ammobox',   1, 3,
      'Use your machine gun to help teammates pin down enemies with heavy and sustained fire.'],
    ['Assault',       1.1,  'fire-axe',      'smoke',     3, 3,
      'Enter close-quarter battles with your submachine gun to aggressively clear rooms and push enemy territory.'],
    ['Breacher',      1,    'riot-shield',   'flashbang', 3, 6,
      'Break into the battle with shotguns and melees to tear through enemy walls and defences.'],
    ['Marksman',      1,    'nvg',           'impact',    2, 4,
      'Help your squadmates with your designated marksman rifle and its long range fire capabilities.'],
    ['Sniper',        1,    'ghillie',       'mine',      2, 2,
      'Take out enemies before they ever see you with extreme accuracy and range, plus a specialized scope.'],
    ['Engineer',      1,    'stone-hammer',  'sentry',    1, 1,
      'Equipped with your stone hammer, build your walls and defences as the engineer and protect your teammates.'],
    ['Medic',         1.1,  'defibrillator', 'medkit',    1, 2,
      'With your medkit and defibrillator, heal and revive your teammates whenever needed.'],
    ['Demolitionist', 1,    'heat-goggles',  'c4',        3, 9,
      'Wreck enemy vehicles and create entry points throughout any building or defense.'],
  ];

  const CLASSES = {};
  const list = RAW.map(([name, speed, toolId, item, start, limit, desc]) => {
    const meta = (typeof Weapons !== 'undefined' && Weapons.CLASS_META[name]) || {};
    const c = {
      name, speed, toolId, tool: TOOLS[toolId],
      consumable: item, startCount: start, limit,
      desc, icon: meta.icon || '🎖️', color: meta.color || '#3d7bff',
    };
    CLASSES[name] = c;
    return c;
  });

  /* Carry capacity. The design table's limits were tight enough that you ran
     dry constantly, so both caps are scaled up: your class kit carries double
     the table value, and looted odds and ends cap at 5 instead of 3. The table
     ratios between classes are preserved — a Demolitionist still hauls far
     more C4 than a Sniper does mines. */
  const CARRY_MULT = 3;
  const GENERIC_LIMIT = 8;   // cap on anything looted that isn't your class kit

  const byName = (name) => CLASSES[name] || CLASSES.Rifleman;
  const forWeapon = (w) => byName(w && w.className);
  /* A bag multiplies both what you deploy with and what you can hold: T1
     doubles it, T2 triples, T3 quadruples. Passed as a tier so callers can
     hand over `player.bag` without knowing the table (see Combat.BAGS). */
  const bagMult = (tier) =>
    (typeof Combat !== 'undefined' ? Combat.bag(tier).capacity : 1);
  /* how many of `itemId` this class may carry */
  /* `perk` is optional: Cargo Pants adds a flat two to whatever the bag and
     the class already allow. */
  const limitFor = (cls, itemId, bag, perk) => Math.ceil(bagMult(bag)
    * (cls.consumable === itemId ? Math.ceil(cls.limit * CARRY_MULT) : GENERIC_LIMIT))
    + (typeof Perks !== 'undefined' ? Perks.byId(perk).mods.consumablePlus || 0 : 0);
  /* what you actually spawn holding */
  const startFor = (cls, bag, perk) => Math.min(
    Math.ceil(cls.startCount * CARRY_MULT * bagMult(bag)),
    limitFor(cls, cls.consumable, bag, perk),
  );

  return { TOOLS, CLASSES, list, byName, forWeapon, limitFor, startFor, GENERIC_LIMIT, CARRY_MULT, RANGE_UNIT };
})();
