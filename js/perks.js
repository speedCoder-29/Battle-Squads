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

  /* ---------- three slots, three sections ----------
     You used to bring one perk. You now bring three, one from each section,
     and the sections are what keep that from being three times the power:

       BODY   what you are made of -- armour, health, how you move
       KIT    what you carry -- magazines, reloads, tools, what you can break
       FIELD  how you work the map -- awareness, salvage, the things that are
              not about winning the fight directly in front of you

     One from each means you cannot stack three movement perks or three
     damage-reduction perks, and every build gives something up: a player who
     wants to be fast pays for it in armour or in kit, because the fast perks
     all live in the same section and there is only one slot for them.

     The alternative -- three free picks off one list -- collapses inside a day
     into whichever three multiply together best, and then everybody runs it. */
  const SECTIONS = [
    { id: 'body',  name: 'Body',  blurb: 'What you are made of.' },
    { id: 'kit',   name: 'Kit',   blurb: 'What you carry into it.' },
    { id: 'field', name: 'Field', blurb: 'How you work the map.' },
  ];
  const SLOTS = SECTIONS.map(x => x.id);

  const PERKS = {
    none: {
      id: 'none', section: null, name: 'No Perk', icon: '—',
      blurb: 'Nothing. A perfectly reasonable choice.',
      effects: [], mods: {},
    },

    /* ---------- the design table ---------- */
    sprinter: {
      id: 'sprinter', section: 'field', name: 'Sprinter', icon: '🏃', synced: true,
      blurb: 'Adrenaline carries you further than it carries anyone else.',
      effects: ['+25% adrenaline speed buff'],
      mods: { adrenSpeedMult: 1.25 },
    },
    jogger: {
      id: 'jogger', section: 'body', name: 'Jogger', icon: '👟', synced: true,
      blurb: 'Quicker on your feet, all the time, with no setup.',
      effects: ['+10% movement speed'],
      mods: { speedMult: 1.10 },
    },
    kevlar: {
      id: 'kevlar', section: 'body', name: 'Kevlar Vest', icon: '🦺',
      blurb: 'A tenth of everything, off the top.',
      effects: ['+10% damage reduction'],
      mods: { dr: 0.10 },
    },
    flak: {
      id: 'flak', section: 'body', name: 'Flak Jacket', icon: '🧥',
      blurb: 'Grenades, launchers and barrels stop deciding fights.',
      /* 50%, not 90%.

         This sat at 0.10 — ninety per cent off — while the design table and
         the test both said half. Ninety is not a resistance, it is an
         immunity: a frag that takes 110 off anyone else takes 11 off you, so
         grenades, launchers, mines and barrels all stop existing for one perk
         slot, and there is no counterplay to a choice made in the menu.

         Halved is the number that does what the blurb says — explosives stop
         *deciding* fights without ceasing to matter. */
      effects: ['+50% explosion damage reduction'],
      mods: { explosiveMult: 0.50 },
    },
    cargo: {
      id: 'cargo', section: 'kit', name: 'Cargo Pants', icon: '👖',
      blurb: 'Two more of whatever you are carrying.',
      effects: ['+2 consumable limit'],
      mods: { consumablePlus: 2 },
    },
    bulletstrap: {
      id: 'bulletstrap', section: 'kit', name: 'Bullet Strap', icon: '🎽', synced: true,
      blurb: 'Two more magazines on the chest — or a belt of shells.',
      effects: ['+2 magazines', '+18 shells on a shotgun'],
      mods: { magsPlus: 2, shellsPlus: 18 },
    },
    satellite: {
      id: 'satellite', section: 'field', name: 'Portable Satellite', icon: '📡',
      blurb: 'Gunfire you can hear becomes gunfire you can see.',
      effects: ['Shots around you show a direction and a range'],
      mods: { sound: true },
    },
    scavenger: {
      id: 'scavenger', section: 'field', name: 'Scavenger', icon: '🎒',
      blurb: 'Trees and walls are worth breaking, not just going round.',
      effects: ['20% chance of crate loot from anything you destroy'],
      mods: { salvage: 0.20 },
    },
    beefy: {
      id: 'beefy', section: 'body', name: 'Beefy', icon: '💪', synced: true,
      blurb: 'One more rifle round of living.',
      effects: ['+10 max HP'],
      mods: { hpPlus: 10 },
    },
    quickhands: {
      id: 'quickhands', section: 'kit', name: 'Quick Hands', icon: '🤲', synced: true,
      blurb: 'The reload you didn’t think you had time for.',
      effects: ['-20% reload time', '-20% handling (faster to aim)'],
      mods: { reloadMult: 0.80, handlingMult: 0.80 },
    },
    weightlifter: {
      id: 'weightlifter', section: 'kit', name: 'Weight Lifter', icon: '🏋️', synced: true,
      blurb: 'The heavy guns stop feeling heavy.',
      effects: ['-30% of the speed a heavy weapon costs you'],
      mods: { weightRelief: 0.30 },
    },

    /* ---------- required by the loot table ---------- */
    /* ---------- beyond the table ----------
       Marked `extra` so the design-table checks can tell them apart from the
       eleven the table specifies. */
    lockpick: {
      id: 'lockpick', section: 'kit', name: 'Lockpick', icon: '🔧', extra: true,
      blurb: 'Every locker has a false bottom if you know where to look.',
      effects: ['Searching furniture gives a second item'],
      mods: {},
    },
    trenchrunner: {
      id: 'trenchrunner', section: 'body', name: 'Trench Runner', icon: '🥾', synced: true, extra: true,
      blurb: 'Wire is something to cross, not something to go round.',
      effects: ['Barbed wire does not slow you'],
      mods: { ignoreHazardSlow: true },
    },

    diver: {
      id: 'diver', section: 'body', name: 'Diver', icon: '🤿', synced: true, extra: true,
      blurb: 'Water doesn’t slow you, and you can reach what sank in it.',
      effects: ['Full speed swimming', 'Opens Swimming Pool crates'],
      mods: { swim: true },
    },

    /* ---------- written before the table existed ---------- */
    juggernaut: {
      id: 'juggernaut', section: 'body', name: 'Juggernaut', icon: '🛡️', synced: true, extra: true,
      blurb: 'Plate still weighs something — but only half what it weighs anyone else.',
      effects: ['Armour costs half the movement speed'],
      mods: { armourRelief: 0.5 },
    },
    medic: {
      id: 'medic', section: 'field', name: 'Field Medic', icon: '⛑️', synced: true, extra: true,
      blurb: 'Adrenaline goes further and works harder.',
      effects: ['Adrenaline burns half as fast', '+50% adrenaline healing'],
      mods: { adrenBurnMult: 0.5, adrenRegenMult: 1.5 },
    },
    breacher: {
      id: 'breacher', section: 'kit', name: 'Breacher', icon: '🔨', extra: true,
      blurb: 'Walls are a suggestion. Doors are a formality.',
      effects: ['+1 tool Structure Pierce', 'Double damage to structures'],
      mods: { piercePlus: 1, structureMult: 2 },
    },
    /* ---------- added with the third slot ----------
       Three slots only mean something if each section has enough in it that
       the pick is a pick. Every one of these hooks something the simulation
       already tracks -- a last-stand clock, a dash cooldown, a mark timer, the
       bloom a shot adds -- rather than inventing a parallel system nobody can
       see, which is the rule the roster above was written to. */
    secondwind: {
      id: 'secondwind', section: 'body', name: 'Second Wind', icon: 'SW', synced: true,
      blurb: 'You stay on your feet longer than you have any right to.',
      effects: ['+60% last stand duration'],
      mods: { standMult: 1.6 },
    },
    hardhead: {
      id: 'hardhead', section: 'body', name: 'Hard Head', icon: 'HH',
      blurb: 'Whatever helmet you found is worth one tier more on you.',
      effects: ['+1 effective helmet tier'],
      mods: { helmetPlus: 1 },
    },
    demolitions: {
      id: 'demolitions', section: 'kit', name: 'Demolitions', icon: 'DM',
      blurb: 'Two more of whatever goes bang, and it goes further.',
      effects: ['+2 grenades', '+15% explosion radius'],
      mods: { grenadePlus: 2, blastMult: 1.15 },
    },
    steadyaim: {
      id: 'steadyaim', section: 'kit', name: 'Steady Aim', icon: 'SA', synced: true,
      blurb: 'The gun climbs less, and settles faster when it does.',
      effects: ['-25% recoil bloom per shot'],
      mods: { recoilMult: 0.75 },
    },
    dasher: {
      id: 'dasher', section: 'field', name: 'Track Star', icon: 'TS',
      blurb: 'The dash is back before you have finished needing it.',
      effects: ['-40% dash cooldown'],
      mods: { dashCdMult: 0.6 },
    },
    spotter: {
      id: 'spotter', section: 'field', name: 'Spotter', icon: 'SP',
      blurb: 'What you mark stays marked, for the whole squad.',
      effects: ['+80% mark duration on enemies you spot'],
      mods: { markMult: 1.8 },
    },

    /* ---------- class perks ----------
       One per class, and you do not pick them: your class comes from the gun
       in your hands, and the class brings its own passive with it. That is the
       point of them. The three you choose say who you want to be; this one
       says what you actually turned up carrying, and it changes the moment you
       change your primary.

       Two consequences worth being deliberate about. Picking a rifle is now a
       decision about a perk as well as about a gun, which gives the weapon
       choice weight it did not have. And the section is `class`, which is not
       in SECTIONS -- so the loadout pickers, which iterate the sections, never
       offer these, and `normalise` never keeps one somebody tried to store in
       a chosen slot.

       Each is deliberately smaller than a chosen perk. Four passives is a lot,
       and the one you did not pick should not be the one that decides the
       fight. */
    cpRifleman: {
      id: 'cpRifleman', section: 'class', name: 'Standard Issue', icon: 'RF', synced: true,
      blurb: 'One more magazine on the chest, and you get through them quicker.',
      effects: ['+1 magazine', '-8% reload time'],
      mods: { magsPlus: 1, reloadMult: 0.92 },
    },
    cpScout: {
      id: 'cpScout', section: 'class', name: 'Light Pack', icon: 'SC', synced: true,
      blurb: 'You carry less than anybody, and it shows.',
      effects: ['+8% movement speed'],
      mods: { speedMult: 1.08 },
    },
    cpGunner: {
      id: 'cpGunner', section: 'class', name: 'Bipod', icon: 'GN', synced: true,
      blurb: 'Something to rest it on, and it stops fighting you.',
      effects: ['-20% recoil bloom'],
      mods: { recoilMult: 0.8 },
    },
    cpAssault: {
      id: 'cpAssault', section: 'class', name: 'Breach Pace', icon: 'AS',
      blurb: 'The next room is always the one you want to be in.',
      effects: ['-25% dash cooldown'],
      mods: { dashCdMult: 0.75 },
    },
    cpBreacher: {
      id: 'cpBreacher', section: 'class', name: 'Door Kicker', icon: 'BR',
      blurb: 'Walls are on the way to somewhere.',
      effects: ['+50% damage to structures'],
      mods: { structureMult: 1.5 },
    },
    cpMarksman: {
      id: 'cpMarksman', section: 'class', name: 'Ranging', icon: 'MK',
      blurb: 'What you call stays called for longer.',
      effects: ['+40% mark duration'],
      mods: { markMult: 1.4 },
    },
    cpSniper: {
      id: 'cpSniper', section: 'class', name: 'Field Craft', icon: 'SN', synced: true,
      blurb: 'The rifle comes onto the target faster than it has any right to.',
      effects: ['-15% handling (faster to aim)'],
      mods: { handlingMult: 0.85 },
    },
    cpEngineer: {
      id: 'cpEngineer', section: 'class', name: 'Toolkit', icon: 'EN',
      blurb: 'The hammer is back in your hands before you have put it down.',
      effects: ['-25% tool cooldown'],
      mods: { toolCdMult: 0.75 },
    },
    cpMedic: {
      id: 'cpMedic', section: 'class', name: 'Triage', icon: 'MD', synced: true,
      blurb: 'Adrenaline does more for you than it does for anyone else.',
      effects: ['+40% adrenaline healing'],
      mods: { adrenRegenMult: 1.4 },
    },
    cpDemolitionist: {
      id: 'cpDemolitionist', section: 'class', name: 'Blast Shield', icon: 'DE',
      blurb: 'You have been close to enough of them to know how to stand.',
      effects: ['+30% explosion damage reduction'],
      mods: { explosiveMult: 0.7 },
    },

    ghost: {
      id: 'ghost', section: 'field', name: 'Ghost', icon: '🌫️', extra: true,
      blurb: 'Cover keeps working while you move, and nobody hears you coming.',
      effects: ['Bushes conceal you while moving', 'Gunfire draws no attention'],
      mods: { moveConceal: true, silent: true },
    },
  };

  const list = Object.values(PERKS);
  const byId = (id) => PERKS[id] || PERKS.none;
  const inSection = (sec) => list.filter(x => x.section === sec);

  /* ---------- what an agent is actually carrying ----------
     One field, whatever shape it arrives in. `perks` is the array of three;
     `perk` is the single id the game used before this and which bots, saved
     profiles and the network join all still speak. Reading through one helper
     means the forty-odd call sites elsewhere never have to care which. */
  function listOf(a) {
    if (!a) return [];
    if (Array.isArray(a.perks)) return a.perks.filter(Boolean);
    /* `perk` holding an array too. combat.js and classes.js build a throwaway
       `{ perk }` from whatever their caller handed them, and their callers now
       hand them three. Accepting both shapes here is one line and saves
       touching every one of those call sites. */
    if (Array.isArray(a.perk)) return a.perk.filter(Boolean);
    return a.perk ? [a.perk] : [];
  }

  /* Does this agent have that perk? Takes the agent rather than the id so
     every call site reads the same way, and so an agent with no perks at all
     -- a vehicle, a training dummy -- simply answers no. */
  const has = (a, id) => listOf(a).indexOf(id) >= 0;

  /* ---------- combining three perks ----------
     With one perk a mod was a lookup. With three it is a fold, and how you
     fold depends on what the number means:

       mul    a multiplier on something. Two of them compose, so they multiply.
       add    a count -- magazines, grenades, hit points. They sum.
       cut    a fraction taken off. These do NOT sum: two 50% reductions are
              75%, not 100%, or a pair of perks would make you invulnerable.
       any    a flag. One perk saying yes is enough.

     In practice the sections mean most keys can only ever come from one perk,
     so the fold usually runs over a single value. It is written properly
     anyway, because "it cannot happen today" is how it comes to happen. */
  const COMBINE = {
    speedMult: 'mul', adrenSpeedMult: 'mul', reloadMult: 'mul', handlingMult: 'mul',
    explosiveMult: 'mul', adrenBurnMult: 'mul', adrenRegenMult: 'mul',
    structureMult: 'mul', standMult: 'mul', blastMult: 'mul', recoilMult: 'mul',
    dashCdMult: 'mul', markMult: 'mul', toolCdMult: 'mul',

    hpPlus: 'add', magsPlus: 'add', shellsPlus: 'add', consumablePlus: 'add',
    piercePlus: 'add', grenadePlus: 'add', helmetPlus: 'add', salvage: 'add',

    dr: 'cut', armourRelief: 'cut', weightRelief: 'cut',

    swim: 'any', sound: 'any', silent: 'any', moveConceal: 'any',
    ignoreHazardSlow: 'any',
  };

  /* The value of `key` across everything this agent is carrying. `dflt` is
     what you get when nothing they have touches it. */
  const mod = (a, key, dflt) => {
    const ids = listOf(a);
    if (!ids.length) return dflt;
    const rule = COMBINE[key] || 'mul';
    let acc = null;
    for (const id of ids) {
      const v = byId(id).mods[key];
      if (v === undefined) continue;
      if (acc === null) { acc = v; continue; }
      if (rule === 'add') acc += v;
      else if (rule === 'any') acc = acc || v;
      else if (rule === 'cut') acc = 1 - (1 - acc) * (1 - v);
      else acc *= v;
    }
    return acc === null ? dflt : acc;
  };
  /* the ids the room has to be told about, because they change the numbers
     both sides compute independently */
  const SYNCED = list.filter(p => p.synced).map(p => p.id);

  /* Three ids, cleaned up: one per section, in section order, anything
     unrecognised or in the wrong slot dropped. Everything that has to turn a
     stored choice into a loadout goes through this, so a profile saved by an
     older build -- or hand-edited, or arriving off the network -- cannot put
     three body perks on one player. */
  /* Which passive a class brings with it. Keyed on the class name exactly as
     js/classes.js spells it; a class with no entry simply brings nothing,
     which is what makes this safe to extend from either side. */
  const CLASS_PERK = {
    Rifleman: 'cpRifleman', Scout: 'cpScout', Gunner: 'cpGunner',
    Assault: 'cpAssault', Breacher: 'cpBreacher', Marksman: 'cpMarksman',
    Sniper: 'cpSniper', Engineer: 'cpEngineer', Medic: 'cpMedic',
    Demolitionist: 'cpDemolitionist',
  };
  const forClass = (name) => CLASS_PERK[name] || null;

  /* The three you chose plus the one your class brings. This is what a body
     actually carries, and the only thing that should ever be handed to an
     agent -- keeping the granted perk out of the stored trio means it can
     never be saved into a profile, and changing your gun changes it for free. */
  function loadout(picked, className) {
    const out = normalise(picked);
    const cp = forClass(className);
    return cp ? out.concat(cp) : out;
  }

  function normalise(picked) {
    const want = Array.isArray(picked) ? picked : (picked ? [picked] : []);
    return SLOTS.map((slot) => {
      for (const id of want) {
        const d = PERKS[id];
        if (d && d.section === slot) return id;
      }
      return 'none';
    });
  }

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
    // takes one id or three; `mod` does the folding either way
    const holder = Array.isArray(perk) ? { perks: perk } : { perk };
    const m = {
      magsPlus: mod(holder, 'magsPlus', 0),
      shellsPlus: mod(holder, 'shellsPlus', 0),
      handlingMult: mod(holder, 'handlingMult', 1),
      recoilMult: mod(holder, 'recoilMult', 1),
    };
    if (!m.magsPlus && !m.shellsPlus && m.handlingMult === 1 && m.recoilMult === 1) return weapon;
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
      // Steady Aim: less bloom added per shot, and a lower ceiling with it
      recoilKick: weapon.recoilKick * (m.recoilMult || 1),
      bloomMax: weapon.bloomMax * (m.recoilMult || 1),
    };
  }

  /* Max HP, which Beefy raises. Combat owns the base figure per target class;
     this is the one place a perk is allowed to move it. */
  const maxHpFor = (base, perk) =>
    base + mod(Array.isArray(perk) ? { perks: perk } : { perk }, 'hpPlus', 0);

  return {
    PERKS, list, byId, has, mod, SYNCED, applyToWeapon, maxHpFor,
    SECTIONS, SLOTS, inSection, normalise, listOf,
    CLASS_PERK, forClass, loadout,
    DEFAULT: 'none',
    /* Three empties, for anything that needs a starting loadout. */
    EMPTY: SLOTS.map(() => 'none'),
  };
})();

/* the shared sim requires this on the server, where there are no globals */
if (typeof module === 'object' && module.exports) module.exports = Perks;
