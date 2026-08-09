/* ============================================================
   perks.js — one passive trait you bring into the match.

   The loot table already assumed these existed: a Swimming Pool
   holds a silver crate "must have Diver perk", and without a perk
   system that crate was either free or unreachable depending on
   which way you squinted. This is that system.

   Design rules, so a perk is a decision rather than a stat stick:
     • You get exactly one. Picking Diver means not picking
       Juggernaut, and the map is built so both have somewhere to
       pay off.
     • Every perk hooks something that already exists — armour
       weight, adrenaline burn, swim speed, structure toughness —
       rather than adding a parallel system nobody can see.
     • Anything that changes movement or reload has to be known by
       the authoritative room as well as the client, or the two
       disagree about where you are. Those are marked `synced`, and
       js/party.js sends the id with the join.
   ============================================================ */
const Perks = (() => {

  const PERKS = {
    none: {
      id: 'none', name: 'No Perk', icon: '—',
      blurb: 'Nothing. A perfectly reasonable choice.',
      effects: [],
    },
    diver: {
      id: 'diver', name: 'Diver', icon: '🤿', synced: true,
      blurb: 'Water doesn’t slow you, and you can reach what sank in it.',
      effects: ['Full speed swimming', 'Opens Swimming Pool crates'],
    },
    juggernaut: {
      id: 'juggernaut', name: 'Juggernaut', icon: '🛡️', synced: true,
      blurb: 'Plate carries like cloth — a T3 vest with none of the weight.',
      effects: ['Armour costs no movement speed'],
    },
    medic: {
      id: 'medic', name: 'Field Medic', icon: '⛑️', synced: true,
      blurb: 'Adrenaline goes further and works harder.',
      effects: ['Adrenaline burns half as fast', '+50% adrenaline healing'],
    },
    scavenger: {
      id: 'scavenger', name: 'Scavenger', icon: '🎒',
      blurb: 'You find the thing at the bottom of the box.',
      effects: ['Every crate yields one extra item'],
    },
    breacher: {
      id: 'breacher', name: 'Breacher', icon: '🔨',
      blurb: 'Walls are a suggestion. Doors are a formality.',
      effects: ['+1 tool Structure Pierce', 'Double damage to structures'],
    },
    ghost: {
      id: 'ghost', name: 'Ghost', icon: '🌫️',
      blurb: 'Cover keeps working while you move, and nobody hears you coming.',
      effects: ['Bushes conceal you while moving', 'Gunfire draws no attention'],
    },
    quickhands: {
      id: 'quickhands', name: 'Quick Hands', icon: '🤲', synced: true,
      blurb: 'The reload you didn’t think you had time for.',
      effects: ['-25% reload time'],
    },
    mule: {
      id: 'mule', name: 'Mule', icon: '📦',
      blurb: 'One more bag than you are wearing.',
      effects: ['+1 bag tier of carry capacity'],
    },
  };

  const list = Object.values(PERKS);
  const byId = (id) => PERKS[id] || PERKS.none;
  /* Does this agent have that perk? Takes the agent rather than the id so
     every call site reads the same way, and so an agent with no perk field
     at all — a bot, a vehicle — simply answers no. */
  const has = (a, id) => !!a && a.perk === id;
  /* the ids the room has to be told about, because they change the numbers
     both sides compute independently */
  const SYNCED = list.filter(p => p.synced).map(p => p.id);

  return { PERKS, list, byId, has, SYNCED, DEFAULT: 'none' };
})();

/* the shared sim requires this on the server, where there are no globals */
if (typeof module === 'object' && module.exports) module.exports = Perks;
