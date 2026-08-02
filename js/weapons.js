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

  /* ---------- WORLD SCALE ----------
     One tile is TILE px — the same unit game.js lays the map out on and the
     one items.js measures blast radii in. Both distance columns in the roster
     are expressed in it: `range` in tiles, `bspeed` in tiles per second, so a
     gun's flight time is just range/bspeed and every distance in the project
     shares a unit.

     This used to be `rangeUnits * 2.6`, a factor left over from a much smaller
     board, which put an M870's reach at 70px — barely three player radii, and
     shorter than the barrel drawn on screen. Ranges below are re-authored in
     tiles against the 128-tile map, and muzzle velocities scaled to match so
     rounds still cross their own range in roughly half a second. */
  const TILE = 50;                 // px per world tile — must match game.js
  const PELLET_SPREAD = 0.10;      // shotgun fan, radians either side of aim
  const SPLASH_RADIUS = TILE * 2.8;   // launcher blast — sits above a frag's

  /* ammo-type → colour used for bullets & UI chips */
  const AMMO_COLORS = {
    Blue: '#3d7bff', Green: '#4be08a', Cyan: '#35e0ff', Yellow: '#ffcf4a',
    Red: '#ff4b5c', Orange: '#ff9d3b', Olive: '#9aa832', Black: '#7a8699',
    Purple: '#c46bff', Brown: '#b07a4a',
  };

  /* ---------- SCOPES ---------- */
  /* Mounted optics with zoom levels and accuracy benefits */
  const SCOPES = {
    'Red Dot': {
      name: 'Red Dot Sight', icon: '🔴', zoom: 1.5, accMult: 0.70,
      adsTime: 0.25, weight: 1, description: '1.5× magnification, fast target acquisition',
    },
    '4x Scope': {
      name: '4× Tactical Scope', icon: '🎯', zoom: 4.0, accMult: 0.50,
      adsTime: 0.45, weight: 1.5, description: '4× magnification, medium range specialist',
    },
    '8x Scope': {
      name: '8× Sniper Scope', icon: '🔭', zoom: 8.0, accMult: 0.40,
      adsTime: 0.60, weight: 2, description: '8× magnification, long-range dominance',
    },
    'Thermal': {
      name: 'Thermal Scope', icon: '🌡️', zoom: 2.5, accMult: 0.60,
      adsTime: 0.50, weight: 2.5, description: '2.5× magnification, see through smoke',
    },
  };

  /* per-type feel: icon, fallback muzzle velocity (tiles/s), how much ADS
     tightens spread. Every gun overrides bspeed; these are the safety net. */
  const TYPE_META = {
    'Assault Rifle': { icon: '🔫', bspeed: 54, ads: 0.40 },
    'Burst Rifle':   { icon: '🎇', bspeed: 55, ads: 0.40 },
    'LMG':           { icon: '🔩', bspeed: 58, ads: 0.45 },
    'SMG':           { icon: '🧨', bspeed: 46, ads: 0.50 },
    'Shotgun':       { icon: '💥', bspeed: 42, ads: 0.65 },
    'DMR':           { icon: '🎯', bspeed: 68, ads: 0.15 },
    'Sniper Rifle':  { icon: '🔭', bspeed: 94, ads: 0.10 },
    'Pistol':        { icon: '🔫', bspeed: 54, ads: 0.50 },
    'Carbine':       { icon: '🯄', bspeed: 54, ads: 0.40 },
    'Launcher':      { icon: '🚀', bspeed: 26, ads: 0.70 },
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
     Damage, fire rate, falloff, range and muzzle velocity are referenced from
     survev (the open-source surviv.io server), mapped onto this engine:
       • survev damage is per 100 HP, same as ours, so it transfers directly
       • survev `fireDelay` seconds -> rounds/sec  (ak47 0.1s -> 10 rps)
       • survev `falloff` is the multiplier left at max range, so a low number
         means a steep drop: our loss% ≈ (1 - falloff) * 50
       • survev `distance`/`speed` set the *shape* of the range and velocity
         columns; the absolute numbers are re-authored in tiles (see WORLD
         SCALE) so they land sensibly on our 128-tile board

     The headline effect is a much longer, more skill-based TTK: automatics sit
     around 0.45–0.70s instead of 0.25–0.35s, because survev trades per-shot
     damage for fire rate. Every gun now has its own velocity, range and
     falloff curve, so an AKM genuinely reaches further than a Vector rather
     than just hitting harder.

     ---------- BALANCE BANDS ----------
     Damage × fire rate is held inside a per-role band, so a role is chosen for
     its range and handling rather than because it quietly out-DPSes the rest.
     The average hit-zone roll is exactly 1.0 (see combat.js HIT_ZONES), so DPS
     here is also damage-per-second on an unarmoured target:

       SMG      170–190   0.53–0.59s     shortest reach, widest cones
       LMG      150–170   0.59–0.67s     heavy, punishing reloads
       AR       140–150   0.67–0.71s     the reference band
       Carbine  140–150   0.67–0.71s     AR damage, less reach, lighter
       Burst    110–140   two bursts, but only if every round lands
       DMR      120–135   0.75–0.83s
       Pistol   105–115   0.87–0.95s     sidearms, not primaries
       Sniper   —         Barrett one-shots a bare torso; bolts want a head
       Shotgun  —         a full 9 pellets kills; spread decides the range

     Ranges (tiles): shotgun 13–18, SMG 11–17, pistol 10–14, carbine 19–25,
     AR 24–27, LMG 27–30, DMR 36–40, sniper 50–56. The screen is about 26
     tiles across, so an AR reaches roughly what you can see and a sniper
     reaches twice it. Shotguns went from under a tile — a bug, not a choice —
     to 13–18, far enough to actually threaten across a room or a courtyard;
     what keeps them close-quarters now is pellet spread and falloff, not a
     wall the bullets hit in mid-air.

     Matched against survev's gunDefs + bulletDefs, joined per gun:
       damage      <- bullet_<gun>.damage
       fr          <- 1 / gunDef.fireDelay
       mag/reload  <- maxClip / reloadTime
       acc         <- gunDef.shotSpread (degrees) * 1.586, which lands the
                      same cone in our radian model
       mspread     <- gunDef.moveSpread: extra spread while you're moving,
                      so a MAC-10 sprays when you run and a QBB bullpup
                      barely notices
       falloff     <- (1 - bulletDef.falloff) * 50
       range/speed <- bulletDef.distance / .speed

     Documented deviations, all because our roster isn't 1:1 with theirs:
       • K11 and AN-94 are 3- and 2-round bursts here; survev's nearest guns
         are full-auto, so their damage is scaled to fit a sane burst count.
       • P90 is interpolated between survev's MP5 and UMP9 — we need a
         full-auto SMG with a 50-round mag and neither is quite that.
       • RPK-74 takes the BAR's round with the DP-28's cyclic rate.
       • SV-98 / QBU-10 / DEagle / FAMAS cycle a touch faster than survev's, purely so
         each class stays inside its TTK band (see the balance checks).
       • Launchers have no survev counterpart and keep our own tuned values. */
  const RAW = [
    // name, type, dmg, fr, mag, reload, acc, rec, hand, scope, weight, ammo, action, falloff, other, attach, special, cls, pos, neu, neg, bspeed (tiles/s), range (tiles), trait, mspread
    ['M16','Assault Rifle','13',11.5,'20, 30','3.1s',3.17,0.2,'0.28s',1.2,9,'Blue','Automatic','9%','None','Grenade Launcher, Scope, Suppressor','AP, Tracer, HP','Rifleman','A,Rc,H','M,W,Rd','D,F,S',54,24,'Flattest recoil in the class - the reference rifle',4],
    ['AKM','Assault Rifle','15',9.5,'30, 45','2.5s',3.97,0.3,'0.4s',1,7,'Blue','Automatic','5%','None','Grenade Launcher, Scope, Suppressor','AP, Tracer, HP','Rifleman','F,M,W','D,S,A','Rc,H,Rd',52,27,'Longest reach of the ARs, but it kicks and wanders when you move',7.5],
    ['SCAR-H','Assault Rifle','17',8.8,'20','2.4s',3.97,0.25,'0.34s',0.8,11,'Blue','Automatic','8%','None','Grenade Launcher, Scope, Suppressor','AP, Tracer, HP','Rifleman','D,S,Rd','F,Rc,H','A,W,M',56,25,'Heaviest round per shot, smallest magazine - six hits, not eight',6],
    ['FAMAS F1','Burst Rifle','17*3',14.3,'25','2.3s',1.74,0.35,'0.38s',0.5,6,'Green','Automatic','10%','0.26s Burst Delay','Scope, Suppressor','AP, Tracer, HP','Scout','D,S,W','F,A,Rd','M,Rc,H',55,22,'Pin-point burst - land both and it is a two-burst kill',2],
    ['AN-94','Burst Rifle','26*2',8.3,'30, 45','2.35s',2.38,0.3,'0.3s',1.1,8,'Green','Automatic','3%','0.26s Burst Delay','Scope, Suppressor','AP, Tracer, HP','Scout','A,Rd,H','M,Rc,W','F,D,S',58,30,'Hyperburst: two rounds land almost together, and it reaches',4],
    ['K11','Burst Rifle','16*3',16.7,'45','2.8s',3.4,0.25,'0.34s',0.8,10,'Green','Automatic','7%','0.20s Burst Delay','Scope, Suppressor','AP, Tracer, HP','Scout','F,M,Rc','D,S,H','Rd,A,W',55,24,'Huge magazine, tightest burst spacing',5],
    ['M249','LMG','13.5',12.5,'100','6.7s',2.38,0.17,'0.6s',0.8,15,'Cyan','Automatic','5%','None','Bipod, Scope','AP, Tracer','Gunner','F,S,A','M,Rd,W','D,Rc,H',60,27,'100 rounds of suppression, punishing reload',6],
    ['RPK-74','LMG','17',9,'45','3.3s',3.17,0.15,'0.5s',1.2,12,'Cyan','Automatic','5%','None','Bipod, Scope','AP, Tracer','Gunner','D,Rd,W','A,Rc,H','M,S,F',58,30,'Rifle-weight rounds; the LMG you can actually move with',8],
    ['PKP','LMG','17',10,'200','5s',3.97,0.13,'0.4s',1,18,'Cyan','Automatic','5%','None','Bipod, Scope','AP, Tracer','Gunner','M,Rc,H','D,S,F','Rd,A,W',58,28,'200-round belt - chews cover as fast as people',7.5],
    ['Vector','SMG','7.5',25,'33, 25      , 33','1.6s',3.97,0.1,'0.15s',2,8,'Yellow','Automatic','20%','None','Suppressor','HP, Tracer','Assault','Rc,S,H','Rd,A,W','F,M,D',44,12,'Absurd rate of fire, evaporates past a room',4.5],
    ['Uzi','SMG','8.75',21,'20, 32','1.8s',15.9,0.2,'0.2s',4,6,'Yellow','Automatic','20%','None','Suppressor','HP, Tracer','Assault','F,Rd,W','M,H,D','Rc,A,S',40,11,'Sprays wildly, and worse at a run - a doorway weapon',11],
    ['P90','SMG','12',14,'50','2s',4.76,0.15,'0.25s',3,10,'Yellow','Automatic','12%','None','Suppressor','HP, Tracer','Assault','M,A,D','Rc,F,S','Rd,H,W',48,17,'50-round mag and real accuracy; the SMG with range',4],
    ['M870','Shotgun','12.5',1.11,'5','0.75s/shell',10,2.1,'0.3s',5,8,'Red','Non-Automatic','10%','9 Pellets','Sawed-Off, Scope','Slug, Birdshot','Breacher','D,H,W','Rd,S,Rc','F,M,A',40,13,'A full 9-pellet hit at contact range kills outright',2],
    ['BM4','Shotgun','10.5',2.2,'7','0.52s/shell',6,1.75,'0.5s',4,10,'Red','Semi-Automatic','7%','9 Pellets','Sawed-Off, Scope','Slug, Birdshot','Breacher','Rd,A,S','F,M,W','D,H,Rc',46,18,'Flechette loads: the shotgun that still works at range',4],
    ['SPAS-12','Shotgun','8.75',1.33,'9','0.55s/shell',3,1.4,'0.4s',6,12,'Red','Semi-Automatic','5%','9 Pellets','Sawed-Off, Scope','Slug, Birdshot','Breacher','F,M,Rc','D,A,H','Rd,S,W',42,15,'Semi-auto buckshot - two triggers, two bodies',3],
    ['Mk 14 EBR','DMR','28',4.35,'20','2.5s',1.586,0.9,'0.42s',0.55,12,'Orange','Semi-Automatic','5%','None','Scope, Suppressor','AP, Tracer, HP','Marksman','D,A,M','Rd,H,W','F,Rc,S',66,38,'20-round DMR mag - the volume marksman rifle',4.25],
    ['SVD Dragunov','DMR','37',3.6,'10','2.5s',1.586,1.05,'0.45s',0.5,10,'Orange','Semi-Automatic','5%','None','Scope, Suppressor','AP, Tracer, HP','Marksman','D,Rd,S','A,H,W','F,M,Rc',68,40,'Three body shots, or two with a head in them',4.5],
    ['QBU-88','DMR','23',5.4,'10','2.4s',1.586,0.75,'0.38s',0.45,9,'Orange','Semi-Automatic','5%','None','Scope, Suppressor','AP, Tracer, HP','Marksman','F,A,Rc','D,Rd,S','M,H,W',70,36,'Fastest-cycling DMR, steadiest on the move',3],
    ['Barrett M82 / M107','Sniper Rifle','102',1,'10','3.75s',1.586,3.6,'0.75s',0.24,30,'Olive','Semi-Automatic','1%','Anti-Materiel','Bipod, Scope','AP, Tracer','Sniper','D,M,F','A,Rd,H','W,S,Rc',100,50,'Anti-materiel: one round through a bare torso, and it eats structures',4],
    ['SV-98','Sniper Rifle','80',0.85,'10','2.7s',1.586,3.1,'1.55s',0.16,14,'Olive','Non-Automatic','2%','None','Bipod, Scope','AP, Tracer','Sniper','D,A,W','M,Rd,S','F,H,Rc',92,56,'Longest range on the roster; one head is enough',2.5],
    ['QBU-10','Sniper Rifle','72',1,'5','2.9s',1.586,2.7,'1.35s',0.17,13,'Olive','Non-Automatic','2%','None','Bipod, Scope','AP, Tracer','Sniper','A,Rd,W','D,H,Rc','M,F,S',90,52,'Handles fastest of the bolt guns, smallest magazine',3],
    ['DEagle','Pistol','35',3.2,'7','2.3s',3.97,0.65,'0.15s',1.8,3,'Black','Semi-Automatic','12%','None','Scope, Suppressor, Flare Launcher','AP, HP','Engineer','D,S,Rd','A,W,M','Rc,F,H',58,14,'Hand cannon: three shots, and it hits like a DMR',6],
    ['Makarov PM','Pistol','17',6.5,'8','1.6s',4.76,0.45,'0.13s',2,2,'Black','Semi-Automatic','12%','None','Scope, Suppressor, Flare Launcher','AP, HP','Engineer','M,F,W','Rd,H,Rc','D,S,A',48,10,'Fastest trigger of the pistols, snappiest draw',5],
    ['Colt Python','Pistol','27',4,'6','2s',1.98,0.5,'0.14s',2.1,2,'Black','Semi-Automatic','15%','None','Scope, Suppressor, Flare Launcher','AP, HP','Engineer','H,A,Rc','F,D,S','M,Rd,W',56,12,'Revolver accuracy - the pin-point sidearm',3],
    ['M4','Carbine','13',11,'30','3.1s',3.17,0.18,'0.24s',1,7,'Purple','Automatic','9%','None','Scope, Suppressor','AP, Tracer, HP','Medic','A,Rc,H','M,Rd,W','D,F,S',54,22,'The all-rounder: an M16 that trades reach for handling',4],
    ['AKS-74U','Carbine','13.5',11,'30','2.4s',4.76,0.24,'0.22s',1.35,6,'Purple','Automatic','10%','None','Scope, Suppressor','AP, Tracer, HP','Medic','D,H,W','F,M,Rd','A,Rc,S',48,19,'Cut-down AK: quickest handling, wanders when you run',7.5],
    ['QBZ-95B','Carbine','14',10,'30','3s',6.34,0.2,'0.23s',1.15,7,'Purple','Automatic','5%','None','Scope, Suppressor','AP, Tracer, HP','Medic','F,A,Rc','D,M,H','Rd,W,S',60,25,'Bullpup: wide from the hip but rock-steady on the move',0.5],
    ['M79','Launcher','125','N/A','1','2.2s',2.5,2.8,'0.42s',1,7,'Brown','Non-Automatic','25%','Explosive','Scope','','Demolitionist','D,A,W','Rd,H,M','F,Rc,S',24,20,'Lobbed HE round - arcs into cover',3],
    ['Rpg-7','Launcher','110','N/A','1','3.3s',3.5,4.5,'0.65s',1.4,15,'Brown','Non-Automatic','18%','HEAT','Scope','','Demolitionist','D,Rc,M','A,H,S','F,Rd,W',30,24,'The only HEAT weapon: the answer to a tank',5],
    ['QLZ-87','Launcher','60',4,'6','3.8s',4.2,2,'0.7s',1.8,26,'Brown','Automatic','30%','Explosive','Bipod, Scope','','Demolitionist','F,M,Rd','A,H,Rc','D,W,S',26,22,'Automatic grenade launcher - area denial on a tripod',6],
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
           ammo, actionStr, falloffStr, other, attach, special, cls, pos, neu, neg,
           bspeed, rangeUnits, trait, mspread] = row;

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
      // per-gun muzzle velocity and effective range, both authored in tiles
      bulletSpeed: (bspeed || tm.bspeed) * TILE,   // tiles/s -> px/s
      range: (rangeUnits || 24) * TILE,            // tiles   -> px
      trait: trait || '',

      // accuracy model
      spreadBase: acc * 0.011,          // hipfire cone (radians)
      moveSpread: (mspread || 0) * 0.011,   // extra cone while you're moving
      adsMult: tm.ads,                  // spread multiplier while aiming
      recoilKick: rec * 0.016,          // bloom added per shot
      bloomMax: 0.02 + rec * 0.055,     // cap on accumulated bloom
      // Now that shotguns actually reach, the pellet cone is what makes them a
      // close-range weapon: at 13 tiles a ±0.10 rad fan is ±65px, so a torso
      // catches one or two pellets there and most of them at contact.
      pelletSpread: pellets > 1 ? PELLET_SPREAD : 0,

      // range / damage falloff
      falloff: num(falloffStr) / 100,   // fraction lost per range-step
      explosive, splashRadius: explosive ? SPLASH_RADIUS : 0,
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
      pelletSpread: pellets > 1 ? PELLET_SPREAD : 0,
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
    list, byId, BOT_POOL, AMMO_COLORS, CLASS_META, RATING_LABELS, TYPE_META, SCOPES, withMods, TILE,
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
