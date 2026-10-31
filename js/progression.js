/* ============================================================
   progression.js — missions, battle pass, weapons, XP & rewards
   ============================================================ */
const Progression = (() => {

  /* ---------- Weapons come from weapons.js (full roster) ---------- */
  const WEAPONS = Weapons.byId;

  /* Make sure a profile's loadout is valid against the current roster. */
  function ensureLoadout(profile) {
    let changed = false;
    if (!profile.unlockedWeapons || !profile.unlockedWeapons.length) { profile.unlockedWeapons = Weapons.allIds(); changed = true; }
    if (!WEAPONS[profile.weapon]) { profile.weapon = Weapons.default; changed = true; }
    // skins / attachments / ammo arrived after the first profiles were written
    for (const [key, init] of [['skins', []], ['weaponSkins', {}], ['attachments', {}], ['ammo', {}]]) {
      if (!profile[key]) { profile[key] = init; changed = true; }
    }
    // and perks after those — an older profile has no perk field at all, and
    // one naming a perk that has since been removed should fall back, not break
    /* Normalised rather than merely checked: a profile from an older build
       carries one perk and no slots, and a hand-edited one could carry three
       from the same section. `normalise` turns either into one per section. */
    const want = Perks.normalise(Array.isArray(profile.perks) ? profile.perks : profile.perk);
    if (!Array.isArray(profile.perks) || want.join() !== profile.perks.join()) {
      profile.perks = want; changed = true;
    }
    // the legacy single field mirrors the Body slot, for older builds
    if (profile.perk !== want[0]) { profile.perk = want[0]; changed = true; }
    // drop anything that no longer exists in the roster
    for (const id of Object.keys(profile.attachments)) {
      const w = WEAPONS[id];
      const kept = (profile.attachments[id] || []).filter(a => w && w.attachments.includes(a));
      if (kept.length !== (profile.attachments[id] || []).length) { profile.attachments[id] = kept; changed = true; }
    }
    for (const id of Object.keys(profile.ammo)) {
      const w = WEAPONS[id];
      if (!w || !w.specialAmmo.includes(profile.ammo[id])) { delete profile.ammo[id]; changed = true; }
    }
    if (changed) DB.saveProfile(profile);
    return profile;
  }

  /* ---------- Battle Pass tiers ---------- */
  const BP_XP_PER_TIER = 1000;
  const BP_TIERS = [
    { icon: '🎖️', name: 'Recruit Banner' },
    { icon: '🪙', name: '250 Credits' },
    { icon: '🎨', name: 'Blue Camo' },
    { icon: '💎', name: '15 Gems' },
    { icon: '💥', name: 'Shotgun Unlock' },
    { icon: '🏷️', name: 'Emblem' },
    { icon: '🪙', name: '500 Credits' },
    { icon: '🔥', name: 'Flame Trail' },
    { icon: '💎', name: '30 Gems' },
    { icon: '🎯', name: 'Marksman Unlock' },
    { icon: '👑', name: 'Elite Title' },
    { icon: '🌟', name: 'Prestige Charm' },
  ];

  /* ---------- Mission pools ---------- */
  const DAILY_POOL = [
    { id: 'd_kills',  text: 'Eliminate 8 enemies',       goal: 8,  metric: 'kills',      reward: 120 },
    { id: 'd_play',   text: 'Play 3 matches',            goal: 3,  metric: 'matches',    reward: 90  },
    { id: 'd_win',    text: 'Win 1 match',               goal: 1,  metric: 'wins',       reward: 150 },
    { id: 'd_cap',    text: 'Capture 3 objectives',      goal: 3,  metric: 'captures',   reward: 130 },
    { id: 'd_dom',    text: 'Play 2 Domination matches', goal: 2,  metric: 'domMatches', reward: 100 },
    { id: 'd_elim',   text: 'Play 2 Elimination matches',goal: 2,  metric: 'elimMatches',reward: 100 },
  ];
  const WEEKLY_POOL = [
    { id: 'w_kills', text: 'Eliminate 40 enemies',   goal: 40, metric: 'kills',    reward: 500 },
    { id: 'w_wins',  text: 'Win 5 matches',          goal: 5,  metric: 'wins',     reward: 700 },
    { id: 'w_cap',   text: 'Capture 15 objectives',  goal: 15, metric: 'captures', reward: 550 },
  ];

  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function weekStr() {
    const d = new Date();
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${week}`;
  }
  function pick(pool, n) {
    const copy = [...pool];
    const out = [];
    for (let i = 0; i < n && copy.length; i++) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }

  /* Ensure the active profile has today's missions; regenerate on new day/week. */
  function ensureMissions(profile) {
    let changed = false;
    if (!profile.missions || profile.missionsDate !== todayStr()) {
      profile.missions = {
        daily: pick(DAILY_POOL, 3).map(m => ({ ...m, progress: 0, done: false })),
      };
      profile.missionsDate = todayStr();
      changed = true;
    }
    if (!profile.weekly || profile.weeklyDate !== weekStr()) {
      profile.weekly = pick(WEEKLY_POOL, 2).map(m => ({ ...m, progress: 0, done: false }));
      profile.weeklyDate = weekStr();
      changed = true;
    }
    if (changed) DB.saveProfile(profile);
    return profile;
  }

  function timeUntilReset() {
    const now = new Date();
    const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0);
    const ms = tomorrow - now;
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }

  /* Apply a set of match metrics to missions; returns credits earned from completions. */
  function applyMissionProgress(profile, metrics) {
    let creditsEarned = 0;
    /* Both lists are filled in by the home screen, so a profile that has gone
       straight into a match has neither: `missions` is null on a fresh
       profile and `weekly` is not a key at all. This read threw on the first
       line of the end-of-match path, which takes the entire results screen,
       the XP award and the saved match record with it — a crash with nothing
       on screen to say it happened. Missing lists simply have no progress to
       apply. */
    const lists = [
      (profile.missions && profile.missions.daily) || [],
      profile.weekly || [],
    ];
    lists.forEach(list => list.forEach(m => {
      if (m.done) return;
      const amount = metrics[m.metric] || 0;
      if (amount > 0) {
        m.progress = Math.min(m.goal, m.progress + amount);
        if (m.progress >= m.goal) {
          m.done = true;
          creditsEarned += m.reward;
          Toast.show(`Mission complete: ${m.text} (+${m.reward} 🪙)`, 'reward');
        }
      }
    }));
    return creditsEarned;
  }

  /* Award XP toward account level + battle pass. Handles tier unlocks. */
  function awardXp(profile, xp) {
    // account level (simple: 500 xp per level)
    profile.xp += xp;
    while (profile.xp >= profile.level * 500) {
      profile.xp -= profile.level * 500;
      profile.level++;
      Toast.show(`Level up! You reached level ${profile.level}`, 'good');
    }
    // battle pass
    profile.bpXp += xp;
    while (profile.bpXp >= BP_XP_PER_TIER && profile.bpTier < BP_TIERS.length) {
      profile.bpXp -= BP_XP_PER_TIER;
      profile.bpTier++;
      const reward = BP_TIERS[profile.bpTier - 1];
      Toast.show(`Battle Pass Tier ${profile.bpTier}: ${reward.name}!`, 'reward');
      grantTierReward(profile, profile.bpTier);
    }
    if (profile.bpTier >= BP_TIERS.length) profile.bpXp = Math.min(profile.bpXp, BP_XP_PER_TIER);
  }

  /* Six of the twelve tiers used to grant nothing at all: Recruit Banner,
     Blue Camo, Emblem, Flame Trail, Elite Title and Prestige Charm all
     popped the "Tier X: name!" toast and then did not touch the profile —
     the reward was real on screen for one second and gone forever. Credits,
     gems and the two weapon unlocks already worked; this fills in the rest
     by reusing the systems that already own cosmetics rather than
     inventing a parallel one for a single tier each. */
  function grantTierReward(profile, tier) {
    const name = (BP_TIERS[tier - 1].name || '').toLowerCase();
    if (name.includes('credits')) { profile.credits += parseInt(name) || 0; return; }
    if (name.includes('gems')) { profile.gems += parseInt(name) || 0; return; }
    if (name.includes('shotgun') && !profile.unlockedWeapons.includes('spas-12')) { profile.unlockedWeapons.push('spas-12'); return; }
    if (name.includes('marksman') && !profile.unlockedWeapons.includes('mk-14-ebr')) { profile.unlockedWeapons.push('mk-14-ebr'); return; }
    // a skin is owned exactly the way a shop purchase would own it
    if (name.includes('camo')) {
      const skinId = 'midnight';
      if (!(profile.skins || []).includes(skinId)) profile.skins = (profile.skins || []).concat(skinId);
      return;
    }
    // a banner is owned exactly the way a shop purchase would own it
    if (name.includes('banner') && typeof Shop !== 'undefined') {
      const bannerId = 'bn-wolves';
      profile.owned = profile.owned || [];
      if (!profile.owned.includes(bannerId)) profile.owned.push(bannerId);
      return;
    }
    /* Emblem, Flame Trail, Elite Title, Prestige Charm: there is no shop
       category or equip slot for any of these yet (see Shop.CATEGORIES) —
       building four full cosmetic systems, each with its own UI, is a
       bigger job than this fix. Banked here so claiming one is recorded
       rather than silently discarded; a display/equip slot reading
       `profile.cosmetics` is the natural next step if these should be worn
       rather than just collected. */
    profile.cosmetics = profile.cosmetics || [];
    profile.cosmetics.push({ tier, name: BP_TIERS[tier - 1].name, icon: BP_TIERS[tier - 1].icon });
  }

  return {
    WEAPONS, BP_TIERS, BP_XP_PER_TIER,
    ensureMissions, ensureLoadout, timeUntilReset, applyMissionProgress, awardXp,
  };
})();
