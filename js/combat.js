/* ============================================================
   combat.js — the damage calculator.

   Every point of damage in the game goes through resolve(), so
   the tables below are the single source of truth for how much
   a hit actually takes off.

   Order of operations for one hit:
     raw damage
       × damage-type vs target-class multiplier   (rifle rounds bounce off tanks)
       × hit-zone multiplier                      (limb / body / head)
       × armour                                   (vest on body, helmet on head)
       × (1 - adrenaline damage reduction)
   ============================================================ */
const Combat = (() => {

  /* ---------- damage types ----------
     'true' is not from the design table — it's the engine's channel for
     environmental damage (barbed wire), which shouldn't roll a headshot
     or be stopped by a vest. */
  const DAMAGE_TYPES = ['normal', 'ap', 'explosive', 'heat', 'true'];

  /* ---------- target classes: HP + what each damage type does to them ---------- */
  const TARGETS = {
    infantry: { name: 'Infantry',     hp: 100, mult: { normal: 1.00, ap: 1.00, explosive: 1.00, heat: 1.00, true: 1.00 } },
    jeep:     { name: 'Armored Jeep', hp: 150, mult: { normal: 0.10, ap: 0.20, explosive: 0.50, heat: 1.00, true: 1.00 } },
    tank:     { name: 'Tank',         hp: 250, mult: { normal: 0.00, ap: 0.00, explosive: 0.25, heat: 0.50, true: 1.00 } },
  };
  const targetOf = (a) => TARGETS[(a && a.klass) || 'infantry'] || TARGETS.infantry;

  /* ---------- hit zones ----------
     No vertical aim in a top-down game, so the zone is rolled per hit
     using the size weights from the design table. */
  const HIT_ZONES = [
    { zone: 'limb', mult: 0.5, size: 2 / 5 },
    { zone: 'body', mult: 1.0, size: 2 / 5 },
    { zone: 'head', mult: 2.0, size: 1 / 5 },
  ];
  function rollZone() {
    let r = Math.random();
    for (const z of HIT_ZONES) { if ((r -= z.size) <= 0) return z.zone; }
    return 'body';
  }
  const zoneMult = (zone) => (HIT_ZONES.find(z => z.zone === zone) || HIT_ZONES[1]).mult;

  /* ---------- armour ----------
     Vests scale body damage, helmets replace the 200% headshot multiplier.
     Both cost movement speed. Tier 0 = nothing equipped.
     Penetration buffs deliberately do NOT help against armour. */
  const VESTS = [
    { tier: 0, name: 'No Vest',  body: 1.00, speed: 0 },
    { tier: 1, name: 'Vest T1',  body: 0.70, speed: -0.15 },
    { tier: 2, name: 'Vest T2',  body: 0.40, speed: -0.30 },
    { tier: 3, name: 'Vest T3',  body: 0.10, speed: -0.45 },
  ];
  const HELMETS = [
    { tier: 0, name: 'No Helmet', head: 2.00, speed: 0 },
    { tier: 1, name: 'Helmet T1', head: 1.50, speed: -0.07 },
    { tier: 2, name: 'Helmet T2', head: 1.00, speed: -0.14 },
    { tier: 3, name: 'Helmet T3', head: 0.50, speed: -0.21 },
  ];
  /* ---------- bags ----------
     The third armour slot, and the only one that isn't about surviving being
     shot: it multiplies how much of your kit you deploy with and how much you
     can pick up. Nothing to do with damage, so it never reaches resolve(). */
  const BAGS = [
    { tier: 0, name: 'No Bag', capacity: 1 },
    { tier: 1, name: 'Bag T1', capacity: 2 },
    { tier: 2, name: 'Bag T2', capacity: 3 },
    { tier: 3, name: 'Bag T3', capacity: 4 },
  ];
  const vest   = (t) => VESTS[clampTier(t)];
  const helmet = (t) => HELMETS[clampTier(t)];
  const bag    = (t) => BAGS[clampTier(t)];
  const clampTier = (t) => Math.max(0, Math.min(3, t | 0));
  /* combined movement penalty from what you're wearing. A bag is weightless
     as far as the table is concerned — only the vest and helmet slow you. */
  const armorSpeed = (a) => 1 + vest(a.vest || 0).speed + helmet(a.helmet || 0).speed;

  /* ---------- adrenaline ----------
     A ladder, not a single curve. Each band unlocks one more thing and keeps
     everything below it, so the same number does more the higher it climbs:

       25%   Adren%/2 movement speed          5% damage reduction
       50%   ...and Adren%/2 reload speed    15%
       75%   ...and Adren%/2 handling speed  30%
       100%  ...and a last stand: (Adren%-100)/5 seconds of life at 0 HP
       100%+ ...and it drains twice as fast

     The speed-ups themselves are always Adren%/2 — what the bands decide is
     *which* of them you are getting at all. Below 25 adrenaline does nothing
     but sit there.

     The table has no ceiling, but the last-stand formula needs one or a
     stockpile becomes minutes of invulnerability. 150 is the cap, which is
     ten seconds — long enough to be the comeback the band is clearly for. */
  const ADREN_MAX = 150;
  const ADREN_BANDS = [
    { at: 100, dr: 0.50, speed: true, reload: true, handling: true, lastStand: true },
    { at: 75,  dr: 0.30, speed: true, reload: true, handling: true },
    { at: 50,  dr: 0.15, speed: true, reload: true },
    { at: 25,  dr: 0.05, speed: true },
  ];
  const LAST_STAND_PER = 5;       // adrenaline above 100 per extra second of life
  // adrenaline also burns itself off healing you: HP per second, scaled by how
  // much you're running on. It is the fast, risky heal — it drains as it works.
  const ADREN_REGEN_MAX = 6;      // HP/sec at 100 adrenaline
  const ADREN_BURN = 5;           // adrenaline/sec spent while regenerating

  function adrenaline(amount) {
    const a = Math.max(0, Math.min(ADREN_MAX, amount || 0));
    const boost = 1 + (a / 100) / 2;                 // Adren%/2 speedup
    const band = ADREN_BANDS.find(s => a >= s.at) || {};
    return {
      amount: a,
      speed:    band.speed ? boost : 1,
      reload:   band.reload ? boost : 1,
      handling: band.handling ? boost : 1,
      dr: band.dr || 0,
      // seconds you keep fighting after being taken to 0 HP
      lastStand: band.lastStand ? Math.max(0, (a - 100) / LAST_STAND_PER) : 0,
      regen: (a / 100) * ADREN_REGEN_MAX,            // HP/sec it heals you for
      // over 100 it goes twice as quickly — the top band is rented, not owned
      burn: ADREN_BURN * (a > 100 ? 2 : 1),
    };
  }

  /* ---------- the calculator ---------- */
  /* src: { damage, type, zone? }  target: an agent  → { damage, zone, killed } */
  function resolve(src, target) {
    const type = DAMAGE_TYPES.includes(src.type) ? src.type : 'normal';
    const t = targetOf(target);
    let dmg = src.damage * (t.mult[type] !== undefined ? t.mult[type] : 1);

    // vehicles have no anatomy — no zones, no armour. Nor does 'true' damage.
    const isInfantry = !target || !target.klass || target.klass === 'infantry';
    let zone = null;
    if (isInfantry && dmg > 0 && type !== 'true') {
      zone = src.zone || rollZone();
      if (zone === 'head')      dmg *= helmet(target.helmet).head;
      else if (zone === 'body') dmg *= vest(target.vest).body * zoneMult('body');
      else                      dmg *= zoneMult('limb');
    }
    dmg *= (1 - adrenaline(target && target.adrenaline).dr);
    return { damage: Math.max(0, dmg), zone, type };
  }

  /* ---------- structures ----------
     Reconciles the wall table's Toughness numbers with the toughness
     ladder: 1 = anything, 2 = some melees, 3 = Stone Hammer,
     4+ = HEAT (or the tool with a dedicated clearing effect). */
  const TOUGHNESS_MEANING = {
    1: 'Destructible by anything',
    2: 'Destructible by some melees',
    3: 'Destructible by the Stone Hammer',
    4: 'Destructible by HEAT weapons',
    5: 'Destructible by C4 and specialized tools',
    6: 'Indestructible',
  };
  const MAX_TOUGHNESS = 6;
  /* src: { kind: 'melee'|'bullet'|'explosive'|'heat'|'c4', pierce?, clears?, ap? }

     Each rung of the ladder can do everything the rungs below it can. HEAT
     used to answer "yes" to everything, which made the top two rungs
     meaningless — a HEAT round levelled a bank vault as easily as a fence. */
  function canDamageStructure(wall, src) {
    const tough = wall.toughness || 1;
    if (tough >= MAX_TOUGHNESS) return false;              // nothing touches it
    // a tool built to clear this exact thing always works, whatever it is
    if (src.clears && src.clears === wall.type) return true;
    switch (src.kind) {
      case 'c4':        return tough <= 5;                 // the demolition charge
      case 'heat':      return tough <= 4;
      case 'explosive': return tough <= 3;
      case 'melee':     return (src.pierce || 0) >= tough;
      default:          return tough <= (src.ap ? 2 : 1);  // AP rounds bite a little harder
    }
  }

  return {
    DAMAGE_TYPES, TARGETS, HIT_ZONES, VESTS, HELMETS, BAGS, TOUGHNESS_MEANING,
    MAX_TOUGHNESS, ADREN_MAX,
    targetOf, rollZone, zoneMult, vest, helmet, bag, armorSpeed, adrenaline,
    resolve, canDamageStructure, maxHpFor: (klass) => targetOf({ klass }).hp,
  };
})();
