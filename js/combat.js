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
  const vest   = (t) => VESTS[clampTier(t)];
  const helmet = (t) => HELMETS[clampTier(t)];
  const clampTier = (t) => Math.max(0, Math.min(3, t | 0));
  /* combined movement penalty from what you're wearing */
  const armorSpeed = (a) => 1 + vest(a.vest || 0).speed + helmet(a.helmet || 0).speed;

  /* ---------- adrenaline ----------
     Scales with how much you have: half of your adrenaline % becomes
     movement / reload / handling speed. Damage reduction steps at
     25 / 50 / 75 / 100. */
  const ADREN_DR = [
    { at: 100, dr: 0.50 }, { at: 75, dr: 0.35 }, { at: 50, dr: 0.20 }, { at: 25, dr: 0.05 },
  ];
  function adrenaline(amount) {
    const a = Math.max(0, Math.min(100, amount || 0));
    const boost = 1 + (a / 100) / 2;                 // Adren%/2 speedup
    const step = ADREN_DR.find(s => a >= s.at);
    return { amount: a, speed: boost, reload: boost, handling: boost, dr: step ? step.dr : 0 };
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
  };
  /* src: { kind: 'melee'|'bullet'|'explosive'|'heat', pierce?, clears? } */
  function canDamageStructure(wall, src) {
    const tough = wall.toughness || 1;
    switch (src.kind) {
      case 'heat':      return true;                       // HEAT chews anything
      case 'explosive': return tough <= 3;
      case 'melee':     return (!!src.clears && src.clears === wall.type) || (src.pierce || 0) >= tough;
      default:          return tough <= (src.ap ? 2 : 1);  // AP rounds bite a little harder
    }
  }

  return {
    DAMAGE_TYPES, TARGETS, HIT_ZONES, VESTS, HELMETS, TOUGHNESS_MEANING,
    targetOf, rollZone, zoneMult, vest, helmet, armorSpeed, adrenaline,
    resolve, canDamageStructure, maxHpFor: (klass) => targetOf({ klass }).hp,
  };
})();
