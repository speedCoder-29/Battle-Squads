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

  return { SKINS, RARITIES, ids, get, rarityOf, priceOf, fits, forWeapon, equipped, owns, purchase };
})();
