/* ============================================================
   shop.js — what you can spend your coins on.

   Two currencies, both already earned by playing:
     🪙 Credits    — match rewards, missions, battle pass
     💎 Squad Coins — rarer; battle pass and big mission payouts

   Nothing here touches combat stats. Everything is cosmetic or a
   convenience (loadout slots, a match XP boost). Weapon skins are
   defined in skins.js and surfaced here as one of the categories.
   ============================================================ */
const Shop = (() => {

  /* ---------- non-skin catalogue ---------- */
  // kind: what buying it does. `apply(profile)` runs once at purchase.
  const CATALOG = [
    /* --- avatars --- */
    { id: 'av-wolf',    cat: 'avatar', name: 'Wolf',        icon: '🐺', price: 300,  cur: 'credits' },
    { id: 'av-eagle',   cat: 'avatar', name: 'Eagle',       icon: '🦅', price: 300,  cur: 'credits' },
    { id: 'av-crown',   cat: 'avatar', name: 'Crown',       icon: '👑', price: 1200, cur: 'credits' },
    { id: 'av-reaper',  cat: 'avatar', name: 'Reaper',      icon: '☠️', price: 1200, cur: 'credits' },
    { id: 'av-dragon',  cat: 'avatar', name: 'Dragon',      icon: '🐉', price: 25,   cur: 'gems' },
    { id: 'av-alien',   cat: 'avatar', name: 'Visitor',     icon: '👽', price: 25,   cur: 'gems' },

    /* --- name colours (your callsign in the scoreboard/HUD) --- */
    { id: 'nc-ember',   cat: 'nametag', name: 'Ember Tag',   icon: '🔥', price: 500,  cur: 'credits', color: '#ff7a2b' },
    { id: 'nc-frost',   cat: 'nametag', name: 'Frost Tag',   icon: '❄️', price: 500,  cur: 'credits', color: '#9fd8ff' },
    { id: 'nc-toxic',   cat: 'nametag', name: 'Toxic Tag',   icon: '☣️', price: 900,  cur: 'credits', color: '#4be08a' },
    { id: 'nc-royal',   cat: 'nametag', name: 'Royal Tag',   icon: '💜', price: 15,   cur: 'gems',    color: '#c46bff' },

    /* --- tracer colours, independent of skin --- */
    { id: 'tr-plasma',  cat: 'tracer', name: 'Plasma Rounds', icon: '⚡', price: 800,  cur: 'credits', color: '#35e0ff' },
    { id: 'tr-blood',   cat: 'tracer', name: 'Blood Rounds',  icon: '🩸', price: 800,  cur: 'credits', color: '#ff4b5c' },
    { id: 'tr-gold',    cat: 'tracer', name: 'Gilded Rounds', icon: '✨', price: 20,   cur: 'gems',    color: '#ffcf4a' },

    /* --- utility: real quality-of-life, still no combat stats --- */
    { id: 'ut-preset2', cat: 'utility', name: 'Loadout Preset Slot', icon: '🎽', price: 1500, cur: 'credits',
      desc: 'A second saved loadout you can swap between.', apply: (p) => { p.presetSlots = (p.presetSlots || 1) + 1; } },
    { id: 'ut-xp',      cat: 'utility', name: 'XP Boost (5 matches)', icon: '📈', price: 1000, cur: 'credits',
      desc: '+50% account XP for your next 5 matches.', repeatable: true,
      apply: (p) => { p.xpBoost = (p.xpBoost || 0) + 5; } },
    { id: 'ut-rename',  cat: 'utility', name: 'Callsign Change',      icon: '📝', price: 10,   cur: 'gems',
      desc: 'Rename your operator from the settings panel.', repeatable: true,
      apply: (p) => { p.renameTokens = (p.renameTokens || 0) + 1; } },
  ];

  const CATEGORIES = [
    { id: 'skin',    name: 'Weapon Skins', icon: '🎨' },
    { id: 'avatar',  name: 'Avatars',      icon: '🙂' },
    { id: 'nametag', name: 'Name Tags',    icon: '🏷️' },
    { id: 'tracer',  name: 'Tracers',      icon: '💫' },
    { id: 'utility', name: 'Utility',      icon: '🧰' },
  ];

  const byId = {};
  CATALOG.forEach(i => byId[i.id] = i);

  const owns = (profile, id) => (profile.owned || []).includes(id);
  const wallet = (profile, cur) => (cur === 'gems' ? profile.gems : profile.credits);

  /* every skin, presented as a shop item so one renderer handles both */
  function skinItems() {
    return Skins.ids.filter(id => !Skins.get(id).free).map(id => {
      const s = Skins.get(id);
      return {
        id: 'skin:' + id, skinId: id, cat: 'skin', name: s.name, icon: '🎨',
        price: Skins.priceOf(id), cur: 'credits',
        rarity: s.rarity, barrel: s.barrel, accent: s.accent,
        desc: s.for === 'all' ? 'Fits any weapon' : 'Fits ' + s.for.join(' / '),
      };
    });
  }
  const items = (cat) => (cat === 'skin' ? skinItems() : CATALOG.filter(i => i.cat === cat));

  /* is this owned? skins live in profile.skins, everything else in profile.owned */
  function isOwned(profile, item) {
    if (item.cat === 'skin') return Skins.owns(profile, item.skinId);
    if (item.repeatable) return false;             // buyable again and again
    return owns(profile, item.id);
  }

  /* buy → { ok, error }, mutates the profile on success */
  function purchase(profile, item) {
    if (!item) return { ok: false, error: 'Unknown item.' };
    if (isOwned(profile, item)) return { ok: false, error: 'Already owned.' };
    const have = wallet(profile, item.cur);
    if (have < item.price) {
      const short = item.price - have;
      return { ok: false, error: `Need ${short} more ${item.cur === 'gems' ? 'squad coins' : 'credits'}.` };
    }
    if (item.cur === 'gems') profile.gems -= item.price; else profile.credits -= item.price;

    if (item.cat === 'skin') {
      profile.skins = (profile.skins || []).concat(item.skinId);
    } else {
      profile.owned = (profile.owned || []).concat(item.id);
      if (item.apply) item.apply(profile);
    }
    return { ok: true };
  }

  /* things the player owns that change how they look in a match */
  const equippedNameColor = (profile) => {
    const it = byId[profile.nametag];
    return (it && owns(profile, it.id)) ? it.color : null;
  };
  const equippedTracer = (profile) => {
    const it = byId[profile.tracer];
    return (it && owns(profile, it.id)) ? it.color : null;
  };

  return {
    CATALOG, CATEGORIES, byId, items, isOwned, purchase, wallet,
    equippedNameColor, equippedTracer, skinItems,
  };
})();
