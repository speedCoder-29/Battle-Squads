/* ============================================================
   skins.js — weapon skins.

   Purely cosmetic: a skin repaints the weapon barrel, the muzzle
   flash and your tracers, and restyles the card in the Loadout
   screen. No stat ever changes — see weapons.js for anything that
   touches combat.

   Skins are bought with credits (the same wallet missions pay into)
   and are account-wide, so a skin you own can be put on any gun it
   is compatible with.
   ============================================================ */
const Skins = (() => {

  const RARITIES = {
    common:    { name: 'Common',    color: '#8ea0c9', price: 250 },
    rare:      { name: 'Rare',      color: '#3d7bff', price: 600 },
    epic:      { name: 'Epic',      color: '#c46bff', price: 1400 },
    legendary: { name: 'Legendary', color: '#ffcf4a', price: 3000 },
  };

  /* barrel  — the weapon line drawn on your operator
     accent  — muzzle flash + card trim
     tracer  — bullet colour (null = keep the ammo-type colour)
     for     — weapon types it fits, or 'all'                     */
  const SKINS = {
    default:   { name: 'Standard',    rarity: 'common', barrel: '#e9f0ff', accent: '#ffd36a', tracer: null, for: 'all', free: true },
    gunmetal:  { name: 'Gunmetal',    rarity: 'common', barrel: '#9aa7bd', accent: '#cfd8ee', tracer: null, for: 'all' },
    woodland:  { name: 'Woodland',    rarity: 'common', barrel: '#6f7f4a', accent: '#a8bd6a', tracer: null, for: 'all' },
    desert:    { name: 'Desert',      rarity: 'common', barrel: '#c2a578', accent: '#e6c893', tracer: null, for: 'all' },

    arctic:    { name: 'Arctic',      rarity: 'rare', barrel: '#e6f2ff', accent: '#9fd8ff', tracer: '#9fd8ff', for: 'all' },
    crimson:   { name: 'Crimson',     rarity: 'rare', barrel: '#c9424f', accent: '#ff8a95', tracer: '#ff4b5c', for: 'all' },
    midnight:  { name: 'Midnight',    rarity: 'rare', barrel: '#2f3a5c', accent: '#6f86b8', tracer: '#7aa2ff', for: 'all' },
    jungle:    { name: 'Jungle Tiger',rarity: 'rare', barrel: '#4f7a3a', accent: '#8fe06a', tracer: '#4be08a', for: 'all', stripes: true },

    voltage:   { name: 'Voltage',     rarity: 'epic', barrel: '#35e0ff', accent: '#b8f6ff', tracer: '#35e0ff', for: 'all', glow: true },
    vaporwave: { name: 'Vaporwave',   rarity: 'epic', barrel: '#ff6ad5', accent: '#8a6aff', tracer: '#ff6ad5', for: 'all', glow: true },
    ember:     { name: 'Ember',       rarity: 'epic', barrel: '#ff7a2b', accent: '#ffd36a', tracer: '#ff9d3b', for: 'all', glow: true },
    sniperElite:{name: 'Cold Bore',   rarity: 'epic', barrel: '#7fb0a0', accent: '#d8fff2', tracer: '#7fffe0', for: ['Sniper Rifle', 'DMR'], glow: true },

    obsidian:  { name: 'Obsidian',    rarity: 'legendary', barrel: '#1b1f2e', accent: '#c46bff', tracer: '#c46bff', for: 'all', glow: true, stripes: true },
    goldplate: { name: 'Gold Plate',  rarity: 'legendary', barrel: '#ffcf4a', accent: '#fff0b8', tracer: '#ffcf4a', for: 'all', glow: true },
    hexcamo:   { name: 'Hex Camo',    rarity: 'legendary', barrel: '#4be08a', accent: '#b8ffd8', tracer: '#4be08a', for: 'all', glow: true, stripes: true },
  };

  /* ---------- every gun's own default ----------
     Until now all thirty weapons drew as the same white 12px line, so an M16
     and a Barrett were indistinguishable on screen — you could not tell what
     somebody was carrying, or what you had just picked up, without reading the
     HUD.

     Each gun now has its own finish and its own proportions. The numbers are
     the weapon's outline in pixels:

       len     how far the barrel reaches past the body
       w       how thick it draws
       stock   a shoulder stock behind the grip, for the long guns
       mag     a magazine hanging below
       optic   a scope block partway down
       muzzle  the tip: 'plain', 'brake', or 'tube' for a launcher

     Sized off the real weapon. A Makarov is a palm-sized pistol and an M107 is
     a 1.4m anti-materiel rifle, and at 40px to the metre that is a 13px stub
     against a 50px barrel. */
  const CLASS_SHAPE = {
    Engineer:      { len: 15, w: 4.0, mag: true },                         // pistols
    Assault:       { len: 22, w: 4.5, mag: true, stock: 4 },               // SMGs
    Breacher:      { len: 26, w: 6.5, stock: 6 },                          // shotguns
    Medic:         { len: 27, w: 5.0, mag: true, stock: 5 },               // carbines
    Rifleman:      { len: 31, w: 5.0, mag: true, stock: 6, optic: true },  // assault rifles
    Scout:         { len: 30, w: 4.8, mag: true, stock: 6, optic: true },  // burst rifles
    Gunner:        { len: 34, w: 7.0, mag: true, stock: 7 },               // LMGs
    Marksman:      { len: 38, w: 4.6, mag: true, stock: 7, optic: true },  // DMRs
    Sniper:        { len: 46, w: 4.4, mag: true, stock: 8, optic: true },  // sniper rifles
    Demolitionist: { len: 28, w: 9.0, stock: 6 },                          // launchers
  };

  /* Per-gun finish, and the deviations from the class outline that make one
     rifle read differently from the next one in its own class. */
  const GUN_DEFAULTS = {
    'm16':        { barrel: '#3f4552', accent: '#c9d4e6', muzzle: 'brake' },
    'akm':        { barrel: '#6b4a2c', accent: '#c08a4a', len: 30, muzzle: 'brake' },
    'scar-h':     { barrel: '#8a7a52', accent: '#d8c88a', len: 32 },
    'famas-f1':   { barrel: '#4a4f42', accent: '#b8c2a8', len: 27 },
    'an-94':      { barrel: '#5c5344', accent: '#b4a482', len: 32 },
    'k11':        { barrel: '#3a4450', accent: '#8fb0d8', len: 29 },
    'm249':       { barrel: '#4a4e46', accent: '#aeb8a6', len: 36 },
    'rpk-74':     { barrel: '#6b4a2c', accent: '#c08a4a', len: 38 },
    'pkp':        { barrel: '#3e4238', accent: '#9aa38e', len: 35, w: 7.5 },
    'vector':     { barrel: '#2f3440', accent: '#7f8ca4', len: 20 },
    'uzi':        { barrel: '#3a3f4a', accent: '#98a4b8', len: 18 },
    'p90':        { barrel: '#33383f', accent: '#a8b4c4', len: 23, w: 5.5, mag: false },
    'm870':       { barrel: '#5a3f28', accent: '#b98a52', len: 27 },
    'bm4':        { barrel: '#4a4038', accent: '#a89070', len: 25 },
    'spas-12':    { barrel: '#33373f', accent: '#8a94a6', len: 28, w: 7 },
    'mk-14-ebr':  { barrel: '#3a3f48', accent: '#9fb0c8', len: 37 },
    'svd-dragunov': { barrel: '#7a5632', accent: '#c99a5a', len: 40 },
    'qbu-88':     { barrel: '#4a4a3e', accent: '#a8a88a', len: 38 },
    'barrett-m82-m107': { barrel: '#33383f', accent: '#c9d4e6', len: 50, w: 5.2, muzzle: 'brake' },
    'sv-98':      { barrel: '#5f4a30', accent: '#b58f56', len: 45 },
    'qbu-10':     { barrel: '#42464a', accent: '#9aa6b4', len: 46, muzzle: 'brake' },
    'deagle':     { barrel: '#b9a15a', accent: '#f0dc9a', len: 17, w: 4.6 },
    'makarov-pm': { barrel: '#2f333a', accent: '#8d95a4', len: 13 },
    'colt-python': { barrel: '#6f7683', accent: '#d0d8e6', len: 16 },
    'm4':         { barrel: '#3f4552', accent: '#c9d4e6', len: 26, optic: true },
    'aks-74u':    { barrel: '#6b4a2c', accent: '#c08a4a', len: 22 },
    'qbz-95b':    { barrel: '#4a4438', accent: '#a89a78', len: 25, optic: true },
    'm79':        { barrel: '#5a4028', accent: '#b98a52', len: 22, w: 8, muzzle: 'tube' },
    'rpg-7':      { barrel: '#4a4234', accent: '#a89666', len: 34, w: 9.5, muzzle: 'tube' },
    'qlz-87':     { barrel: '#3e4a44', accent: '#8fa896', len: 30, w: 9, muzzle: 'tube' },
  };

  /* The outline and finish for a weapon: its class shape, its own overrides,
     and — when the player has equipped one — a bought skin's paint over the
     top. A skin repaints a gun; it never changes its shape. */
  function profileFor(weapon, skinId) {
    const cls = (weapon && weapon.className) || '';
    const own = (weapon && GUN_DEFAULTS[weapon.id]) || {};
    const shape = CLASS_SHAPE[cls] || { len: 26, w: 5, mag: true };
    const paint = (skinId && skinId !== 'default') ? get(skinId) : null;
    const pick = (k) => (own[k] !== undefined ? own[k] : shape[k]);
    return {
      len: pick('len'), w: pick('w'), stock: pick('stock'),
      mag: pick('mag'), optic: pick('optic'),
      muzzle: own.muzzle || shape.muzzle || 'plain',
      barrel: paint ? paint.barrel : (own.barrel || '#8f9aad'),
      accent: paint ? paint.accent : (own.accent || '#d8e2f2'),
      glow: paint ? !!paint.glow : false,
      stripes: paint ? !!paint.stripes : false,
      tracer: paint ? paint.tracer : null,
    };
  }

  const ids = Object.keys(SKINS);
  const get = (id) => SKINS[id] || SKINS.default;
  const rarityOf = (id) => RARITIES[get(id).rarity];
  const priceOf = (id) => (get(id).free ? 0 : rarityOf(id).price);
  const fits = (id, weapon) => {
    const s = get(id);
    return s.for === 'all' || (Array.isArray(s.for) && s.for.includes(weapon.type));
  };
  /* every skin this weapon can wear, cheapest first */
  const forWeapon = (weapon) => ids.filter(id => fits(id, weapon));

  /* the skin actually painted on a weapon right now */
  function equipped(profile, weaponId) {
    const id = profile && profile.weaponSkins && profile.weaponSkins[weaponId];
    return (id && SKINS[id]) ? id : 'default';
  }
  const owns = (profile, id) => get(id).free || (profile.skins || []).includes(id);

  /* buy → returns { ok, error } and mutates the profile on success */
  function purchase(profile, id) {
    if (!SKINS[id]) return { ok: false, error: 'Unknown skin.' };
    if (owns(profile, id)) return { ok: false, error: 'Already owned.' };
    const price = priceOf(id);
    if (profile.credits < price) return { ok: false, error: `Need ${price - profile.credits} more credits.` };
    profile.credits -= price;
    profile.skins = (profile.skins || []).concat(id);
    return { ok: true, price };
  }

  return { SKINS, RARITIES, CLASS_SHAPE, GUN_DEFAULTS, profileFor,
    ids, get, rarityOf, priceOf, fits, forWeapon, equipped, owns, purchase };
})();
