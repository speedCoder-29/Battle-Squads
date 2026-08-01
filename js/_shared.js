/* ============================================================
   _shared.js — loads the browser data modules under Node.

   weapons.js, combat.js, classes.js and items.js are plain IIFEs
   that assign a global. That is exactly what a browser wants and
   exactly what CommonJS does not, so this evaluates them in a
   sandbox and re-exports the results.

   It exists so js/roomsim.js can `require('./_shared')` on the
   server and read the same tables the browser reads, rather than
   anyone keeping a second copy of the numbers.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = ['weapons.js', 'combat.js', 'classes.js', 'items.js'];

const sandbox = { console, Math, JSON, Date };
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}

// top-level `const` in a vm script is script-scoped rather than a property of
// the context, so reach the modules by evaluating inside it
module.exports = vm.runInContext('({ Weapons, Combat, Classes, Items })', ctx);
