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
    // one blip per squad actually in the match (see TEAM_SETUP in game.js)
    const colors = ['#3d7bff', '#ff4b5c', '#4be08a', '#c46bff', '#ffa726', '#35e0ff'];
    const icons = ['🔵', '🔴', '🟢', '🟣', '🟠', '🔷'];
    const squad = Game.setupFor(mode);
    for (let i = 0; i < squad.teams; i++) {
      const blip = document.createElement('div');
      blip.className = 'squad-blip';
      blip.style.borderColor = colors[i % colors.length];
      blip.style.animationDelay = (i * 0.12) + 's';
      blip.textContent = icons[i % icons.length];
      squadsEl.appendChild(blip);
    }
    document.getElementById('found-mode').textContent +=
      ` · ${squad.teams} squads of ${squad.perTeam}`;
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
        /* Deploy behind the loading screen. Game.start builds a whole island
           on the main thread; run bare, it froze the menu and then cut into a
           match already in progress with nothing in between. */
        Loading.run('Deploying', [
          ['Generating the island', 0.25, () => {}],
          ['Placing structures and loot', 0.6, () => Game.start(mode)],
          ['Briefing the squads', 0.9, () => {}],
        ]);
      } else {
        document.getElementById('found-count').textContent = count;
        SFX.click();
      }
    }, 800);
  }

  /* A party has been launched by its leader: skip the fake queue and drop
     straight into the server's room, sharing the socket the lobby opened. */
  function startNetworked(socket, mode) {
    const overlay = document.getElementById('overlay-found');
    if (overlay) overlay.classList.remove('is-open');
    cancelQueue();
    Loading.run('Joining squad', [
      ['Connecting to the room', 0.4, () => {}],
      ['Building the island', 0.8, () => Game.startOnline(socket, mode)],
    ]);
  }

  function init() {
    btn().addEventListener('click', startQueue);
  }

  return { init, startNetworked };
})();
