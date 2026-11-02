// Entry point so `node --test tests/` works on Node 22, which treats a directory argument as a module path
// (it resolves tests/index.js). All real assertions live in physics.test.mjs.
import './physics.test.mjs';
