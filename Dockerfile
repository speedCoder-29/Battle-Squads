# Battle Squads authoritative game server.
#
# The whole repo is copied, not just server/, and that is deliberate: the
# server loads the game's own js/weapons.js, js/combat.js, js/classes.js and
# js/items.js through js/_shared.js, and generates the map by running
# js/game.js itself in a sandbox. There is exactly one copy of the rules and
# this is how it stays that way — a Dockerfile that copied only server/ would
# build fine and then crash on the first require.
FROM node:22-alpine

WORKDIR /app

# dependencies first, so a code change doesn't reinstall them
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# the simulation and the data tables it shares with the browser
COPY js ./js
COPY server ./server

WORKDIR /app/server

# whatever the host assigns; the server already reads process.env.PORT
ENV PORT=8080
EXPOSE 8080

# /health answers with room and player counts
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "server.js"]
