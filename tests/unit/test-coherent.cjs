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
])
  require('../../app/' + f + '.js');
const F = O.polarization,
  Q = F.coherent,
  L = F.layered,
  reference = require('../helpers/coherent-reference.cjs');
const c = {
  ...O.defaults,
  solver: 'auto',
  transport: 'polarized',
  material: 'heliconical',
  shape: 'slab',
  tilt: 60,
  azimuth: 17,
  twist: 1,
  projection: 'ortho',
  branchModel: 'coherent',
  branchPolicy: 'overlap',
  branchDepth: 6,
  background: 'white',
  maxInterfaces: 8,
  minContribution: 1e-6,
  branchDebug: true,
};
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) < t, `${a} != ${b} (tol ${t})`);
let splitError = 0;
for (const sign of [-1, 1])
  for (const unit of [0.5, 2, 10, 1000])
    for (const S of [
      [1, 1, 0, 0],
      [1, -1, 0, 0],
      [1, 0, 1, 0],
      [1, 0, 0, 1],
      [1, 0.1, 0.3, -0.2],
      [1, 0, 0, 0],
    ]) {
      const cfg = { ...c, lengthUnitUm: unit },
        a = Q.transport(S, -sign, sign, cfg, sign),
        b = Q.transport(S, -sign, sign, { ...cfg, phaseSlices: 256 }, sign);
      a.forEach((v, i) => {
        splitError = Math.max(splitError, Math.abs(v - b[i]));
        near(v, b[i], 1e-10);
      });
      near(a[0], S[0]);
      assert.ok(Math.hypot(...a.slice(1)) <= a[0] + 1e-10);
      const reversed = Q.transport(a, sign, -sign, cfg, sign);
      reversed.forEach((v, i) => near(v, S[i], 1e-10));
    }
// Fixed director: no modal power conversion, but a coherent superposition
// still acquires relative retardance. Natural unpolarized input is invariant.
const fixed = { ...c, twist: 0 },
  ret = Q.transport([1, 0, 1, 0], -1, 1, fixed, 1);
near(ret[1], 0);
assert.ok(Math.abs(ret[3]) > 0.01);
near(Q.transfer(-1, 1, fixed, 1).conversion, 0);
const maxwell = [];
for (const indices of [
  [1.55, 1.5],
  [1.658, 1.486],
])
  for (const unit of [1, 5, 10])
    for (const sign of [-1, 1]) {
      const cfg = { ...c, no: indices[0], ne: indices[1], lengthUnitUm: unit },
        full = reference.scatter(cfg, 65536, sign),
        coarse = reference.scatter(cfg, 32768, sign),
        pred = Q.transfer(-sign, sign, cfg, sign).conversion,
        old = Math.sin(F.modal.transfer(-sign, sign, [0, 0], cfg, sign).angle) ** 2;
      const exactJones = [0, 1].map((row) => full.map((col) => col.amplitudes[row])),
        exactMueller = L.jonesMueller(exactJones),
        approxMueller = Q.transfer(-sign, sign, cfg, sign).M;
      const muellerError = Math.max(
        ...exactMueller.flatMap((row, i) => row.map((v, j) => Math.abs(v - approxMueller[i][j]))),
      );
      assert.ok(muellerError < 0.002, muellerError);
      let convergence = 0,
        error = 0,
        oldError = 0,
        reflection = 0;
      for (let mode = 0; mode < 2; mode++) {
        full[mode].T.forEach((v, i) => {
          convergence = Math.max(convergence, Math.abs(v - coarse[mode].T[i]));
          error = Math.max(error, Math.abs(v - (i === mode ? 1 - pred : pred)));
        });
        near(full[mode].sum, 1, 2e-6);
        oldError = Math.max(oldError, Math.abs(full[mode].T[1 - mode] - old));
        reflection = Math.max(
          reflection,
          full[mode].R.reduce((a, b) => a + b, 0),
        );
      }
      assert.ok(convergence < 5e-9, convergence);
      assert.ok(error < 1e-5, error);
      assert.ok(error < oldError);
      maxwell.push({
        no: cfg.no,
        ne: cfg.ne,
        lengthUnitUm: unit,
        sign,
        conversion: pred,
        full,
        convergence,
        error,
        muellerError,
        oldError,
        reflection,
      });
    }
// Separation depends on envelope overlap, not numerical partitions. Check
// analytic first-crossing formula against geometry, including multiple turns.
const rayResults = [];
for (const sign of [-1, 1])
  for (const twist of [0.3, 1, 6]) {
    const cfg = { ...c, twist, lengthUnitUm: 1000, beamRadiusUm: 5 },
      states = Q.initialStates([0.1, 0.2, -sign], cfg, sign),
      z = Q.separationZ(states, sign, cfg, sign);
    assert.notEqual(z, null);
    const at = Q.advance(states, z, cfg),
      distance = O.norm(O.add(at[1].slice(0, 2), O.mul(at[0].slice(0, 2), -1))) * cfg.lengthUnitUm;
    near(Math.exp(-(distance ** 2) / (2 * cfg.beamRadiusUm ** 2)), cfg.overlapCutoff, 1e-10);
    const before = Q.advance(states, z - sign * 1e-5, cfg);
    assert.ok(
      O.norm(O.add(before[1].slice(0, 2), O.mul(before[0].slice(0, 2), -1))) * cfg.lengthUnitUm <
        distance,
    );
  }
for (const sign of [-1, 1])
  for (const width of [10, 0.2]) {
    const cfg = { ...c, beamRadiusUm: width },
      r = F.trace([0.1, 0.2, -4 * sign], [0, 0, sign], cfg);
    assert.equal(r.status, 'ok', r.message);
    near(r.accounted, 1);
    r.color.forEach((v) => near(F.decode(v), r.weightSum));
    const sliced = F.trace([0.1, 0.2, -4 * sign], [0, 0, sign], { ...cfg, phaseSlices: 64 });
    r.color.forEach((v, i) => near(v, sliced.color[i], 1e-7));
    assert.equal(r.coherentSplits, sliced.coherentSplits);
    const numeric = F.trace([0.1, 0.2, -4 * sign], [0, 0, sign], {
      ...cfg,
      solver: 'rkf45',
      step: 0.005,
    });
    assert.equal(numeric.status, 'ok', numeric.message);
    r.color.forEach((v, i) => near(v, numeric.color[i], 1e-7));
    if (width < 1) assert.ok(r.coherentSplits > 0);
    else assert.equal(r.coherentSplits, 0);
    rayResults.push({
      sign,
      width,
      splits: r.coherentSplits,
      limitWeight: r.coherentLimitWeight,
      accounted: r.accounted,
      fluxError: r.fluxError,
    });
  }
const limited = F.trace([0, 0, 4], [0, 0, -1], { ...c, beamRadiusUm: 0.2, branchDepth: 0 });
assert.ok(limited.coherentLimitWeight > 0.9);
near(limited.accounted, 1);
for (const bad of [
  { wavelengthNm: 0 },
  { phaseSlices: 0 },
  { shape: 'sphere' },
  { material: 'common' },
  { projection: 'perspective' },
  { yaw: 1 },
  { tilt: 0 },
  { overlapCutoff: 1 },
])
  assert.throws(() => F.validate({ ...c, ...bad }));
const out = path.join(__dirname, '../../test-results/unit', 'coherent-phase-20260917');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'kernel-validation.json'),
  JSON.stringify({ splitError, maxwell, rayResults }, null, 2),
);
console.log(
  'PASS phase transport, Mueller positivity, subdivision invariance, reverse transfer, independent 4x4 Maxwell, separation roots, depth guards, analytical/RKF45 rays, energy accounting, unsupported settings.',
);
console.log({
  splitError,
  maxMaxwellError: Math.max(...maxwell.map((v) => v.error)),
  maxMuellerError: Math.max(...maxwell.map((v) => v.muellerError)),
  maxReferenceConvergence: Math.max(...maxwell.map((v) => v.convergence)),
  rayResults,
});
