/* ============================================================
   audio.js — tiny WebAudio SFX engine (no asset files needed).
   Generates blips/booms procedurally so the prototype has sound
   without shipping audio files. Respects settings volume/sfx.

   ---------- positional audio ----------
   Every sound used to play at the same volume dead-centre no matter
   where it happened, which meant a kill on the far side of the island
   sounded exactly like one next to you — and worse, only the LOCAL
   PLAYER'S OWN gunshots ever made a sound at all; every other agent on
   the map fired in total silence (see game.js's old `if (isYours(a))
   SFX.shoot()` gate). In a genre where tracking a fight by ear is core
   gameplay, that is not a missing flourish, it is a missing sense.

   `rel` is an optional `{dx, dy}` — the vector from the listener (the
   player) to wherever the sound happened, in world pixels. Pass it and
   the sound pans and fades with distance; omit it and the sound plays
   centred at full volume, exactly as every call site worked before this
   existed — menu clicks, your own win/lose stinger, and anything else
   that has no sensible position in the world. ============================================================ */
const SFX = (() => {
  let ctx = null;
  const ensure = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; };

  function enabled() {
    const s = DB.getSettings();
    return s.sfx && s.volume > 0;
  }
  function gainLevel() { return (DB.getSettings().volume / 100) * 0.35; }

  /* How far an ear reaches. Past this a sound is silent rather than
     merely quiet — the whole point is that a gunfight on the other side
     of an 8600px island should not compete with the one you're in.
     Falloff is squared, not linear, so a sound stays loud close up and
     drops off harder at range, the way a gunshot actually reads: sharp
     nearby, a dull pop a block away, nothing further out. */
  const EAR_RANGE = 1400;
  function spatial(rel) {
    if (!rel) return { gain: 1, pan: 0 };
    const d = Math.hypot(rel.dx, rel.dy);
    if (d >= EAR_RANGE) return { gain: 0, pan: 0 };
    const g = 1 - d / EAR_RANGE;
    return { gain: g * g, pan: Math.max(-1, Math.min(1, rel.dx / (EAR_RANGE * 0.6))) };
  }
  /* One gain node, panned if this is a positional sound and the browser
     can (every evergreen browser can); routed straight to the speakers
     if not. Kept separate from tone()/noise() so both share it. */
  function route(ac, g, pan) {
    if (pan && ac.createStereoPanner) {
      const p = ac.createStereoPanner(); p.pan.value = pan;
      g.connect(p); p.connect(ac.destination);
    } else {
      g.connect(ac.destination);
    }
  }

  function tone(freq, dur, type = 'square', slideTo = null, rel, loud) {
    if (!enabled()) return;
    const sp = spatial(rel);
    if (sp.gain <= 0) return;
    const ac = ensure();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
    g.gain.value = gainLevel() * sp.gain * (loud === undefined ? 1 : loud);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(g);
    route(ac, g, sp.pan);
    osc.start(); osc.stop(ac.currentTime + dur);
  }
  function noise(dur, vol = 1, rel, loud) {
    if (!enabled()) return;
    const sp = spatial(rel);
    if (sp.gain <= 0) return;
    const ac = ensure();
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ac.createBufferSource(); src.buffer = buf;
    const g = ac.createGain(); g.gain.value = gainLevel() * vol * sp.gain * (loud === undefined ? 1 : loud);
    src.connect(g);
    route(ac, g, sp.pan);
    src.start();
  }

  /* ---------- per-weapon gunshot identity ----------
     Every gun used to share one tone — a Barrett and a suppressed Uzi
     were indistinguishable by ear. Ten profiles, one per weapon `type`
     (see weapons.js's RAW roster, column 2), built from the same two
     primitives everything else here uses: a clean tone carries the
     crack, a noise layer under it carries the blast — present only on
     the guns loud enough to need one. */
  const SHOT = {
    'Pistol':        { freq: 520, slide: 260, dur: 0.055, wave: 'square' },
    'SMG':           { freq: 480, slide: 220, dur: 0.050, wave: 'square' },
    'Assault Rifle': { freq: 420, slide: 180, dur: 0.080, wave: 'square' },
    'Burst Rifle':   { freq: 440, slide: 190, dur: 0.070, wave: 'square' },
    'Carbine':       { freq: 460, slide: 210, dur: 0.065, wave: 'square' },
    'DMR':           { freq: 340, slide: 140, dur: 0.110, wave: 'sawtooth', noiseVol: 0.25 },
    'LMG':           { freq: 300, slide: 120, dur: 0.100, wave: 'square',   noiseVol: 0.30 },
    'Sniper Rifle':  { freq: 160, slide: 70,  dur: 0.220, wave: 'sawtooth', noiseVol: 0.60 },
    'Shotgun':       { freq: 150, slide: 90,  dur: 0.140, wave: 'sawtooth', noiseVol: 0.90 },
    'Launcher':      { freq: 110, slide: 60,  dur: 0.180, wave: 'sawtooth', noiseVol: 0.70 },
  };

  return {
    resume: () => { try { ensure().resume(); } catch {} },
    /* `wtype` is the weapon's `type` string; `loud` is a 0..1 multiplier
       for a suppressor (weapons.js already computes this as `w.audio`,
       reused here rather than re-deriving it) on top of the normal
       distance falloff. */
    shoot: (wtype, rel, loud) => {
      const s = SHOT[wtype] || SHOT['Assault Rifle'];
      tone(s.freq, s.dur, s.wave, s.slide, rel, loud);
      if (s.noiseVol) noise(s.dur * 0.75, s.noiseVol, rel, loud);
    },
    /* A landed hit, distinct from the menu-click it used to borrow. A
       headshot gets the sharper of the two — a clean high crack instead
       of the duller body-shot thud — the same escalation a kill marker
       already gets visually. */
    hit: (rel, head) => head
      ? tone(760, 0.05, 'triangle', 420, rel)
      : tone(240, 0.06, 'sawtooth', 120, rel),
    /* The clink of a vest or helmet eating a round that would otherwise
       have gone straight through — distinct from a clean hit so armour
       actually sounds like armour. */
    armorHit: (rel) => tone(880, 0.035, 'square', 1200, rel),
    /* An enemy round passing close without connecting — the "someone is
       shooting AT me" cue every modern shooter gives you even on a miss.
       Short and bright, like a snap rather than a shot. */
    whiz: (rel) => tone(1400, 0.04, 'sine', 500, rel),
    reload:() => { tone(300, 0.05, 'square'); setTimeout(() => tone(500, 0.06, 'square'), 90); },
    kill:  () => noise(0.25, 1.1),
    hurt:  () => tone(160, 0.15, 'sawtooth', 80),
    /* A real detonation, not the kill sound standing in for one. Lower,
       longer, and distance-aware, so a frag on the far side of a wall
       no longer sounds exactly like a confirmed elimination. */
    explosion: (rel) => { tone(90, 0.3, 'sawtooth', 40, rel); noise(0.35, 1, rel); },
    /* A footfall, pitched and timed by what's underfoot — Terrain already
       computes the surface every agent is standing on for movement speed
       (see Terrain.surfaceAt); this reuses that same classification so a
       footstep costs nothing extra to know about. */
    footstep: (rel, surface) => {
      const t = { road: 0.05, bridge: 0.06, beach: 0.09, river: 0.11, ocean: 0.11, grass: 0.07 }[surface] || 0.07;
      noise(t, surface === 'river' || surface === 'ocean' ? 0.5 : 0.22, rel);
    },
    /* Your own pulse, once your HP drops low enough to hear it. Never
       positional — it isn't happening somewhere in the world, it's
       happening to you — and deliberately quiet; this is tension, not an
       alarm. */
    heartbeat: () => tone(70, 0.12, 'sine', 55),
    capture: () => { tone(500, 0.1); setTimeout(() => tone(700, 0.12), 100); },
    click: () => tone(600, 0.04, 'triangle'),
    /* A door, distinct from the generic click every other interaction
       still shares — opening and closing get their own direction so one
       is audibly not the other. */
    door: (opening, rel) => tone(opening ? 260 : 200, 0.07, 'triangle', opening ? 340 : 140, rel),
    win:   () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle'), i * 120)); },
    lose:  () => { [400, 320, 240].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sawtooth'), i * 160)); },
    reward:() => { [660, 880].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle'), i * 90)); },
  };
})();
