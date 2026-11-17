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
  'coherent-interface',
])
  require('../../app/' + f + '.js');
const F = O.polarization,
  G = F.coherentGeneral,
  L = F.layered,
  H = F.phaseInterface,
  ref = require('../helpers/coherent-interface-reference.cjs');
const base = {
  ...O.defaults,
  untracedTolerance: 0,
  solver: 'auto',
  transport: 'polarized',
  transportView: 'all',
  shape: 'slab',
  material: 'heliconical',
  tilt: 55,
  azimuth: 17,
  twist: 0.7,
  gradient: 0.12,
  branchModel: 'coherent',
  branchPolicy: 'overlap',
  branchDepth: 6,
  coherentInterface: 'coupled',
  commonMinOverlap: 0.99,
  maxInterfaces: 2,
  minContribution: 1e-6,
  beamRadiusUm: 20,
  lengthUnitUm: 5,
  phaseTolerance: 1e-7,
  background: 'white',
  branchDebug: true,
};
const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const rows = [];
for (const material of G.models)
  for (const sign of [-1, 1])
    for (const k of [
      [0.12, 0.08],
      [0.32, -0.15],
    ]) {
      const c = { ...base, material, backgroundZ: sign * 3 },
        d = [...k, sign * Math.sqrt(1 - k[0] ** 2 - k[1] ** 2)],
        a = H.onePass(d, c),
        b = ref.onePass(c, k, sign),
        M = L.jonesMueller(b.J),
        reference = L.applyMueller(M, [1, 0, 0, 0]);
      const error = Math.max(...reference.map((v, i) => Math.abs(v - a.transmitted[i])));
      assert.ok(error < 0.0001, material + ': ' + error);
      near(a.accounted, 1);
      const coarse = ref.onePass(c, k, sign, 16384),
        CM = L.jonesMueller(coarse.J),
        referenceRefinement = Math.max(
          ...M.flatMap((row, i) => row.map((v, j) => Math.abs(v - CM[i][j]))),
        );
      assert.ok(referenceRefinement < 1e-7);
      let maxPolarizedError = 0;
      const dephased = H.onePass(d, { ...c, coherentInterface: 'coupled-dephased' }),
        image = F.trace([0, 0, -4 * sign], d, c);
      assert.equal(image.status, 'ok', image.message);
      near(dephased.exitReflected[2], 0);
      near(dephased.exitReflected[3], 0);
      near(image.phaseTransmitted, a.transmitted[0]);
      near(image.phaseReflected, a.entryReflected[0]);
      near(image.dropped, a.exitReflected[0]);
      near(image.accounted, 1);
      image.color.forEach((v) => near(F.decode(v), image.weightSum));
      assert.ok(image.phaseMinOverlap >= 0.99);
      assert.equal(image.phaseSurfaceDephasings, 0);
      for (const S of [
        [1, 1, 0, 0],
        [1, 0.1, 0.2, 0.3],
        [1, 0, 0, 1],
      ]) {
        const v = H.onePass(d, c, S),
          reference = L.applyMueller(M, S);
        near(v.accounted, 1);
        maxPolarizedError = Math.max(
          maxPolarizedError,
          ...reference.map((x, i) => Math.abs(x - v.transmitted[i])),
        );
        assert.ok(maxPolarizedError < 0.0001);
      }
      rows.push({
        material,
        sign,
        k,
        transmission: a.transmitted[0],
        dephasedTransmission: dephased.transmitted[0],
        transmissionDifference: a.transmitted[0] - dephased.transmitted[0],
        stokes: a.transmitted,
        referenceStokes: reference,
        maxStokesError: error,
        maxPolarizedError,
        referenceRefinement,
        minimumOverlap: image.phaseMinOverlap,
        accounted: image.accounted,
      });
    }
const d = O.unit([0.3, 0.1, -1]),
  c = { ...base, material: 'common', gradient: 0 };
near(
  H.onePass(d, c).transmitted[0],
  H.onePass(d, { ...c, coherentInterface: 'coupled-dephased' }).transmitted[0],
  0.001,
);
const norm = { ...base, projection: 'ortho', yaw: 0, pitch: 0, maxInterfaces: 10 },
  normal = F.trace([0, 0, 4], [0, 0, -1], norm),
  legacy = F.coherent.trace([0, 0, 4], [0, 0, -1], { ...norm, coherentInterface: 'retained' });
near(normal.weightSum, legacy.weightSum, 1e-9);
const multiple = F.trace([0, 0, 4], d, { ...base, maxInterfaces: 10 });
assert.equal(multiple.status, 'ok', multiple.message);
near(multiple.accounted, 1);
assert.ok(multiple.phaseSurfaceRetentions > 2);
assert.ok(multiple.dropped < 1e-6);
const small = F.trace([0, 0, 4], d, { ...base, beamRadiusUm: 0.02 });
assert.equal(small.status, 'error');
assert.match(small.message, /重なり/);
near(small.accounted, 1);
assert.throws(() => F.validate({ ...base, transportView: 'o' }));
assert.throws(() => F.validate({ ...base, commonMinOverlap: 1 }));
assert.throws(() => F.validate({ ...base, shape: 'sphere' }));
// Matched common carriers isolate surface dephasing from spatial assignment.
const a = H.paths(d, base),
  b = H.paths(d, { ...base, coherentInterface: 'coupled-dephased' });
assert.deepEqual(
  a.rays.map((r) => r.o),
  b.rays.map((r) => r.o),
);
assert.ok(rows.some((r) => Math.abs(r.transmissionDifference) > 1e-6));
const out = path.join(__dirname, '../../test-results/unit', 'interface-comparison-20260917');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'kernel-validation.json'),
  JSON.stringify(
    {
      rows,
      multiple: {
        transmitted: multiple.phaseTransmitted,
        reflected: multiple.phaseReflected,
        dropped: multiple.dropped,
        accounted: multiple.accounted,
      },
      overlapGuard: {
        minimum: small.phaseMinOverlap,
        failed: small.failedWeight,
        accounted: small.accounted,
      },
    },
    null,
    2,
  ),
);
console.log(
  'PASS coherent oblique entry/bulk/exit, 16 independent one-pass Maxwell comparisons, arbitrary incident Stokes, surface dephasing comparison, common carriers, round-trip accounting, overlap and unsupported-condition guards.',
);
console.log({
  maxStokesError: Math.max(...rows.map((r) => r.maxStokesError)),
  maxSurfaceDifference: Math.max(...rows.map((r) => Math.abs(r.transmissionDifference))),
});
