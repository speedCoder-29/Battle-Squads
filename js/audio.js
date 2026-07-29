/* ============================================================
   audio.js — tiny WebAudio SFX engine (no asset files needed).
   Generates blips/booms procedurally so the prototype has sound
   without shipping audio files. Respects settings volume/sfx.
   ============================================================ */
const SFX = (() => {
  let ctx = null;
  const ensure = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; };

  function enabled() {
    const s = DB.getSettings();
    return s.sfx && s.volume > 0;
  }
  function gainLevel() { return (DB.getSettings().volume / 100) * 0.35; }

  function tone(freq, dur, type = 'square', slideTo = null) {
    if (!enabled()) return;
    const ac = ensure();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
    g.gain.value = gainLevel();
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(g); g.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + dur);
  }
  function noise(dur, vol = 1) {
    if (!enabled()) return;
    const ac = ensure();
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ac.createBufferSource(); src.buffer = buf;
    const g = ac.createGain(); g.gain.value = gainLevel() * vol;
    src.connect(g); g.connect(ac.destination);
    src.start();
  }

  return {
    resume: () => { try { ensure().resume(); } catch {} },
    shoot: () => tone(420, 0.08, 'square', 180),
    hit:   () => tone(240, 0.06, 'sawtooth', 120),
    reload:() => { tone(300, 0.05, 'square'); setTimeout(() => tone(500, 0.06, 'square'), 90); },
    kill:  () => noise(0.25, 1.1),
    hurt:  () => tone(160, 0.15, 'sawtooth', 80),
    capture: () => { tone(500, 0.1); setTimeout(() => tone(700, 0.12), 100); },
    click: () => tone(600, 0.04, 'triangle'),
    win:   () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle'), i * 120)); },
    lose:  () => { [400, 320, 240].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sawtooth'), i * 160)); },
    reward:() => { [660, 880].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle'), i * 90)); },
  };
})();
