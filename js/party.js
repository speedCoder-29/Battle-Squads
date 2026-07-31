/* ============================================================
   party.js — squad up and play together.

   A party is a lobby with a five-character code. Create one, share
   the code (or the link), and everyone who joins queues together and
   lands on the same team in the same match.

   It needs the multiplayer server: parties are a server-side concept
   so that two people on different machines actually meet. With no
   server configured the panel says so instead of pretending.
   ============================================================ */
const Party = (() => {
  let ws = null;
  let state = { code: null, members: [], mode: 'domination', leader: null };
  let connecting = false;
  const listeners = [];

  const el = (id) => document.getElementById(id);
  const on = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach(fn => fn(state));

  /* ---------- connection ----------
     The party lobby shares the game's server. We keep a socket open only
     while the panel is in use, and hand it to the match on launch. */
  function connect() {
    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === 1) return resolve(ws);
      const url = Net.serverUrl();
      if (!url) return reject(new Error('No multiplayer server configured — see server/README.md'));
      if (connecting) return reject(new Error('Still connecting…'));
      connecting = true;
      let sock;
      try { sock = new WebSocket(url); }
      catch (e) { connecting = false; return reject(new Error('Bad server URL')); }

      const timeout = setTimeout(() => {
        connecting = false;
        try { sock.close(); } catch (e) {}
        reject(new Error('Server did not respond'));
      }, 6000);

      sock.onopen = () => { clearTimeout(timeout); connecting = false; ws = sock; resolve(sock); };
      sock.onmessage = (ev) => handle(ev.data);
      sock.onerror = () => { clearTimeout(timeout); connecting = false; reject(new Error('Could not reach the server')); };
      sock.onclose = () => {
        ws = null;
        if (state.code) { state = { code: null, members: [] }; emit(); showError('Lost the connection to the server.'); }
      };
    });
  }

  function handle(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.t === 'party') {
      state = { code: msg.code, members: msg.members || [], mode: msg.mode, leader: msg.leader };
      showError('');
      emit();
    } else if (msg.t === 'partyError') {
      showError(msg.error);
    } else if (msg.t === 'partyLaunch') {
      // the leader hit deploy: everyone drops into the same room
      showError('');
      Matchmaking.startNetworked(ws, msg.mode);
    }
  }

  const send = (payload) => {
    if (!ws || ws.readyState !== 1) return;
    const p = DB.getProfile() || {};
    ws.send(JSON.stringify({
      t: 'party', name: p.username, weapon: p.weapon,
      skin: p.weaponSkins ? p.weaponSkins[p.weapon] : 'default',
      ...payload,
    }));
  };

  /* ---------- actions ---------- */
  async function create() {
    try { await connect(); send({ do: 'create' }); }
    catch (e) { showError(e.message); }
  }
  async function join(code) {
    const c = String(code || '').toUpperCase().trim();
    if (c.length < 4) return showError('Enter the 5-character code.');
    try { await connect(); send({ do: 'join', code: c }); }
    catch (e) { showError(e.message); }
  }
  function leave() { send({ do: 'leave' }); state = { code: null, members: [] }; emit(); }
  function start() { send({ do: 'start' }); }
  function setMode(mode) { send({ do: 'mode', mode }); }

  const inviteLink = () => {
    if (!state.code) return '';
    const base = location.origin + location.pathname;
    const server = Net.serverUrl();
    return `${base}?party=${state.code}${server ? '&server=' + encodeURIComponent(server) : ''}`;
  };

  function showError(msg) {
    const e = el('party-error');
    if (e) e.textContent = msg || '';
  }

  /* ---------- rendering ---------- */
  function render() {
    const idle = el('party-idle'), active = el('party-active');
    if (!idle || !active) return;
    const inParty = !!state.code;
    idle.hidden = inParty;
    active.hidden = !inParty;

    const hint = el('party-hint');
    if (hint) {
      hint.textContent = Net.isConfigured()
        ? (inParty ? `${state.members.length}/4 in your squad` : 'Play with friends online')
        : 'Needs a multiplayer server — see server/README.md';
    }
    if (!inParty) return;

    el('party-code').textContent = state.code;
    const list = el('party-list');
    list.innerHTML = '';
    const me = (DB.getProfile() || {}).username;
    state.members.forEach(m => {
      const li = document.createElement('li');
      li.className = 'party__member' + (m.name === me ? ' is-you' : '');
      li.innerHTML = `
        <span class="party__dot"></span>
        <span class="party__name">${m.name}${m.name === me ? ' (you)' : ''}</span>
        ${m.leader ? '<span class="party__tag">LEADER</span>' : ''}`;
      list.appendChild(li);
    });
    // only the leader can deploy the squad
    const amLeader = state.leader === me;
    const startBtn = el('btn-party-start');
    startBtn.disabled = !amLeader;
    startBtn.textContent = amLeader ? 'Deploy Squad' : 'Waiting for leader…';
  }

  function init() {
    const bind = (id, fn) => { const b = el(id); if (b) b.addEventListener('click', fn); };
    bind('btn-party-create', () => { SFX.click(); create(); });
    bind('btn-party-join', () => { SFX.click(); join(el('party-code-in').value); });
    bind('btn-party-leave', () => { SFX.click(); leave(); });
    bind('btn-party-start', () => { SFX.click(); start(); });
    bind('btn-party-copy', () => {
      const link = inviteLink();
      if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
      Toast.show('Invite link copied');
    });
    const input = el('party-code-in');
    if (input) {
      input.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') join(e.target.value); });
    }
    on(render);
    render();

    // ?party=CODE in the URL joins straight away
    try {
      const code = new URLSearchParams(location.search).get('party');
      if (code) join(code);
    } catch (e) { /* no location in a test harness */ }
  }

  return {
    init, create, join, leave, start, setMode, render, on,
    inviteLink,
    get state() { return state; },
    get socket() { return ws; },
  };
})();
