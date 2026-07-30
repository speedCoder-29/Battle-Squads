/* ============================================================
   weapons.js — Battle Squads weapon roster & ballistics.
   Raw stats are transcribed from the design table, then a builder
   derives the numbers the game engine actually uses.

   NOTE on interpreted stats (top-down engine mapping):
     • Accuracy  → base hipfire spread (higher = wider cone).
                   Aim-Down-Sights (right mouse) tightens it, so
                   snipers/LMGs must ADS to be precise.
     • Recoil    → per-shot "bloom" that widens the cone while firing.
     • Weight    → movement speed (heavier = slower).
     • Falloff   → % damage lost per range step past a start range.
     • Handling  → ADS-in time (kept for UI/feel).
   ============================================================ */
const Weapons = (() => {

  /* ammo-type → colour used for bullets & UI chips */
  const AMMO_COLORS = {
    Blue: '#3d7bff', Green: '#4be08a', Cyan: '#35e0ff', Yellow: '#ffcf4a',
    Red: '#ff4b5c', Orange: '#ff9d3b', Olive: '#9aa832', Black: '#7a8699',
    Purple: '#c46bff', Brown: '#b07a4a',
  };

  /* per-type feel: icon, bullet speed (px/s), how much ADS tightens spread */
  const TYPE_META = {
    'Assault Rifle': { icon: '🔫', bspeed: 900,  ads: 0.40 },
    'Burst Rifle':   { icon: '🎇', bspeed: 900,  ads: 0.40 },
    'LMG':           { icon: '🔩', bspeed: 860,  ads: 0.45 },
    'SMG':           { icon: '🧨', bspeed: 800,  ads: 0.50 },
    'Shotgun':       { icon: '💥', bspeed: 760,  ads: 0.65 },
    'DMR':           { icon: '🎯', bspeed: 1250, ads: 0.15 },
    'Sniper Rifle':  { icon: '🔭', bspeed: 1650, ads: 0.10 },
    'Pistol':        { icon: '🔫', bspeed: 760,  ads: 0.50 },
    'Carbine':       { icon: '🯄', bspeed: 850,  ads: 0.40 },
    'Launcher':      { icon: '🚀', bspeed: 560,  ads: 0.70 },
  };

  /* class → icon + accent for loadout grouping */
  const CLASS_META = {
    Rifleman:      { icon: '🎖️', color: '#3d7bff' },
    Scout:         { icon: '🥷', color: '#4be08a' },
    Gunner:        { icon: '🔩', color: '#35e0ff' },
    Assault:       { icon: '⚡', color: '#ffcf4a' },
    Breacher:      { icon: '💥', color: '#ff4b5c' },
    Marksman:      { icon: '🎯', color: '#ff9d3b' },
    Sniper:        { icon: '🔭', color: '#9aa832' },
    Engineer:      { icon: '🔧', color: '#7a8699' },
    Medic:         { icon: '⛑️', color: '#c46bff' },
    Demolitionist: { icon: '💣', color: '#b07a4a' },
  };

  /* rating letter legend (Positive / Neutral / Negative badges) */
  const RATING_LABELS = {
    D: 'Damage', F: 'Fire Rate', Rd: 'Reload', A: 'Accuracy', Rc: 'Recoil',
    H: 'Handling', W: 'Weight', M: 'Magazine', S: 'Mobility',
  };

  /* ---------- RAW ROSTER ----------
     Balance pass over the original design table. Targets, measured against
     100 HP infantry with the average hit-zone multiplier (which works out to
     exactly 1.0x — see combat.js):
       • no primary kills a healthy target in one body shot, except a launcher
         direct hit; snipers get their one-shot via the 200% headshot instead
       • automatics land in a 0.25–0.36s TTK band, ~250–330 DPS
       • within a class the best and worst TTK stay inside ~1.3x, so the three
         guns are sidegrades rather than a ladder
     What changed most: shotgun pellets (9x12 = 108 was a full-health one-shot
     at any range), the QLZ-87 (990 DPS), and the RPG-7/M79 direct hits. */
  const RAW = [
    // name, type, dmg, fr, mag, reload, acc, rec, hand, scope, weight, ammo, action, falloff, other, attach, special, cls, pos, neu, neg
    ['M16','Assault Rifle','30',10.5,'20, 30','2.5s',3.2,0.2,'0.28s',1.2,9,'Blue','Automatic','5%','None','Grenade Launcher, Scope, Suppressor','AP, Tracer, HP','Rifleman','A,Rc,H','M,W,Rd','D,F,S'],
    ['AKM','Assault Rifle','33',9.5,'30, 45','2.8s',3.6,0.3,'0.4s',1,7,'Blue','Automatic','6%','None','Grenade Launcher, Scope, Suppressor','AP, Tracer, HP','Rifleman','F,M,W','D,S,A','Rc,H,Rd'],
    ['SCAR-H','Assault Rifle','38',8,'20','2.2s',4,0.25,'0.34s',0.8,11,'Blue','Automatic','4%','None','Grenade Launcher, Scope, Suppressor','AP, Tracer, HP','Rifleman','D,S,Rd','F,Rc,H','A,W,M'],
    ['FAMAS F1','Burst Rifle','26*3',14.3,'24','2.6s',3,0.35,'0.38s',0.5,6,'Green','Automatic','4%','0.21s Burst Delay','Scope, Suppressor','AP, Tracer, HP','Scout','D,S,W','F,A,Rd','M,Rc,H'],
    ['AN-94','Burst Rifle','35*2',8.3,'30, 45','2.4s',2.6,0.3,'0.3s',1.1,8,'Green','Automatic','3%','0.24s Burst Delay','Scope, Suppressor','AP, Tracer, HP','Scout','A,Rd,H','M,Rc,W','F,D,S'],
    ['K11','Burst Rifle','24*3',16.7,'45','2.8s',3.4,0.25,'0.34s',0.8,10,'Green','Automatic','4%','0.18s Burst Delay','Scope, Suppressor','AP, Tracer, HP','Scout','F,M,Rc','D,S,H','Rd,A,W'],
    ['M249','LMG','22',12,'100','4.5s',4,0.17,'0.6s',0.8,15,'Cyan','Automatic','5%','None','Bipod, Scope','AP, Tracer','Gunner','F,S,A','M,Rd,W','D,Rc,H'],
    ['RPK-74','LMG','28',9,'45','3s',5,0.15,'0.5s',1.2,12,'Cyan','Automatic','5%','None','Bipod, Scope','AP, Tracer','Gunner','D,Rd,W','A,Rc,H','M,S,F'],
    ['PKP','LMG','25',10,'200','6s',6,0.13,'0.4s',1,18,'Cyan','Automatic','5%','None','Bipod, Scope','AP, Tracer','Gunner','M,Rc,H','D,S,F','Rd,A,W'],
    ['Vector','SMG','19',16,'18, 25, 33','3s',5,0.1,'0.15s',2,8,'Yellow','Automatic','9%','None','Suppressor','HP, Tracer','Assault','Rc,S,H','Rd,A,W','F,M,D'],
    ['Uzi','SMG','22',14,'20, 32','2s',6,0.2,'0.2s',4,6,'Yellow','Automatic','15%','None','Suppressor','HP, Tracer','Assault','F,Rd,W','M,H,D','Rc,A,S'],
    ['P90','SMG','24',13,'50','4s',4,0.15,'0.25s',3,10,'Yellow','Automatic','11%','None','Suppressor','HP, Tracer','Assault','M,A,D','Rc,F,S','Rd,H,W'],
    ['M870','Shotgun','11',3.5,'5','0.5s/shell',9,2.1,'0.3s',5,8,'Red','Non-Automatic','20%','9 Pellets','Sawed-Off, Scope','Slug, Birdshot','Breacher','D,H,W','Rd,S,Rc','F,M,A'],
    ['BM4','Shotgun','7',5,'8','0.4s/shell',7,1.75,'0.5s',4,10,'Red','Semi-Automatic','10%','9 Pellets','Sawed-Off, Scope','Slug, Birdshot','Breacher','Rd,A,S','F,M,W','D,H,Rc'],
    ['SPAS-12','Shotgun','8',5.5,'9','0.6s/shell',8,1.4,'0.4s',6,12,'Red','Semi-Automatic','15%','9 Pellets','Sawed-Off, Scope','Slug, Birdshot','Breacher','F,M,Rc','D,A,H','Rd,S,W'],
    ['Mk 14 EBR','DMR','38',3.6,'20','2.8s',3.8,0.9,'0.42s',0.55,12,'Orange','Semi-Automatic','3%','None','Scope, Suppressor','AP, Tracer, HP','Marksman','D,A,M','Rd,H,W','F,Rc,S'],
    ['SVD Dragunov','DMR','42',3.2,'10','2.5s',4,1.05,'0.45s',0.5,10,'Orange','Semi-Automatic','3%','None','Scope, Suppressor','AP, Tracer, HP','Marksman','D,Rd,S','A,H,W','F,M,Rc'],
    ['QBU-88','DMR','36',4,'10','2.3s',3.5,0.75,'0.38s',0.45,9,'Orange','Semi-Automatic','3%','None','Scope, Suppressor','AP, Tracer, HP','Marksman','F,A,Rc','D,Rd,S','M,H,W'],
    ['Barrett M82 / M107','Sniper Rifle','65',1.3,'10','3.6s',6,3.6,'0.75s',0.24,30,'Olive','Semi-Automatic','2%','Anti-Materiel','Bipod, Scope','AP, Tracer','Sniper','D,M,F','A,Rd,H','W,S,Rc'],
    ['SV-98','Sniper Rifle','75',1.5,'10','3.2s',5.2,3.1,'1.55s',0.16,14,'Olive','Non-Automatic','2%','None','Bipod, Scope','AP, Tracer','Sniper','D,A,W','M,Rd,S','F,H,Rc'],
    ['QBU-10','Sniper Rifle','70',1.4,'5','2.9s',4.9,2.7,'1.35s',0.17,13,'Olive','Non-Automatic','2%','None','Bipod, Scope','AP, Tracer','Sniper','A,Rd,W','D,H,Rc','M,F,S'],
    ['DEagle','Pistol','36',3.4,'7','1.4s',4,0.65,'0.15s',1.8,3,'Black','Semi-Automatic','12%','None','Scope, Suppressor, Flare Launcher','AP, HP','Engineer','D,S,Rd','A,W,M','Rc,F,H'],
    ['Makarov PM','Pistol','24',5.5,'8','1.7s',5,0.45,'0.13s',2,2,'Black','Semi-Automatic','12%','None','Scope, Suppressor, Flare Launcher','AP, HP','Engineer','M,F,W','Rd,H,Rc','D,S,A'],
    ['Colt Python','Pistol','32',4.2,'6','2s',3,0.5,'0.14s',2.1,2,'Black','Semi-Automatic','12%','None','Scope, Suppressor, Flare Launcher','AP, HP','Engineer','H,A,Rc','F,D,S','M,Rd,W'],
    ['M4','Carbine','25',12,'30','2.3s',3.7,0.18,'0.24s',1,7,'Purple','Automatic','7%','None','Scope, Suppressor','AP, Tracer, HP','Medic','A,Rc,H','M,Rd,W','D,F,S'],
    ['AKS-74U','Carbine','27',11,'30','2.4s',4.4,0.24,'0.22s',1.35,6,'Purple','Automatic','7%','None','Scope, Suppressor','AP, Tracer, HP','Medic','D,H,W','F,M,Rd','A,Rc,S'],
    ['QBZ-95B','Carbine','26',11.5,'30','2.4s',4,0.2,'0.23s',1.15,7,'Purple','Automatic','7%','None','Scope, Suppressor','AP, Tracer, HP','Medic','F,A,Rc','D,M,H','Rd,W,S'],
    ['M79','Launcher','80','N/A','1','2.2s',2.5,2.8,'0.42s',1,7,'Brown','Non-Automatic','25%','Explosive','Scope','','Demolitionist','D,A,W','Rd,H,M','F,Rc,S'],
    ['Rpg-7','Launcher','110','N/A','1','3.3s',3.5,4.5,'0.65s',1.4,15,'Brown','Non-Automatic','18%','HEAT','Scope','','Demolitionist','D,Rc,M','A,H,S','F,Rd,W'],
    ['QLZ-87','Launcher','40',4,'6','3.8s',4.2,2,'0.7s',1.8,26,'Brown','Automatic','30%','Explosive','Bipod, Scope','','Demolitionist','F,M,Rd','A,H,Rc','D,W,S'],
  ];

  /* ---------- parsing helpers ---------- */
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const num = (s) => { const m = String(s).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; };

  function parseDamage(str) {
    const parts = String(str).split('*');
    return { damage: num(parts[0]), burst: parts[1] ? num(parts[1]) : 1 };
  }
  function parseMag(str) {
    const opts = String(str).split(',').map(x => num(x)).filter(n => n > 0);
    return { mag: opts[0] || 1, magOptions: opts };
  }
  function parseReload(str) {
    const perShell = /shell/i.test(str);
    return { reloadMs: num(str) * 1000, perShell };
  }

  /* ---------- build one engine-ready weapon ---------- */
  function build(row) {
    const [name, type, dmgStr, fr, magStr, reloadStr, acc, rec, handStr, scope, weight,
           ammo, actionStr, falloffStr, other, attach, special, cls, pos, neu, neg] = row;

    const tm = TYPE_META[type] || TYPE_META['Assault Rifle'];
    const { damage, burst } = parseDamage(dmgStr);
    const { mag, magOptions } = parseMag(magStr);
    const { reloadMs, perShell } = parseReload(reloadStr);

    const firerate = (fr === 'N/A') ? 0 : num(fr);
    const isBurst = burst > 1;
    let action = { 'Automatic': 'auto', 'Semi-Automatic': 'semi', 'Non-Automatic': 'nonauto' }[actionStr] || 'semi';
    if (isBurst) action = 'burst';

    const pellets = /pellet/i.test(other) ? num(other) : 1;
    const burstDelay = /burst delay/i.test(other) ? num(other) * 1000 : 0;
    const heat = /heat/i.test(other);
    const explosive = heat || /explosive/i.test(other);
    // what the damage calculator treats this round as (see combat.js TARGETS)
    const dmgType = heat ? 'heat'
      : /explosive/i.test(other) ? 'explosive'
      : /anti-materiel/i.test(other) ? 'ap'      // the Barrett punches vehicles natively
      : 'normal';

    const parseCodes = (s) => (s ? String(s).split(',').map(x => x.trim()).filter(Boolean) : []);

    return {
      id: slug(name), name, type, className: cls,
      icon: tm.icon, ammoType: ammo, ammoColor: AMMO_COLORS[ammo] || '#8ea0c9',
      classIcon: (CLASS_META[cls] || {}).icon || '🎖️',
      classColor: (CLASS_META[cls] || {}).color || '#3d7bff',

      // core combat
      damage, burst, pellets, action,
      fireInterval: firerate > 0 ? 1000 / firerate : 850,  // ms between rounds
      burstDelay,                                           // ms between bursts
      mag, magOptions,
      reloadMs: perShell ? reloadMs * mag : reloadMs, perShell,
      bulletSpeed: tm.bspeed,

      // accuracy model
      spreadBase: acc * 0.011,          // hipfire cone (radians)
      adsMult: tm.ads,                  // spread multiplier while aiming
      recoilKick: rec * 0.016,          // bloom added per shot
      bloomMax: 0.02 + rec * 0.055,     // cap on accumulated bloom
      pelletSpread: pellets > 1 ? 0.16 : 0,

      // range / damage falloff
      falloff: num(falloffStr) / 100,   // fraction lost per range-step
      explosive, splashRadius: explosive ? 100 : 0,
      dmgType, penetration: 0,          // penetration is a % buff from ammo

      // feel
      moveSpeed: Math.max(120, Math.min(255, 258 - weight * 3.4)),
      handling: num(handStr), weight, recoilRaw: rec, accuracyRaw: acc, firerate,
      scope,                            // ADS zoom factor (lower = more magnification)

      // meta for UI
      attachments: parseCodes(attach), specialAmmo: parseCodes(special),
      ratings: { pos: parseCodes(pos), neu: parseCodes(neu), neg: parseCodes(neg) },
    };
  }

  const list = RAW.map(build);
  const byId = {};
  list.forEach(w => byId[w.id] = w);

  /* ---------- apply stat deltas (legendary / gold variants) ---------- */
  // Deltas operate on the raw stats, then derived fields are recomputed so
  // spread/mobility/reload stay consistent.
  function withMods(base, m = {}) {
    const acc    = Math.max(0.5, base.accuracyRaw + (m.dAcc || 0));
    const rec    = Math.max(0.03, base.recoilRaw + (m.dRec || 0));
    const weight = Math.max(1, base.weight + (m.dWeight || 0));
    const fr     = base.firerate > 0 ? Math.max(0.5, base.firerate + (m.dFirerate || 0)) : 0;
    const mag    = Math.max(1, base.mag + (m.dMag || 0));
    const falloff = Math.max(0, base.falloff + (m.dFalloffPct || 0) / 100);
    const action = m.actionOverride || base.action;

    return {
      ...base,
      id: base.id + '-gold', name: 'Gold ' + base.name, legendary: true,
      ammoColor: '#ffcf4a',
      damage: base.damage + (m.dDamage || 0),
      firerate: fr, action,
      fireInterval: fr > 0 ? 1000 / fr : base.fireInterval,
      mag, magOptions: [mag],
      reloadMs: Math.max(400, base.reloadMs + (m.dReloadS || 0) * 1000),
      burstDelay: Math.max(0, base.burstDelay + (m.dBurstDelayS || 0) * 1000),
      accuracyRaw: acc, recoilRaw: rec, weight, falloff,
      spreadBase: acc * 0.011,
      recoilKick: rec * 0.016,
      bloomMax: 0.02 + rec * 0.055,
      moveSpeed: Math.max(120, Math.min(255, 258 - weight * 3.4)),
    };
  }

  /* ---------- ATTACHMENTS ----------
     Every one is a real trade: the buff column costs you the debuff column.
     `mods` are applied by configure() below; the flags are read by game.js. */
  const ATTACHMENTS = {
    'Grenade Launcher': {
      name: 'Grenade Launcher', icon: '💣',
      buffs: ['Throw grenades while holding your primary'], debuffs: ['-10% Speed', '+25% Handling'],
      mods: { speedMult: 0.90, handlingMult: 1.25 }, launchGrenades: true,
    },
    'Scope': {
      name: 'Scope', icon: '🔭',
      buffs: ['-50% Scope (2x magnification)'], debuffs: ['+50% Handling'],
      mods: { scopeMult: 0.50, handlingMult: 1.50 },
    },
    'Suppressor': {
      name: 'Suppressor', icon: '🤫',
      buffs: ['-75% Firing Audio'], debuffs: ['-5% Damage'],
      mods: { damageMult: 0.95, audioMult: 0.25 },
    },
    'Bipod': {
      name: 'Bipod', icon: '🦿',
      buffs: ['-50% Scoping Recoil'], debuffs: ['-100% Scoping Movement Speed'],
      mods: { scopeRecoilMult: 0.50, scopeMoveMult: 0 },
    },
    'Sawed-Off': {
      name: 'Sawed-Off', icon: '🪚',
      buffs: ['-50% Weight', '-50% Reload'], debuffs: ['+50% Accuracy (wider cone)', '+50% Scope'],
      mods: { weightMult: 0.50, reloadMult: 0.50, accuracyMult: 1.50, scopeMult: 1.50 },
    },
    'Flare Launcher': {
      name: 'Flare Launcher', icon: '🎆',
      buffs: ['Single-use airstrike'], debuffs: ['-5% Speed', '+50% Handling'],
      mods: { speedMult: 0.95, handlingMult: 1.50 }, airstrike: true,
    },
  };

  /* ---------- SPECIALIZED AMMO ----------
     Penetration is a wall-punching stat: it cuts how much damage a round
     loses passing through cover. It deliberately does nothing against armour. */
  const AMMO_TYPES = {
    'AP': {
      name: 'AP', icon: '🔩',
      buffs: ['+50% Penetration'], debuffs: ['+50% Recoil'],
      mods: { penetration: +0.50, recoilMult: 1.50 }, dmgType: 'ap',
    },
    'Tracer': {
      name: 'Tracer', icon: '✨',
      buffs: ['Glowing rounds'], debuffs: ['Glowing rounds — they see you too'],
      mods: {}, tracer: true,
    },
    'HP': {
      name: 'HP', icon: '🩸',
      buffs: ['+25% Damage'], debuffs: ['-50% Penetration'],
      mods: { damageMult: 1.25, penetration: -0.50 },
    },
    'Slug': {
      name: 'Slug', icon: '🎯',
      buffs: ['+900% Damage', '+50% Penetration', '-50% Falloff'],
      debuffs: ['+50% Recoil', '+50% Weight', '-8 Pellets'],
      mods: { damageMult: 10, penetration: +0.50, falloffMult: 0.50, recoilMult: 1.50, weightMult: 1.50, pelletsDelta: -8 },
    },
    'Birdshot': {
      name: 'Birdshot', icon: '🐦',
      buffs: ['+100% Pellets', '-50% Recoil'], debuffs: ['+50% Falloff', '-50% Penetration'],
      mods: { pelletsMult: 2, recoilMult: 0.50, falloffMult: 1.50, penetration: -0.50 },
    },
  };

  /* ---------- apply attachments + ammo to a weapon ----------
     Returns a new weapon object; the base roster is never mutated. */
  function configure(base, opts = {}) {
    const picked = (opts.attachments || []).map(k => ATTACHMENTS[k]).filter(Boolean);
    const ammo = AMMO_TYPES[opts.ammo] || null;
    if (!picked.length && !ammo) return base;

    const all = picked.concat(ammo ? [ammo] : []);
    const mul = (key) => all.reduce((v, m) => v * (m.mods[key] !== undefined ? m.mods[key] : 1), 1);
    const add = (key) => all.reduce((v, m) => v + (m.mods[key] || 0), 0);

    const pellets = Math.max(1, Math.round(base.pellets * mul('pelletsMult') + add('pelletsDelta')));
    const acc = Math.max(0.5, base.accuracyRaw * mul('accuracyMult'));
    const rec = Math.max(0.03, base.recoilRaw * mul('recoilMult'));
    const weight = Math.max(1, base.weight * mul('weightMult'));

    const w = {
      ...base,
      damage: base.damage * mul('damageMult'),
      pellets,
      pelletSpread: pellets > 1 ? 0.16 : 0,
      falloff: base.falloff * mul('falloffMult'),
      penetration: base.penetration + add('penetration'),
      reloadMs: Math.max(300, base.reloadMs * mul('reloadMult')),
      accuracyRaw: acc, recoilRaw: rec, weight,
      spreadBase: acc * 0.011,
      recoilKick: rec * 0.016,
      bloomMax: 0.02 + rec * 0.055,
      moveSpeed: Math.max(120, Math.min(255, 258 - weight * 3.4)) * mul('speedMult'),
      handling: base.handling * mul('handlingMult'),
      scope: base.scope * mul('scopeMult'),
      audio: mul('audioMult'),
      scopeRecoilMult: mul('scopeRecoilMult'),
      scopeMoveMult: mul('scopeMoveMult'),
      dmgType: ammo && ammo.dmgType ? ammo.dmgType : base.dmgType,
      tracer: all.some(m => m.tracer),
      launchGrenades: all.some(m => m.launchGrenades),
      airstrike: all.some(m => m.airstrike),
      attachedNames: picked.map(p => p.name),
      ammoName: ammo ? ammo.name : null,
    };
    return w;
  }

  /* weapons the bots are allowed to spawn with (a spread across classes) */
  const BOT_POOL = ['m16', 'akm', 'scar-h', 'famas-f1', 'an-94', 'm249', 'rpk-74',
    'vector', 'uzi', 'p90', 'm870', 'spas-12', 'm4', 'aks-74u', 'mk-14-ebr'];

  return {
    list, byId, BOT_POOL, AMMO_COLORS, CLASS_META, RATING_LABELS, TYPE_META, withMods,
    ATTACHMENTS, AMMO_TYPES, configure,
    allIds: () => list.map(w => w.id),
    default: 'm16',
    randomBot: () => BOT_POOL[Math.floor(Math.random() * BOT_POOL.length)],
    // weapons grouped by class, in table order
    byClass() {
      const groups = {};
      list.forEach(w => { (groups[w.className] = groups[w.className] || []).push(w); });
      return groups;
    },
  };
})();
