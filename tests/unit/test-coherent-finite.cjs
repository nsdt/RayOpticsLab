const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  O = require('../../app/optics.js');
for (const f of [
  'polynomial',
  'analytical',
  'schur',
  'branching',
  'polarization',
  'layered',
  'modal',
  'coherent',
  'coherent-general',
  'coherent-interface',
  'coherent-finite',
])
  require('../../app/' + f + '.js');
const F = O.polarization,
  K = F.coherentFinite,
  out = path.join(__dirname, '../../test-results/unit', 'finite-phase-20260917');
fs.mkdirSync(out, { recursive: true });
const base = {
  ...O.defaults,
  solver: 'auto',
  transport: 'polarized',
  transportView: 'all',
  branchModel: 'coherent',
  coherentInterface: 'finite-resolved',
  branchPolicy: 'overlap',
  branchDepth: 3,
  material: 'heliconical',
  shape: 'sphere',
  no: 1.658,
  ne: 1.486,
  tilt: 55,
  azimuth: 17,
  twist: 0.7,
  gradient: 0.12,
  maxInterfaces: 4,
  minContribution: 1e-5,
  lengthUnitUm: 5,
  beamRadiusUm: 20,
  phaseTolerance: 1e-7,
  background: 'white',
  projection: 'ortho',
  yaw: 0,
  pitch: 0,
};
const near = (a, b, t = 1e-7) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}, tolerance ${t}`);
function valid(r) {
  assert.equal(r.status, 'ok', r.message);
  near(r.accounted, 1, 1e-7);
  assert.ok(r.fluxError < 1e-7);
  assert.ok(r.geometryResidual < 2e-7);
  r.color.forEach((v) => near(F.decode(v), r.weightSum, 1e-7));
}
const rows = [];
for (const material of F.coherentGeneral.models)
  for (const shape of K.shapes) {
    let segments = 0,
      fallback = 0,
      reentries = 0,
      maxResidual = 0,
      errors = [];
    for (const sign of [-1, 1])
      for (const [x, y] of [
        [0, 0],
        [0.21, 0.09],
        [-0.21, -0.09],
        [0.72, 0],
        [0.93, 0.08],
      ]) {
        const c = { ...base, material, shape, backgroundZ: sign * 3 },
          r = F.trace([x, y, -4 * sign], [0, 0, sign], c);
        valid(r);
        segments += r.coherentSegments;
        fallback += r.phaseAdiabaticSegments;
        reentries += r.phaseReentries;
        maxResidual = Math.max(maxResidual, Math.abs(r.accounted - 1));
      }
    rows.push({ material, shape, segments, fallback, reentries, maxResidual });
    console.log(rows.at(-1));
  }
// Independent homogeneous intersections, using a straight analytic interior hit.
for (const shape of K.shapes)
  for (const mode of [0, 1]) {
    const c = { ...base, shape, material: 'common', gradient: 0 },
      x = shape === 'torus' ? [0.72, 0, 0] : [0.1, 0.05, 0.1],
      p = O.boundary(x, [0.12, 0.08, 0], [0, 0, 1], c, mode, false),
      d = O.unit(O.velocity(x, p, c, mode)),
      expected = F.interiorHit(x, d, shape),
      got = K.travel([...x, ...p], mode, c);
    expected.forEach((v, i) => near(v, got.state[i], 2e-8));
    near(O.sdf(got.state.slice(0, 3), shape), 0, 1e-8);
  }
// Uniform limit matches the established incoherent eigenray tracer in all shapes.
const limits = [];
for (const shape of K.shapes) {
  const c = {
      ...base,
      shape,
      material: 'common',
      gradient: 0,
      background: 'uv',
      branchDebug: true,
      maxInterfaces: 6,
    },
    o = [0.21, 0.07, 4],
    d = O.unit([0.025, -0.015, -1]),
    a = F.trace(o, d, c),
    b = F.trace(o, d, { ...c, branchModel: 'equal', branchPolicy: 'off' });
  assert.equal(a.status, 'ok', a.message);
  assert.equal(b.status, 'ok', b.message);
  const diff = Math.max(...a.color.map((v, i) => Math.abs(F.decode(v) - F.decode(b.color[i]))));
  assert.ok(diff < 2e-5, shape + ': ' + diff);
  limits.push({ shape, maxLinearDifference: diff });
}
// A cube center ray agrees with the resolved infinite slab when no side is hit.
const cc = { ...base, shape: 'cube', maxInterfaces: 2, branchDebug: true },
  cube = F.trace([0, 0, 4], [0, 0, -1], cc),
  slab = F.trace([0, 0, 4], [0, 0, -1], { ...cc, shape: 'slab', coherentInterface: 'resolved' });
near(cube.weightSum, slab.weightSum, 2e-6);
// Bulk relative phase is used: a changed wavelength changes mode populations.
const a = F.trace([0.15, 0.03, 4], [0, 0, -1], { ...cc, wavelengthNm: 450 }),
  b = F.trace([0.15, 0.03, 4], [0, 0, -1], { ...cc, wavelengthNm: 650 });
const phaseDifference = Math.max(
  ...a.events.flatMap((e, i) => e.weights.map((v, m) => Math.abs(v - b.events[i].weights[m]))),
);
assert.ok(phaseDifference > 1e-6);
// A torus ray crosses the near tube and re-enters the far tube.
const reentry = F.trace([0.1, 0, 4], [0, 0, -1], { ...base, shape: 'torus', maxInterfaces: 8 });
valid(reentry);
assert.ok(reentry.phaseReentries > 0);
// Shape/solver accuracy at a smooth background, away from silhouette edges.
const convergence = [];
for (const shape of K.shapes) {
  const c = { ...base, shape, maxInterfaces: 2, background: 'uv' },
    o = [0.31, 0.08, 4],
    d = O.unit([0.015, 0.01, -1]),
    a = F.trace(o, d, c),
    b = F.trace(o, d, { ...c, solver: 'rkf45', step: 0.005 });
  assert.equal(a.status, 'ok', a.message);
  assert.equal(b.status, 'ok', b.message);
  const diff = Math.max(...a.color.map((v, i) => Math.abs(F.decode(v) - F.decode(b.color[i]))));
  assert.ok(diff < 1e-4, shape + ': ' + diff);
  convergence.push({ shape, maxLinearDifference: diff });
}
// Very narrow beams cause separation and a bounded, explicitly accounted tree.
const split = F.trace([0, 0, 4], [0, 0, -1], {
  ...base,
  shape: 'cube',
  lengthUnitUm: 100,
  beamRadiusUm: 0.1,
  branchDepth: 1,
});
valid(split);
assert.ok(split.coherentSplits > 0);
assert.ok(split.coherentLimitWeight > 0);
// A grazing z pair cannot be used: adiabatic continuation is counted, not lost.
const grazing = F.trace([4, 0.03, 0.12], [-1, 0, 0], {
  ...base,
  shape: 'cube',
  material: 'axial2013Uniaxial',
  maxInterfaces: 2,
});
valid(grazing);
assert.ok(grazing.phaseAdiabaticSegments > 0);
assert.throws(() => F.validate({ ...base, shape: 'slab' }));
assert.throws(() => F.validate({ ...base, material: 'biaxial' }));
fs.writeFileSync(
  path.join(out, 'kernel-validation.json'),
  JSON.stringify(
    {
      rows,
      limits,
      convergence,
      slabDifference: Math.abs(cube.weightSum - slab.weightSum),
      phaseDifference,
      reentry: { count: reentry.phaseReentries, accounted: reentry.accounted },
      separation: {
        splits: split.coherentSplits,
        limit: split.coherentLimitWeight,
        accounted: split.accounted,
      },
      grazing: { fallbacks: grazing.phaseAdiabaticSegments, reasons: grazing.phaseFallbackReasons },
    },
    null,
    2,
  ),
);
console.log(
  'PASS finite shape geometry, 4 materials, both directions, phase response, uniform/slab limits, re-entry, solver comparison, split limits and explicit adiabatic fallback.',
);
