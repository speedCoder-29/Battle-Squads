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

  /* ============================================================
     music — a held pad plus a tension pulse, same no-asset-files rule as
     the SFX above. Gated on its own `music` setting rather than `sfx`, so
     muting gunshots doesn't also mute the menu, and vice versa; shares
     this module's AudioContext (`ensure`, closed over above) rather than
     opening a second one.

     Two moods:
       menu  — a slow chord with a sweeping filter, plus an occasional soft
               bell, for the screens with nothing else making noise.
       match — the same chord, quieter, plus a sub-bass pulse whose rate
               and volume track `setIntensity()`: calm out of a fight,
               roughly a heartbeat-and-a-half across at full tension. The
               heartbeat SFX above is the close-up, diegetic version of the
               same signal; this is its ambient extension, audible from the
               moment a fight is near rather than only once HP is critical.
     ============================================================ */
  const Music = (() => {
    let padNodes = null;             // { oscs, lfo, filter, gain }
    let pulseTimer = null, pulseGen = 0;
    let bellTimer = null, bellGen = 0;
    let mood = null;                 // 'menu' | 'match' | null
    let intensity = 0;

    function mEnabled() {
      const s = DB.getSettings();
      return s.music !== false && s.volume > 0;
    }
    function mLevel() { return (DB.getSettings().volume / 100) * 0.16; }

    // Open fifth plus a minor third on top — reads as tense-but-not-sad
    // under either a calm menu or a firefight, so switching mood never
    // means switching key.
    const CHORD = [110, 164.81, 220, 261.63];

    function buildPad(ac, baseGain) {
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 0.7;
      const g = ac.createGain(); g.gain.value = 0;
      filter.connect(g); g.connect(ac.destination);
      const oscs = CHORD.map((f, i) => {
        const o = ac.createOscillator();
        o.type = 'triangle'; o.frequency.value = f;
        o.detune.value = (i % 2 ? 1 : -1) * 4;   // a few cents, so a held chord breathes rather than sitting dead still
        const og = ac.createGain(); og.gain.value = i === 0 ? 1 : 0.55 / i;
        o.connect(og); og.connect(filter);
        o.start();
        return o;
      });
      // a slow filter sweep, the other half of what keeps a held chord from sounding static
      const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.05;
      const lfoGain = ac.createGain(); lfoGain.gain.value = 260;
      lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();
      g.gain.linearRampToValueAtTime(baseGain, ac.currentTime + 3);
      return { oscs, filter, gain: g, lfo };
    }

    function teardownPad(ac) {
      if (!padNodes) return;
      const { oscs, gain, lfo } = padNodes;
      gain.gain.cancelScheduledValues(ac.currentTime);
      gain.gain.linearRampToValueAtTime(0, ac.currentTime + 1.2);
      const dying = oscs.concat([lfo]);
      setTimeout(() => dying.forEach(o => { try { o.stop(); } catch {} }), 1300);
      padNodes = null;
    }

    // a one-off chime, independent of tone()/noise() above since it is
    // gated on the music setting rather than sfx
    function mtone(ac, freq, dur, vol) {
      const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
      const g = ac.createGain(); g.gain.value = 0;
      osc.connect(g); g.connect(ac.destination);
      const t0 = ac.currentTime;
      g.gain.linearRampToValueAtTime(vol, t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    }

    // an idle plink every few seconds, menu mood only
    function scheduleBell() {
      bellGen++;
      const gen = bellGen;
      const next = () => {
        if (gen !== bellGen || mood !== 'menu') return;
        if (mEnabled()) {
          const notes = [220, 261.63, 329.63, 392, 440];
          mtone(ensure(), notes[(Math.random() * notes.length) | 0], 1.4, mLevel() * 0.4);
        }
        bellTimer = setTimeout(next, 3000 + Math.random() * 3000);
      };
      bellTimer = setTimeout(next, 2500);
    }

    // the tension pulse: a single low thump, re-scheduled after itself at
    // a rate `setIntensity` controls -- calm is close to two seconds
    // apart, full tension is under half that
    function schedulePulse() {
      pulseGen++;
      const gen = pulseGen;
      const next = () => {
        if (gen !== pulseGen || mood !== 'match') return;
        if (mEnabled() && intensity > 0.04) {
          const ac = ensure();
          const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = 55;
          const g = ac.createGain();
          g.gain.value = mLevel() * (0.3 + intensity * 0.7);
          const t0 = ac.currentTime;
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
          osc.connect(g); g.connect(ac.destination);
          osc.start(t0); osc.stop(t0 + 0.4);
        }
        const interval = 1850 - intensity * 1050;
        pulseTimer = setTimeout(next, interval);
      };
      pulseTimer = setTimeout(next, 500);
    }

    return {
      // m: 'menu' | 'match' | null. A no-op if that mood is already
      // playing, so Screens.show() can call this on every screen switch
      // without restarting the pad each time the player tabs between
      // home views.
      start(m) {
        if (mood === m) return;
        if (padNodes) teardownPad(ensure());
        clearTimeout(bellTimer); clearTimeout(pulseTimer);
        mood = m;
        intensity = 0;
        if (!m || !mEnabled()) return;
        const ac = ensure();
        padNodes = buildPad(ac, mLevel() * (m === 'menu' ? 0.9 : 0.5));
        if (m === 'menu') scheduleBell();
        else schedulePulse();
      },
      stop() {
        mood = null;
        intensity = 0;
        clearTimeout(bellTimer); clearTimeout(pulseTimer);
        bellGen++; pulseGen++;
        if (padNodes) teardownPad(ensure());
      },
      // 0..1, how close this fight is -- see game.js's updateFeel
      setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); },
      intensity: () => intensity,   // read-only, for debugging/verification
      mood: () => mood,
      // settings changed mid-session (volume dragged, Music toggled off)
      // -- re-apply without waiting for the next screen switch
      refresh() {
        if (!mood) return;
        if (!mEnabled()) { if (padNodes) teardownPad(ensure()); return; }
        const ac = ensure();
        if (!padNodes) { padNodes = buildPad(ac, mLevel() * (mood === 'menu' ? 0.9 : 0.5)); return; }
        padNodes.gain.gain.cancelScheduledValues(ac.currentTime);
        padNodes.gain.gain.linearRampToValueAtTime(mLevel() * (mood === 'menu' ? 0.9 : 0.5), ac.currentTime + 0.3);
      },
    };
  })();

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
    /* The Funny Effects setting's one sound: a cartoon "boop-wheee" honk
       layered on top of the real kill sound, not instead of it. Never
       positional, like kill() — it only plays for the kill or death that
       actually involves the local player. */
    funny: () => { tone(300, 0.08, 'square', 900); setTimeout(() => tone(1200, 0.14, 'sine', 240), 60); },
    music: Music,
  };
})();
