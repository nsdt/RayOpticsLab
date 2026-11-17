const assert = require('node:assert/strict'),
  O = require('../../app/optics.js');
require('../../app/analytical.js');
require('../../app/schur.js');
require('../../app/approximate.js');
require('../../app/homogeneous.js');
require('../../app/branching.js');
const c = {
    ...O.defaults,
    material: 'heliconical',
    tilt: 35,
    azimuth: 25,
    shape: 'cube',
    solver: 'auto',
    branchPolicy: 'distributed',
    branchDepth: 3,
    branchStart: -1,
    branchEnd: 1,
    branchCount: 5,
    branchDebug: true,
  },
  o = [0, 0, -4],
  d = [0, 0, 1];
for (let depth = 0; depth <= 6; depth++) {
  let r = O.branching.trace(o, d, { ...c, branchDepth: depth }, 0),
    expected = 2 ** Math.min(depth, 5);
  assert.equal(r.leaves, expected);
  assert.equal(r.branches, expected - 1);
  assert.equal(r.weightSum, 1);
  assert.equal(r.maxDepth, Math.min(depth, 5));
  assert.equal(r.status, 'ok');
  if (depth) assert.ok(r.leafRecords.every((l) => l.weight === 1 / expected));
  else assert.deepEqual(r.color, O.trace(o, d, c, 0).color);
}
let sparse = O.branching.trace(
  o,
  d,
  { ...c, branchPolicy: 'planes', branchPlanes: '0', branchDepth: 6 },
  0,
);
assert.equal(sparse.branches, 1);
assert.equal(sparse.leaves, 2);
assert.ok(sparse.events.every((e) => Math.abs(e.position[2]) < 1e-8));
let reverse = O.branching.trace([0, 0, 4], [0, 0, -1], c, 0);
assert.equal(reverse.leaves, 8);
assert.equal(reverse.weightSum, 1);
assert.equal(reverse.maxDepth, 3);
let fine = O.branching.trace(o, d, { ...c, step: 0.01 }, 0),
  coarse = O.branching.trace(o, d, { ...c, step: 0.05 }, 0);
assert.equal(fine.events.length, coarse.events.length);
for (let i = 0; i < fine.events.length; i++)
  assert.ok(Math.abs(fine.events[i].position[2] - coarse.events[i].position[2]) < 1e-8);
for (let material of ['common', 'quadratic', 'heliconical']) {
  let r = O.branching.trace(o, d, { ...c, material, background: 'uv' }, 0);
  assert.equal(r.status, 'ok');
  assert.equal(r.weightSum, 1);
  assert.equal(r.leaves, 8);
  assert.ok(r.drift < 1e-6);
}
for (let material of ['isotropic', 'hyperbolic', 'shear', 'eng2013'])
  assert.equal(O.branching.trace(o, d, { ...c, material }, 1).branches, 0);
assert.throws(() => O.branching.settings({ ...c, branchDepth: 7 }));
assert.throws(() => O.branching.settings({ ...c, branchPlanes: 'bad', branchPolicy: 'planes' }));
assert.throws(() => O.branching.settings({ ...c, branchStart: 1, branchEnd: -1 }));
console.log(
  'PASS: depth 0–6, weight conservation, exact leaf counts, sparse/distributed planes, reverse rays, step-independent events, all supported media, unsupported exclusion, invalid settings.',
);
// Hidden settings from the other placement mode must not change or block this one.
assert.deepEqual(
  O.branching.settings({
    ...c,
    branchPolicy: 'planes',
    branchPlanes: '0',
    branchStart: 2,
    branchEnd: 1,
    branchCount: -1,
  }).planes,
  [0],
);
assert.equal(
  O.branching.settings({ ...c, branchPolicy: 'distributed', branchPlanes: 'invalid' }).planes
    .length,
  5,
);
assert.deepEqual(
  O.branching.settings({ ...c, branchPolicy: 'off', branchStart: 2, branchEnd: 1 }).planes,
  [],
);
console.log('PASS: inactive placement inputs are ignored.');
