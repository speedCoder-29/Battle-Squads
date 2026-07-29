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

  /* ---------- RAW ROSTER (straight from the design table) ---------- */
  const RAW = [
    // name, type, dmg, fr, mag, reload, acc, rec, hand, scope, weight, ammo, action, falloff, other, attach, special, cls, pos, neu, neg
    ['M16','Assault Rifle','28',10,'20, 30','2.5s',3.2,0.2,'0.28s',1.2,9,'Blue','Automatic','5%','None','Grenade Launcher, Scope, Suppressor','AP, Tracer, HP','Rifleman','A,Rc,H','M,W,Rd','D,F,S'],
    ['AKM','Assault Rifle','33',12,'30, 45','2.8s',3.6,0.3,'0.4s',1,7,'Blue','Automatic','6%','None','Grenade Launcher, Scope, Suppressor','AP, Tracer, HP','Rifleman','F,M,W','D,S,A','Rc,H,Rd'],
    ['SCAR-H','Assault Rifle','38',11,'20','2.2s',4,0.25,'0.34s',0.8,11,'Blue','Automatic','4%','None','Grenade Launcher, Scope, Suppressor','AP, Tracer, HP','Rifleman','D,S,Rd','F,Rc,H','A,W,M'],
    ['FAMAS F1','Burst Rifle','30*3',14.3,'24','2.6s',3,0.35,'0.38s',0.5,6,'Green','Automatic','4%','0.21s Burst Delay','Scope, Suppresor','AP, Tracer, HP','Scout','D,S,W','F,A,Rd','M,Rc,H'],
    ['AN-94','Burst Rifle','35*2',8.3,'30, 45','2.4s',2.6,0.3,'0.3s',1.1,8,'Green','Automatic','3%','0.24s Burst Delay','Scope, Suppresor','AP, Tracer, HP','Scout','A,Rd,H','M,Rc,W','F,D,S'],
    ['K11','Burst Rifle','27*3',16.7,'45','2.8s',3.4,0.25,'0.34s',0.8,10,'Green','Automatic','4%','0.18s Burst Delay','Scope, Suppresor','AP, Tracer, HP','Scout','F,M,Rc','D,S,H','Rd,A,W'],
    ['M249','LMG','24',13,'100','4.5s',4,0.17,'0.6s',0.8,15,'Cyan','Automatic','5%','None','Bipod, Scope','AP, Tracer','Gunner','F,S,A','M,Rd,W','D,Rc,H'],
    ['RPK-74','LMG','30',9,'45','3s',5,0.15,'0.5s',1.2,12,'Cyan','Automatic','5%','None','Bipod, Scope','AP, Tracer','Gunner','D,Rd,W','A,Rc,H','M,S,F'],
    ['PKP','LMG','27',11,'200','6s',6,0.13,'0.4s',1,18,'Cyan','Automatic','5%','None','Bipod, Scope','AP, Tracer','Gunner','M,Rc,H','D,S,F','Rd,A,W'],
    ['Vector','SMG','20',11,'18, 25, 33','3s',5,0.1,'0.15s',2,8,'Yellow','Automatic','8%','None','Suppressor','HP, Tracer','Assault','Rc,S,H','Rd,A,W','F,M,D'],
    ['Uzi','SMG','23',15,'20, 32','2s',6,0.2,'0.2s',4,6,'Yellow','Automatic','15%','None','Suppressor','HP, Tracer','Assault','F,Rd,W','M,H,D','Rc,A,S'],
    ['P90','SMG','26',13,'50','4s',4,0.15,'0.25s',3,10,'Yellow','Automatic','10%','None','Suppressor','HP, Tracer','Assault','M,A,D','Rc,F,S','Rd,H,W'],
    ['M870','Shotgun','12',3,'5','0.5s/shell',9,2.1,'0.3s',5,8,'Red','Non-Automatic','20%','9 Pellets','Sawed-Off, Scope','Slug, Birdshot','Breacher','D,H,W','Rd,S,Rc','F,M,A'],
    ['BM4','Shotgun','8',5,'8','0.4s/shell',7,1.75,'0.5s',4,10,'Red','Semi-Automatic','10%','9 Pellets','Sawed-Off, Scope','Slug, Birdshot','Breacher','Rd,A,S','F,M,W','D,H,Rc'],
    ['SPAS-12','Shotgun','10',6,'9','0.6s/shell',8,1.4,'0.4s',6,12,'Red','Semi-Automatic','15%','9 Pellets','Sawed-Off, Scope','Slug, Birdshot','Breacher','F,M,Rc','D,A,H','Rd,S,W'],
    ['Mk 14 EBR','DMR','45',3.2,'20','2.8s',3.8,0.9,'0.42s',0.55,12,'Orange','Semi-Automatic','3%','None','','','Marksman','','',''],
    ['SVD Dragunov','DMR','50',2.6,'10','2.5s',4,1.05,'0.45s',0.5,10,'Orange','Semi-Automatic','3%','None','','','Marksman','','',''],
    ['QBU-88','DMR','42',3.5,'10','2.3s',3.5,0.75,'0.38s',0.45,9,'Orange','Semi-Automatic','3%','None','','','Marksman','','',''],
    ['Barrett M82 / M107','Sniper Rifle','70',1.3,'10','3.6s',6,3.6,'0.75s',0.24,30,'Olive','Semi-Automatic','2%','Anti-Materiel','','','Sniper','','',''],
    ['SV-98','Sniper Rifle','82',1.5,'10','3.2s',5.2,3.1,'1.55s',0.16,14,'Olive','Non-Automatic','2%','None','','','Sniper','','',''],
    ['QBU-10','Sniper Rifle','76',1.25,'5','2.9s',4.9,2.7,'1.35s',0.17,13,'Olive','Non-Automatic','2%','None','','','Sniper','','',''],
    ['DEagle','Pistol','35',3,'7','1.4s',4,0.65,'0.15s',1.8,3,'Black','Semi-Automatic','12%','None','Scope, Suppressor, Flare Launcher','None','Engineer','D,S,Rd','A,W,M','Rc,F,H'],
    ['Makarov PM','Pistol','25',5,'8','1.7s',5,0.45,'0.13s',2,2,'Black','Semi-Automatic','12%','None','Scope, Suppressor, Flare Launcher','None','Engineer','M,F,W','Rd,H,Rc','D,S,A'],
    ['Colt Python','Pistol','30',4,'6','2s',3,0.5,'0.14s',2.1,2,'Black','Semi-Automatic','12%','None','Scope, Suppressor, Flare Launcher','None','Engineer','H,A,Rc','F,D,S','M,Rd,W'],
    ['M4','Carbine','27',12,'30','2.3s',3.7,0.18,'0.24s',1,7,'Purple','Automatic','7%','None','','','Medic','','',''],
    ['AKS-74U','Carbine','29',11,'30','2.4s',4.4,0.24,'0.22s',1.35,6,'Purple','Automatic','7%','None','','','Medic','','',''],
    ['QBZ-95B','Carbine','28',11.5,'30','2.4s',4,0.2,'0.23s',1.15,7,'Purple','Automatic','7%','None','','','Medic','','',''],
    ['M79','Launcher','95','N/A','1','2.2s',2.5,2.8,'0.42s',1,7,'Brown','Non-Automatic','25%','Explosive','','','Demolitionist','','',''],
    ['Rpg-7','Launcher','130','N/A','1','3.3s',3.5,4.5,'0.65s',1.4,15,'Brown','Non-Automatic','18%','Explosive','','','Demolitionist','','',''],
    ['QLZ-87','Launcher','55',18,'6','3.8s',4.2,2,'0.7s',1.8,26,'Brown','Automatic','30%','Explosive','','','Demolitionist','','',''],
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
    const explosive = /explosive/i.test(other);

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

      // feel
      moveSpeed: Math.max(120, Math.min(255, 258 - weight * 3.4)),
      handling: num(handStr), weight, recoilRaw: rec, accuracyRaw: acc, firerate,

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

  /* weapons the bots are allowed to spawn with (a spread across classes) */
  const BOT_POOL = ['m16', 'akm', 'scar-h', 'famas-f1', 'an-94', 'm249', 'rpk-74',
    'vector', 'uzi', 'p90', 'm870', 'spas-12', 'm4', 'aks-74u', 'mk-14-ebr'];

  return {
    list, byId, BOT_POOL, AMMO_COLORS, CLASS_META, RATING_LABELS, TYPE_META, withMods,
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
