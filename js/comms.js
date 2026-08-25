/* ============================================================
   comms.js — pings and emotes.

   A squad shooter without voice needs a way to say "enemy over
   there" in under a second. Two radial wheels do it:

     Z (hold)  — ping wheel. Where you point is where the ping
                 lands, and only your team sees it.
     X (hold)  — emote wheel. Everyone sees it, over your head.
     Middle-click — a quick ping that reads what you pointed at:
                 an enemy, some loot, or just "going here".

   The catalogues live here, the drawing lives here, and the
   wheel is a pure function of (mouse, open-since) — game.js
   only has to say when a wheel opened and what came out of it.
   Marks travel over the wire as an id and a point, so a ping is
   four numbers rather than a picture.
   ============================================================ */
const Comms = (() => {

  /* ---------- what you can say ---------- */
  /* `auto` marks the ones the quick-ping picks from. */
  const PINGS = [
    { id: 'enemy',  name: 'Enemy',     color: '#ff5a5f', glyph: 'alert',  say: 'Enemy spotted' },
    { id: 'attack', name: 'Attack',    color: '#ff8bd4', glyph: 'blades', say: 'Attack here' },
    { id: 'loot',   name: 'Loot',      color: '#ffd257', glyph: 'gem',    say: 'Loot here' },
    { id: 'going',  name: 'On my way', color: '#35e0ff', glyph: 'arrow',  say: 'On my way' },
    { id: 'defend', name: 'Defend',    color: '#7be08a', glyph: 'shield', say: 'Defend here' },
    { id: 'help',   name: 'Need help', color: '#ffffff', glyph: 'cross',  say: 'Needs help' },
    { id: 'danger', name: 'Danger',    color: '#ff9f43', glyph: 'skull',  say: 'Danger' },
    { id: 'watch',  name: 'Watch',     color: '#b79bff', glyph: 'eye',    say: 'Watch this way' },
  ];
  const EMOTES = [
    { id: 'gg',     name: 'GG',       color: '#7be08a', face: 'grin' },
    { id: 'yes',    name: 'Yes',      color: '#4be08a', face: 'thumb' },
    { id: 'no',     name: 'No',       color: '#ff5a5f', face: 'cross' },
    { id: 'laugh',  name: 'Laugh',    color: '#ffd257', face: 'laugh' },
    { id: 'sorry',  name: 'Sorry',    color: '#9fb4d8', face: 'sad' },
    { id: 'thanks', name: 'Thanks',   color: '#ff8bd4', face: 'heart' },
    { id: 'salute', name: 'Salute',   color: '#35e0ff', face: 'salute' },
    { id: 'taunt',  name: 'Taunt',    color: '#ff9f43', face: 'tongue' },
  ];

  const pingById = Object.fromEntries(PINGS.map(p => [p.id, p]));
  const emoteById = Object.fromEntries(EMOTES.map(e => [e.id, e]));

  const MARK_LIFE = 8;          // seconds a ping stays on the map
  const EMOTE_LIFE = 2.6;       // seconds a bubble stays over a head
  const COOLDOWN = 0.55;        // per player, so nobody can spam the map

  /* ---------- the wheel ----------
     Sectors start at 12 o'clock and run clockwise. Which one you are on is
     read from the angle out of the wheel's centre; inside the dead zone you
     are on none of them, so opening the wheel and letting go cancels. */
  const DEAD_ZONE = 26;
  const RADIUS = 108;

  function pick(items, cx, cy, mx, my) {
    const dx = mx - cx, dy = my - cy;
    if (Math.hypot(dx, dy) < DEAD_ZONE) return -1;
    const step = (Math.PI * 2) / items.length;
    let a = Math.atan2(dy, dx) + Math.PI / 2 + step / 2;    // 0 = straight up
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(a / step) % items.length;
  }

  function drawWheel(ctx, items, cx, cy, hot, title) {
    const step = (Math.PI * 2) / items.length;
    ctx.save();
    ctx.fillStyle = 'rgba(10,16,30,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, RADIUS + 34, 0, Math.PI * 2); ctx.fill();

    items.forEach((it, i) => {
      const a0 = -Math.PI / 2 + (i - 0.5) * step, a1 = a0 + step;
      const on = i === hot;
      ctx.beginPath();
      ctx.arc(cx, cy, RADIUS + 30, a0 + 0.02, a1 - 0.02);
      ctx.arc(cx, cy, DEAD_ZONE + 6, a1 - 0.02, a0 + 0.02, true);
      ctx.closePath();
      ctx.fillStyle = on ? hexA(it.color, 0.34) : 'rgba(26,38,66,0.72)';
      ctx.fill();
      ctx.strokeStyle = on ? it.color : 'rgba(175,210,255,0.35)';
      ctx.lineWidth = on ? 2.5 : 1;
      ctx.stroke();

      const mid = a0 + step / 2;
      const ix = cx + Math.cos(mid) * (RADIUS - 22), iy = cy + Math.sin(mid) * (RADIUS - 22);
      drawIcon(ctx, it, ix, iy, on ? 17 : 14);
      ctx.fillStyle = on ? '#fff' : 'rgba(220,232,255,0.72)';
      ctx.font = `${on ? 'bold ' : ''}12px Outfit, Segoe UI, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.name, cx + Math.cos(mid) * (RADIUS + 12), cy + Math.sin(mid) * (RADIUS + 12));
    });

    ctx.fillStyle = 'rgba(220,232,255,0.85)';
    ctx.font = 'bold 11px Outfit, Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(title, cx, cy);
    ctx.restore();
  }

  /* ---------- icons ----------
     Vectors, like the rest of the world art — no font or image has to load
     for a ping to be readable. */
  function drawIcon(ctx, it, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = it.color; ctx.fillStyle = it.color;
    ctx.lineWidth = Math.max(2, r * 0.16); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const g = it.glyph || it.face;
    if (g === 'alert') {
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r * 0.25); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, r * 0.72, r * 0.16, 0, Math.PI * 2); ctx.fill();
    } else if (g === 'blades') {
      ctx.beginPath(); ctx.moveTo(-r * 0.8, -r * 0.8); ctx.lineTo(r * 0.8, r * 0.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.8, -r * 0.8); ctx.lineTo(-r * 0.8, r * 0.8); ctx.stroke();
    } else if (g === 'gem') {
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.85, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.85, 0);
      ctx.closePath(); ctx.stroke();
    } else if (g === 'arrow') {
      ctx.beginPath(); ctx.moveTo(0, r * 0.9); ctx.lineTo(0, -r * 0.6); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.25); ctx.lineTo(0, -r); ctx.lineTo(r * 0.55, -r * 0.25);
      ctx.stroke();
    } else if (g === 'shield') {
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, -r * 0.5); ctx.lineTo(r * 0.8, r * 0.2);
      ctx.quadraticCurveTo(r * 0.8, r, 0, r); ctx.quadraticCurveTo(-r * 0.8, r, -r * 0.8, r * 0.2);
      ctx.lineTo(-r * 0.8, -r * 0.5); ctx.closePath(); ctx.stroke();
    } else if (g === 'cross') {
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
    } else if (g === 'skull') {
      ctx.beginPath(); ctx.arc(0, -r * 0.15, r * 0.72, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.72, -r * 0.15); ctx.lineTo(-r * 0.72, r * 0.35);
      ctx.lineTo(r * 0.72, r * 0.35); ctx.lineTo(r * 0.72, -r * 0.15); ctx.stroke();
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.15, r * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.15, r * 0.16, 0, Math.PI * 2); ctx.fill();
    } else if (g === 'eye') {
      ctx.beginPath();
      ctx.moveTo(-r, 0); ctx.quadraticCurveTo(0, -r * 0.95, r, 0);
      ctx.quadraticCurveTo(0, r * 0.95, -r, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2); ctx.fill();
    } else {
      drawFace(ctx, g, r);
    }
    ctx.restore();
  }

  /* emote faces: one circle and a mouth, mostly */
  function drawFace(ctx, kind, r) {
    if (kind === 'thumb') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.15, r); ctx.lineTo(-r * 0.15, -r * 0.15);
      ctx.lineTo(r * 0.25, -r); ctx.lineTo(r * 0.5, -r * 0.75);
      ctx.lineTo(r * 0.35, -r * 0.15); ctx.lineTo(r * 0.9, -r * 0.15);
      ctx.lineTo(r * 0.7, r); ctx.closePath(); ctx.stroke();
      return;
    }
    if (kind === 'heart') {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.85);
      ctx.bezierCurveTo(-r * 1.3, -r * 0.1, -r * 0.55, -r, 0, -r * 0.35);
      ctx.bezierCurveTo(r * 0.55, -r, r * 1.3, -r * 0.1, 0, r * 0.85);
      ctx.stroke();
      return;
    }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2); ctx.stroke();
    const eye = (ex) => { ctx.beginPath(); ctx.arc(ex, -r * 0.25, r * 0.12, 0, Math.PI * 2); ctx.fill(); };
    if (kind === 'salute') {
      eye(-r * 0.32); eye(r * 0.32);
      ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 0.62); ctx.lineTo(r * 0.9, -r * 0.62); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, r * 0.1, r * 0.42, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      return;
    }
    eye(-r * 0.32); eye(r * 0.32);
    if (kind === 'grin' || kind === 'laugh') {
      ctx.beginPath(); ctx.arc(0, r * 0.05, r * 0.5, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
      if (kind === 'laugh') {   // squeezed-shut eyes over the open mouth
        ctx.clearRect(-r * 0.5, -r * 0.45, r, r * 0.35);
        ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.18, r * 0.2, Math.PI, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.18, r * 0.2, Math.PI, 0); ctx.stroke();
      }
    } else if (kind === 'sad') {
      ctx.beginPath(); ctx.arc(0, r * 0.75, r * 0.5, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
    } else if (kind === 'tongue') {
      ctx.beginPath(); ctx.moveTo(-r * 0.4, r * 0.3); ctx.lineTo(r * 0.4, r * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 0.12, r * 0.42, r * 0.22, 0, Math.PI); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(-r * 0.4, r * 0.35); ctx.lineTo(r * 0.4, r * 0.35); ctx.stroke();
    }
  }

  /* ---------- a ping on the field ---------- */
  function drawMark(ctx, m, now) {
    const def = pingById[m.kind] || PINGS[0];
    const age = MARK_LIFE - m.life;
    const fade = Math.min(1, m.life / 1.5);
    const pop = Math.min(1, age * 5);                       // it lands with a snap
    const pulse = 0.5 + 0.5 * Math.sin(now * 4.5);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(m.x, m.y);
    ctx.scale(pop, pop);
    // ground ring
    ctx.beginPath(); ctx.arc(0, 0, 22 + pulse * 6, 0, Math.PI * 2);
    ctx.strokeStyle = hexA(def.color, 0.5); ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = hexA(def.color, 0.25); ctx.fill();
    // the pin, floating a little
    const lift = -46 - pulse * 4;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, lift + 14);
    ctx.strokeStyle = hexA(def.color, 0.6); ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, lift, 15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,20,38,0.85)'; ctx.fill();
    ctx.strokeStyle = def.color; ctx.lineWidth = 2; ctx.stroke();
    drawIcon(ctx, def, 0, lift, 8);
    if (m.by) {
      ctx.fillStyle = hexA(def.color, 0.9);
      ctx.font = 'bold 11px Outfit, Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.by, 0, lift - 24);
    }
    ctx.restore();
  }

  /* An off-screen ping still has to be findable, so it becomes an arrow on
     the edge of the screen pointing at where it is. */
  function drawOffscreenMark(ctx, m, sx, sy, W, H) {
    const def = pingById[m.kind] || PINGS[0];
    const pad = 46;
    const cx = W / 2, cy = H / 2;
    const dx = sx - cx, dy = sy - cy;
    const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad) / Math.abs(dy || 1e-6));
    const ex = cx + dx * k, ey = cy + dy * k;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.globalAlpha = Math.min(1, m.life / 1.5) * 0.9;
    ctx.translate(ex, ey);
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,20,38,0.8)'; ctx.fill();
    ctx.strokeStyle = def.color; ctx.lineWidth = 2; ctx.stroke();
    drawIcon(ctx, def, 0, 0, 8);
    ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(17, 0); ctx.lineTo(26, -6); ctx.lineTo(26, 6); ctx.closePath();
    ctx.fillStyle = def.color; ctx.fill();
    ctx.restore();
  }

  /* ---------- an emote over someone's head ---------- */
  function drawEmote(ctx, e, x, y) {
    const def = emoteById[e.id] || EMOTES[0];
    const age = EMOTE_LIFE - e.life;
    const pop = Math.min(1, age * 6);
    const rise = Math.min(10, age * 30);
    ctx.save();
    ctx.globalAlpha = Math.min(1, e.life * 2);
    ctx.translate(x, y - rise);
    ctx.scale(pop, pop);
    ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,20,38,0.85)'; ctx.fill();
    ctx.strokeStyle = def.color; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5, 14); ctx.lineTo(0, 22); ctx.lineTo(5, 14); ctx.closePath();
    ctx.fillStyle = 'rgba(12,20,38,0.85)'; ctx.fill();
    drawIcon(ctx, def, 0, 0, 9);
    ctx.restore();
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  return {
    PINGS, EMOTES, pingById, emoteById,
    MARK_LIFE, EMOTE_LIFE, COOLDOWN, RADIUS, DEAD_ZONE,
    pick, drawWheel, drawIcon, drawMark, drawOffscreenMark, drawEmote,
  };
})();
