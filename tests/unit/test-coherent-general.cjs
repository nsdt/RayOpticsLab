const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  O = require('../../app/optics.js');
for (const f of [
  'analytical',
  'schur',
  'branching',
  'polarization',
  'layered',
  'modal',
  'coherent',
  'coherent-general',
])
  require('../../app/' + f + '.js');
const F = O.polarization,
  G = F.coherentGeneral,
  L = F.layered,
  C = globalThis.Polynomial.C,
  ref = require('../helpers/coherent-general-reference.cjs');
const base = {
  ...O.defaults,
  solver: 'auto',
  transport: 'polarized',
  material: 'heliconical',
  shape: 'slab',
  tilt: 55,
  azimuth: 17,
  twist: 0.7,
  gradient: 0.12,
  branchModel: 'coherent',
  branchPolicy: 'overlap',
  branchDepth: 6,
  maxInterfaces: 4,
  beamRadiusUm: 20,
  lengthUnitUm: 5,
  phaseTolerance: 1e-7,
  background: 'white',
  minContribution: 1e-6,
  branchDebug: true,
};
const near = (x, y, t = 1e-8) => assert.ok(Math.abs(x - y) < t, `${x} != ${y}`),
  matrixError = (a, b) =>
    Math.max(...a.flatMap((r, i) => r.map((z, j) => C.abs(C.sub(z, b[i][j])))));
let maxSubdivisionError = 0,
  maxGeometryError = 0;
const results = [];
for (const material of G.models)
  for (const sign of [-1, 1])
    for (const k of [
      [0.12, 0.08],
      [0.32, -0.15],
    ]) {
      const c = { ...base, material, backgroundZ: 3 * sign },
        tr = G.transfer(-sign, sign, k, c, sign),
        sliced = G.transfer(-sign, sign, k, { ...c, phaseSlices: 8 }, sign),
        tight = G.transfer(-sign, sign, k, { ...c, phaseTolerance: 1e-9 }, sign);
      const sliceError = matrixError(tr.J, sliced.J),
        tightError = matrixError(tr.J, tight.J);
      maxSubdivisionError = Math.max(maxSubdivisionError, sliceError);
      assert.ok(sliceError < 2e-6);
      assert.ok(tightError < 2e-6);
      for (const S of [
        [1, 0, 0, 0],
        [1, 0.2, -0.3, 0.1],
        [1, 0, 0, 1],
      ]) {
        const out = L.applyMueller(tr.M, S);
        near(out[0], 1);
        near(Math.hypot(...out.slice(1)), Math.hypot(...S.slice(1)));
      }
      const full = ref.scatter(c, 32768, sign, k),
        coarse = ref.scatter(c, 16384, sign, k),
        J = [0, 1].map((i) => full.map((col) => col.amplitudes[i])),
        M = L.jonesMueller(J);
      const muellerError = Math.max(
          ...M.flatMap((row, i) => row.map((v, j) => Math.abs(v - tr.M[i][j]))),
        ),
        powerError = Math.max(
          ...full.flatMap((col, i) => col.T.map((v, j) => Math.abs(v - C.abs(tr.J[j][i]) ** 2))),
        ),
        convergence = Math.max(
          ...full.flatMap((col, i) => col.T.map((v, j) => Math.abs(v - coarse[i].T[j]))),
        );
      assert.ok(muellerError < 0.003, material + ' ' + muellerError);
      assert.ok(powerError < 0.001);
      assert.ok(convergence < 1e-7);
      full.forEach((v) => near(v.sum, 1, 1e-7));
      if (material === 'axial2013Uniaxial') near(tr.conversion, 0, 1e-20);
      const states = G.initialStates([0.1, 0.2, -0.8 * sign], k, c, sign),
        end = 0.8 * sign,
        exact = G.advance(states, end, c),
        numeric = G.advance(states, end, { ...c, solver: 'rkf45', step: 0.005 });
      exact.forEach((s, m) =>
        s.forEach((v, i) => {
          maxGeometryError = Math.max(maxGeometryError, Math.abs(v - numeric[m][i]));
          near(v, numeric[m][i], 2e-6);
        }),
      );
      const r = F.trace([0, 0, -4 * sign], O.unit([...k, sign]), c);
      assert.equal(r.status, 'ok', r.message);
      near(r.accounted, 1);
      r.color.forEach((v) => near(F.decode(v), r.weightSum));
      assert.ok(r.phaseNumerical > 0);
      assert.ok(r.phaseSurfaceDephasings > 0);
      results.push({
        material,
        sign,
        k,
        conversion: tr.conversion,
        errorEstimate: tr.error,
        evaluations: tr.evaluations,
        sliceError,
        tightError,
        powerError,
        muellerError,
        convergence,
        reflected: full.map((v) => v.R.reduce((a, b) => a + b, 0)),
      });
    }
// Old normal-incidence constant generator remains the same closed matrix.
for (const sign of [-1, 1]) {
  const c = { ...base, material: 'heliconical' },
    a = G.transfer(-1, 1, [0, 0], c, sign),
    b = F.coherent.transfer(-1, 1, c, sign);
  near(matrixError(a.J, b.J), 0);
}
// Explicit resolved-interface model has a continuous normal-incidence limit.
const normal = F.trace([0, 0, 4], [0, 0, -1], base),
  nearNormal = F.trace([0, 0, 4], O.unit([1e-7, 0, -1]), base);
near(normal.weightSum, nearNormal.weightSum, 1e-7);
// Homogeneous fixed axis has no modal conversion; heliconical retains geometry.
near(
  G.transfer(-1, 1, [0.2, 0.1], { ...base, material: 'common', gradient: 0 }, 1).conversion,
  0,
  1e-20,
);
const small = { ...base, material: 'heliconical', beamRadiusUm: 0.12 },
  s = F.trace([0, 0, 4], O.unit([0.15, 0.07, -1]), small);
assert.equal(s.status, 'ok', s.message);
assert.ok(s.coherentSplits > 0);
near(s.accounted, 1);
const zero = F.trace([0, 0, 4], O.unit([0.15, 0.07, -1]), { ...small, branchDepth: 0 });
assert.ok(zero.coherentLimitWeight > 0.9);
near(zero.accounted, 1);
for (const bad of [{ shape: 'sphere' }, { material: 'biaxial' }, { phaseTolerance: 0 }])
  assert.throws(() => F.validate({ ...base, ...bad }));
assert.throws(() => G.transfer(-1, 1, [2, 0], base, 1));
const out = path.join(__dirname, '../../test-results/unit', 'coherent-general-20260917');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'kernel-validation.json'),
  JSON.stringify(
    {
      maxSubdivisionError,
      maxGeometryError,
      results,
      split: { count: s.coherentSplits, accounted: s.accounted, limit: zero.coherentLimitWeight },
    },
    null,
    2,
  ),
);
console.log(
  'PASS 4 media, oblique forward/reverse, unitary Stokes transport, tolerance and subdivision convergence, independent oblique Maxwell, exact/Schur versus z-RKF45 geometry, energy accounting, fixed-axis zero conversion, normal limit, split depth, invalid conditions.',
);
console.log({
  maxSubdivisionError,
  maxGeometryError,
  maxMuellerError: Math.max(...results.map((v) => v.muellerError)),
  maxPowerError: Math.max(...results.map((v) => v.powerError)),
  maxReferenceConvergence: Math.max(...results.map((v) => v.convergence)),
});
