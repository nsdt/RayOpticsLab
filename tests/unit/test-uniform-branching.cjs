const assert = require('node:assert/strict'),
  O = require('../../app/optics.js');
for (const f of ['analytical', 'schur', 'homogeneous', 'branching', 'polarization'])
  require('../../app/' + f + '.js');
const B = O.branching,
  F = O.polarization;
const base = {
  ...O.defaults,
  shape: 'cube',
  solver: 'auto',
  transport: 'polarized',
  maxInterfaces: 4,
  branchPolicy: 'planes',
  branchPlanes: '-.4,0,.4',
  branchDepth: 3,
  background: 'uv',
  tilt: 35,
  azimuth: 25,
};
const uniform = [
  { material: 'isotropic' },
  { material: 'uniaxial' },
  { material: 'biaxial' },
  ...['common', 'quadratic', 'axial2013Uniaxial'].map((material) => ({ material, gradient: 0 })),
  { material: 'heliconical', twist: 0 },
  { material: 'heliconical', tilt: 0 },
];
for (const item of uniform) {
  const c = { ...base, ...item };
  assert.equal(B.homogeneous(c), true);
  assert.equal(B.supported(c), false);
  assert.deepEqual(B.settings(c).planes, []);
  for (const mode of [0, 1]) {
    const a = B.trace([0.1, 0.07, 4], O.unit([0.01, 0.02, -1]), c, mode),
      b = B.trace([0.1, 0.07, 4], O.unit([0.01, 0.02, -1]), { ...c, branchPolicy: 'off' }, mode);
    assert.equal(a.status, 'ok', JSON.stringify(item));
    assert.equal(a.branches, 0);
    assert.equal(a.leaves, 1);
    assert.deepEqual(a.color, b.color);
  }
  const a = F.trace([0.1, 0.07, 4], O.unit([0.01, 0.02, -1]), c),
    b = F.trace([0.1, 0.07, 4], O.unit([0.01, 0.02, -1]), { ...c, branchPolicy: 'off' });
  assert.equal(a.status, 'ok', a.message);
  assert.equal(a.internalBranches, 0);
  assert.equal(a.maxInternalDepth, 0);
  assert.deepEqual(a.color, b.color);
  assert.equal(a.weightSum, b.weightSum);
  assert.ok(Math.abs(a.accounted - 1) < 1e-8);
}
for (const material of ['common', 'quadratic', 'heliconical'])
  assert.equal(B.supported({ ...base, material, no: 1.5, ne: 1.5 }), false);
for (const material of ['common', 'quadratic', 'heliconical', 'axial2013Uniaxial'])
  assert.equal(B.supported({ ...base, material }), true);
console.log(
  'PASS 8 homogeneous cases: artificial branches ignored by both renderers; identical colors and energy, effective homogeneous limits and nonuniform eligibility',
);
