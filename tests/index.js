// Entry point so `node --test tests/` works on Node 22, which treats a directory argument as a module path
// (it resolves tests/index.js). All real assertions live in the *.test.mjs files.
import './physics.test.mjs';
import './announcer.test.mjs';
import './modes.test.mjs';
import './leaderboard.test.mjs';
import './techniques.test.mjs';
