/* ============================================================
   main.js — bootstrap: wire modules, animated bg particles,
   restore session, apply settings.
   ============================================================ */
(function () {
  // ----- animated background particles (used behind menus) -----
  const canvas = document.getElementById('bg-particles');
  const ctx = canvas.getContext('2d');
  let parts = [];
  function sizeBg() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const count = Math.min(70, Math.floor(window.innerWidth / 22));
    parts = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
      r: Math.random() * 2 + 0.5, a: Math.random() * 0.5 + 0.1,
    }));
  }
  function drawBg() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120,180,255,${p.a})`; ctx.fill();
    }
    requestAnimationFrame(drawBg);
  }
  sizeBg(); drawBg();
  window.addEventListener('resize', sizeBg);

  // ----- init modules -----
  Auth.init();
  Screens.init();
  Matchmaking.init();

  // ----- restore session -----
  const session = DB.getSession();
  if (session && DB.getProfile()) {
    Screens.enterHome();
  } else {
    DB.clearSession();
    Screens.show('auth');
  }
})();
