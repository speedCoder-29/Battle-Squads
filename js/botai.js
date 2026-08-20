/* ============================================================
   botai.js — bot difficulty.

   Ten levels, each a blend of three independent traits:

     AIM       how straight they shoot — aim error, how fast they
               track a moving target, reaction time, whether they
               lead their shots, and how willing they are to fire
               at long range.
     SURVIVAL  self-preservation — retreating when hurt, using
               heals, breaking line of sight, reloading in cover,
               respecting their weapon's effective range.
     TEAMWORK  how much they act as a squad — grouping up, focusing
               the target a squadmate is already shooting, calling
               out (sharing) contacts, and spacing out so one
               grenade can't take the whole fire team.

   Level 1 is a distracted rookie; level 10 reacts in ~90ms, leads
   its shots, disengages at low HP and focus-fires with its squad.
   ============================================================ */
const BotAI = (() => {

  /* interpolate a trait from level 1..10 across a curve */
  const lerp = (a, b, t) => a + (b - a) * t;
  const curve = (lvl) => (Math.max(1, Math.min(10, lvl)) - 1) / 9;   // 0..1

  /* ---------- the three trait tracks ---------- */
  function aimTrait(lvl) {
    const t = curve(lvl);
    return {
      // radians of error added to every shot — 0.30 is wild, 0.012 is surgical
      error: lerp(0.30, 0.012, t),
      // how fast they swing onto a target (fraction of the gap closed per second)
      turnRate: lerp(3.0, 22.0, t),
      // seconds before they react to seeing someone
      reaction: lerp(0.85, 0.09, t),
      // how much they compensate for a moving target (0 = none, 1 = perfect lead)
      lead: lerp(0, 1, Math.max(0, (t - 0.3) / 0.7)),
      // they hold fire past this fraction of their weapon's range
      rangeDiscipline: lerp(1.15, 0.85, t),
      // chance per burst to keep the trigger down when they should tap
      triggerControl: lerp(0.1, 0.95, t),
    };
  }

  function survivalTrait(lvl) {
    const t = curve(lvl);
    return {
      // HP fraction at which they try to break off
      retreatAt: lerp(0.0, 0.45, t),
      // will they actually use a heal item
      usesHeals: lvl >= 3,
      healAt: lerp(0.25, 0.6, t),
      // preferred distance as a fraction of their weapon range
      standoff: lerp(0.35, 0.62, t),
      // how hard they strafe (dodging)
      strafe: lerp(0.25, 1.0, t),
      // seconds they'll stay exposed before looking for cover
      exposureTolerance: lerp(6.0, 1.2, t),
      // do they reload when they're out of contact rather than mid-fight
      reloadsInCover: lvl >= 4,
    };
  }

  function teamworkTrait(lvl) {
    const t = curve(lvl);
    return {
      // how strongly they're pulled toward squadmates
      cohesion: lerp(0, 0.55, t),
      // ideal spacing from the nearest squadmate (too close = grenade bait)
      spacing: lerp(40, 130, t),
      // chance they switch to the target a squadmate is already on
      focusFire: lerp(0, 0.85, t),
      // do they share a contact with the squad (bots "hear" each other)
      sharesContacts: lvl >= 5,
      // seconds a shared contact stays useful
      intelMemory: lerp(0, 4.5, t),
      // will they push an objective together rather than solo it
      objectiveDiscipline: lerp(0.2, 1.0, t),
    };
  }

  /* ---------- named presets ---------- */
  const NAMES = [
    'Recruit', 'Rookie', 'Regular', 'Trained', 'Seasoned',
    'Veteran', 'Elite', 'Special Forces', 'Legendary', 'Nightmare',
  ];
  const BLURBS = [
    'Barely aims. Wanders into walls.',
    'Shoots in your general direction.',
    'Basic tracking, no self-preservation.',
    'Reloads in cover and keeps its distance.',
    'Calls out contacts to its squad.',
    'Leads its shots and retreats when hurt.',
    'Focus-fires with the squad. Punishing.',
    'Fast reactions, disciplined range, real teamwork.',
    'Near-perfect aim, breaks line of sight, heals up.',
    'Reacts in 90ms, leads every shot, never fights alone.',
  ];

  /* a complete difficulty profile */
  function profile(level) {
    // `level || 5` would turn a deliberate 0 into 5, so test for a real number
    const n = Number.isFinite(+level) ? +level : 5;
    const lvl = Math.max(1, Math.min(10, Math.round(n)));
    return {
      level: lvl,
      name: NAMES[lvl - 1],
      blurb: BLURBS[lvl - 1],
      aim: aimTrait(lvl),
      survival: survivalTrait(lvl),
      teamwork: teamworkTrait(lvl),
    };
  }

  /* Per-bot jitter so a squad of level-6s isn't nine identical robots.
     Keeps the level's character but varies each individual a little. */
  function individual(level, variance = 0.12) {
    const p = profile(level);
    const j = () => 1 + (Math.random() * 2 - 1) * variance;
    return {
      ...p,
      aim: { ...p.aim, error: p.aim.error * j(), reaction: p.aim.reaction * j(), turnRate: p.aim.turnRate * j() },
      survival: { ...p.survival, standoff: p.survival.standoff * j(), retreatAt: p.survival.retreatAt * j() },
      teamwork: { ...p.teamwork, spacing: p.teamwork.spacing * j() },
    };
  }

  const all = () => Array.from({ length: 10 }, (_, i) => profile(i + 1));

  /* Default difficulty. Was 5 — the middle of the ladder, which reads as
     sparring rather than as opposition. 7 is where they lead their shots
     properly, hold fire outside their weapon's range and break off when hurt,
     without the near-perfect aim of 9 and 10. The setting is still there for
     anyone who wants it easier or harder. */
  return { profile, individual, all, NAMES, BLURBS, DEFAULT: 7 };
})();
