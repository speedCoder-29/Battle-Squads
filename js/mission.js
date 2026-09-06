/* ============================================================
   mission.js — the infiltration mode.

   Every other mode in this game starts with both sides knowing there is a
   fight. This one starts with nobody knowing you are there, and that single
   difference is what it is built around: the island is garrisoned rather than
   contested, the garrison is asleep, and the whole thing turns on how long you
   can keep it that way.

   The shape of a run:

     INSERTION   you are on the way in. The briefing names the job and shows
                 you the island; this is the only time you get to look at the
                 map before you are standing on it.
     INFILTRATE  ashore, unnoticed, working inward. The garrison thins outward
                 -- conscripts on the perimeter, the good ones in the middle --
                 so pressure rises as you close.
     OBJECTIVE   take the thing or kill the man.
     EXFIL       everyone now knows. Get to the boat.

   Two job types, because they want different things from you. Retrieving an
   asset is a round trip -- you carry it out, and carrying it is a cost.
   Killing a man is one-way: he is somewhere in the middle and he does not
   move until he has a reason to.

   The alert model is deliberately three-state and no more. Unaware, suspicious
   and hunting is enough to produce every behaviour worth having -- a body
   found, a shot heard, a search that gives up -- and a fourth state would be a
   number nobody can see on screen.
   ============================================================ */
const Mission = (() => {

  /* ---------- phases ---------- */
  const PHASE = {
    INSERTION: 'insertion',
    INFILTRATE: 'infiltrate',
    OBJECTIVE: 'objective',
    EXFIL: 'exfil',
    DONE: 'done',
  };

  /* ---------- the two jobs ---------- */
  const TYPES = {
    retrieve: {
      id: 'retrieve', name: 'Retrieval', icon: '📦',
      /* Named after what it is rather than after a codeword: "the plans" tells
         a player what they are looking for, "Operation Bluebird" does not. */
      assets: ['the prototype', 'the launch codes', 'the sample case',
        'the cipher machine', 'the flight recorder'],
      brief: (a) => `Recover ${a} from the compound and carry it to extraction.`,
      /* Carrying it slows you: the asset is the reason the run out is harder
         than the run in, and a retrieval that cost nothing to carry would just
         be an assassination with extra steps. */
      carrySpeed: 0.88,
    },
    assassinate: {
      id: 'assassinate', name: 'Decapitation', icon: '🎯',
      brief: (n) => `Eliminate ${n}. He does not leave the compound willingly.`,
      carrySpeed: 1,
    },
  };

  /* Names for the man you are sent to kill. Rank and surname, because a target
     with a first name is somebody's mate and a target with a codename is a
     cartoon. */
  const RANKS = ['Colonel', 'Major', 'Commandant', 'Brigadier', 'Captain'];
  const SURNAMES = ['Vance', 'Roth', 'Salko', 'Marek', 'Idris', 'Novak',
    'Halloran', 'Zeman', 'Oduya', 'Brandt'];

  /* ---------- alert states ---------- */
  const ALERT = { UNAWARE: 0, SUSPICIOUS: 1, HUNTING: 2 };

  /* How long a suspicious garrison stays interested before deciding it was
     the wind. Long enough that you cannot simply wait it out behind the
     nearest wall, short enough that one unlucky noise does not end the run. */
  const SUSPICION_SECS = 18;
  /* And how long the whole compound stays up once somebody has actually
     confirmed you exist. This one does not decay on its own -- only leaving
     the area does that. */
  const HUNT_SECS = 40;

  /* How far a body is noticed from. A corpse in the open is the single most
     reliable way to lose a run, which is the intended lesson: shoot the man
     who is alone, and move him if you can't. */
  const CORPSE_SIGHT = 340;
  /* And how far the shout carries when one is found. Deliberately further than
     a gunshot: a man yelling that he has found a body is trying to be heard. */
  const BACKUP_CALL = 1500;

  /* ---------- difficulty by depth ----------
     The garrison is graded from the beach inward. The numbers are bot levels
     as js/botai.js understands them, and the curve is gentle at the edges and
     steep in the last few hundred pixels, so the compound feels defended
     rather than the island feeling uniformly hard. */
  function levelAt(dist, coreR) {
    const t = Math.max(0, Math.min(1, 1 - dist / Math.max(1, coreR)));
    // 3 on the perimeter, 9 in the objective building
    return Math.round(3 + t * t * 6);
  }

  /* ---------- rolling a job ----------
     Deterministic from the seed, like everything else the world is built
     from, so a shared seed is a shared mission. */
  function roll(rand) {
    const type = rand() < 0.5 ? TYPES.retrieve : TYPES.assassinate;
    const asset = type.assets
      ? type.assets[Math.floor(rand() * type.assets.length)] : null;
    const target = type.id === 'assassinate'
      ? RANKS[Math.floor(rand() * RANKS.length)] + ' '
        + SURNAMES[Math.floor(rand() * SURNAMES.length)]
      : null;
    return {
      type: type.id,
      name: type.name,
      icon: type.icon,
      asset, target,
      carrySpeed: type.carrySpeed,
      brief: type.id === 'retrieve' ? type.brief(asset) : type.brief(target),
      /* Ten minutes. Long enough to move carefully -- which is the whole
         mode -- and short enough that you cannot clear the island one man at
         a time, which would make the alert system pointless. */
      seconds: 600,
    };
  }

  /* One line of status for the HUD, phrased as an order rather than as a
     state name. "Infiltrate the compound" is a thing to do; "INFILTRATE" is a
     label on a machine. */
  function orders(m, phase, held) {
    if (!m) return '';
    if (phase === PHASE.EXFIL) {
      return m.type === 'retrieve'
        ? 'Carry it to the extraction point'
        : 'Get to the extraction point';
    }
    if (m.type === 'retrieve') {
      return held ? 'Asset secured — fall back to extraction'
        : `Find ${m.asset} inside the compound`;
    }
    return `Find and eliminate ${m.target}`;
  }

  return { PHASE, TYPES, ALERT, roll, orders, levelAt,
    SUSPICION_SECS, HUNT_SECS, CORPSE_SIGHT, BACKUP_CALL };
})();

/* the shared sim requires this on the server, where there are no globals */
if (typeof module === 'object' && module.exports) module.exports = Mission;
