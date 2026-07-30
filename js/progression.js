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
    const lists = [profile.missions.daily, profile.weekly];
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

  function grantTierReward(profile, tier) {
    const name = (BP_TIERS[tier - 1].name || '').toLowerCase();
    if (name.includes('credits')) profile.credits += parseInt(name) || 0;
    if (name.includes('gems')) profile.gems += parseInt(name) || 0;
    if (name.includes('shotgun') && !profile.unlockedWeapons.includes('spas-12')) profile.unlockedWeapons.push('spas-12');
    if (name.includes('marksman') && !profile.unlockedWeapons.includes('mk-14-ebr')) profile.unlockedWeapons.push('mk-14-ebr');
  }

  return {
    WEAPONS, BP_TIERS, BP_XP_PER_TIER,
    ensureMissions, ensureLoadout, timeUntilReset, applyMissionProgress, awardXp,
  };
})();
