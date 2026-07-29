/* ============================================================
   matchmaking.js — queue flow (simulated for the prototype).
   In a real build this would talk to a matchmaking server /
   websocket. Here it fakes a short search, shows a "match found"
   overlay, then boots the local game vs bots.
   ============================================================ */
const Matchmaking = (() => {
  let queuing = false;
  let searchTimer = null;
  let elapsed = 0;

  const btn = () => document.getElementById('btn-queue');

  function setStatus(txt) { document.getElementById('queue-status').textContent = txt; }

  function startQueue() {
    if (queuing) { cancelQueue(); return; }
    SFX.resume(); SFX.click();
    queuing = true;
    elapsed = 0;
    const b = btn();
    b.classList.add('is-queuing');
    b.querySelector('.btn--play__label').textContent = 'CANCEL';
    setStatus('Searching for players…');

    // fake search: 2–5 seconds
    const findTime = 2 + Math.random() * 3;
    searchTimer = setInterval(() => {
      elapsed += 0.1;
      document.getElementById('queue-timer').textContent = elapsed.toFixed(1) + 's';
      if (elapsed >= findTime) { clearInterval(searchTimer); matchFound(); }
    }, 100);
  }

  function cancelQueue() {
    queuing = false;
    clearInterval(searchTimer);
    const b = btn();
    b.classList.remove('is-queuing');
    b.querySelector('.btn--play__label').textContent = 'DEPLOY';
    document.getElementById('queue-timer').textContent = '';
    setStatus('Ready to deploy');
  }

  function matchFound() {
    queuing = false;
    const mode = Screens.getSelectedMode();
    const overlay = document.getElementById('overlay-found');
    document.getElementById('found-mode').textContent = mode === 'domination' ? 'Domination' : 'Elimination';
    // draw squad blips
    const squadsEl = document.getElementById('found-squads');
    squadsEl.innerHTML = '';
    const colors = ['var(--blue)', 'var(--red)', 'var(--green)'];
    const icons = ['🔵', '🔴', '🟢'];
    const nSquads = mode === 'domination' ? 3 : 4;
    for (let i = 0; i < nSquads; i++) {
      const blip = document.createElement('div');
      blip.className = 'squad-blip';
      blip.style.borderColor = colors[i % 3];
      blip.style.animationDelay = (i * 0.12) + 's';
      blip.textContent = icons[i % 3];
      squadsEl.appendChild(blip);
    }
    overlay.classList.add('is-open');
    SFX.capture();

    // countdown 3..1 then launch
    let count = 3;
    document.getElementById('found-count').textContent = count;
    const cd = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(cd);
        overlay.classList.remove('is-open');
        cancelQueue();
        Game.start(mode);
      } else {
        document.getElementById('found-count').textContent = count;
        SFX.click();
      }
    }, 800);
  }

  function init() {
    btn().addEventListener('click', startQueue);
  }

  return { init };
})();
