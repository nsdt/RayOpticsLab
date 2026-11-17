const assert = require('node:assert/strict'),
  O = require('../../app/optics.js'),
  P = require('../../app/polynomial.js');
require('../../app/polarization.js');
const F = O.polarization,
  C = P.C;
const near = (a, b, t = 2e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b} (tol ${t})`),
  dist = (a, b) => O.norm(O.add(a, O.mul(b, -1))),
  sum = (a) => a.reduce((s, x) => s + x.weight, 0);
const air = { ...O.defaults, material: 'isotropic', n: 1 },
  base = {
    ...O.defaults,
    material: 'biaxial',
    nx: 1.4,
    ny: 1.6,
    nz: 1.9,
    transport: 'polarized',
    maxInterfaces: 6,
    minContribution: 1e-5,
  },
  N = [0, 0, 1];
// Closed isotropic Fresnel values for each principal polarization, with p normal to z.
for (const [E, n, mode] of [
  [[1, 0, 0], base.nx, 1],
  [[0, 1, 0], base.ny, 0],
]) {
  const c = { ...base, tilt: 0, azimuth: 0 },
    s = F.scatter({ p: [0, 0, 1], E: F.cv(E) }, air, c, N),
    T = s.children.filter((x) => !x.reflection);
  near(sum(T), (4 * n) / (1 + n) ** 2);
  near(sum(s.children.filter((x) => x.reflection)), ((1 - n) / (1 + n)) ** 2);
  assert.equal(T.filter((x) => x.weight > 1e-10)[0].mode, mode);
}
let cases = 0,
  maxFluxError = 0,
  maxBoundaryResidual = 0,
  maxFieldResidual = 0,
  maxRayDifference = 0,
  evanescentModes = 0;
for (let i = 0; i < 100; i++) {
  const c = {
      ...base,
      tilt: 3 + i * 0.86,
      azimuth: i * 13,
      roll: i * 19,
      nx: 1.3 + 0.15 * Math.sin(i),
      ny: 1.6,
      nz: 1.95,
    },
    d = O.unit([0.85 * Math.sin(i), 0.6 * Math.cos(i * 1.7), 1]);
  for (const E of F.basis(d)) {
    const s = F.scatter({ p: d, E: F.cv(E) }, air, c, N);
    cases++;
    maxFluxError = Math.max(maxFluxError, s.error);
    maxBoundaryResidual = Math.max(maxBoundaryResidual, s.residual);
    maxFieldResidual = Math.max(maxFieldResidual, s.fieldResidual);
    assert.ok(s.error < 2e-8);
    assert.ok(s.residual < 2e-9);
    for (const ch of s.children.filter((x) => !x.reflection)) {
      near(2 * O.H([0, 0, 0], ch.p, c, ch.mode), 1, 2e-8);
      const direction = F.rayDirection({ ...ch, o: [0, 0, 0] }, c),
        v = O.unit(O.velocity([0, 0, 0], ch.p, c, ch.mode));
      maxRayDifference = Math.max(maxRayDifference, dist(direction, v));
      assert.ok(dist(direction, v) < 1e-6);
      const rev = F.scatter({ p: O.mul(ch.p, -1), E: ch.E.map(C.conj) }, c, air, O.mul(N, -1)),
        out = rev.children.find((x) => !x.reflection);
      assert.ok(out);
      const projection = out.E.reduce((s, z, j) => C.add(s, C.scale(z, E[j])), [0, 0]);
      near(ch.weight, out.weight * C.abs(projection) ** 2, 2e-8);
    }
  }
}
console.log(
  'PASS principal Fresnel values and',
  cases,
  'rotated biaxial polarization incidences / reciprocity / Poynting directions',
  { maxFluxError, maxBoundaryResidual, maxFieldResidual, maxRayDifference },
);
// A high-index exterior excites one or two evanescent transmitted modes.
for (let i = 0; i < 80; i++) {
  const c = { ...base, tilt: i * 0.9 + 2, azimuth: i * 7, roll: i * 11 },
    t = [0.1 + i * 0.027, 0.06, 0],
    incidentMedium = { ...air, n: 2.5 },
    p = [...t.slice(0, 2), Math.sqrt(2.5 ** 2 - O.dot(t, t))];
  const modes = F.modes(c, t, N, 1);
  evanescentModes += modes.filter((x) => !x.prop).length;
  for (const e of F.basis(O.unit(p))) {
    const s = F.scatter({ p, E: F.cv(e) }, incidentMedium, c, N);
    near(sum(s.children), 1, 2e-8);
    for (const m of modes.filter((x) => !x.prop)) {
      assert.ok(m.k[2][1] > 0);
      near(m.F, 0, 2e-8);
    }
  }
}
assert.ok(evanescentModes > 10);
console.log(
  'PASS partial and total reflection with',
  evanescentModes,
  'outgoing evanescent mode cases.',
);
// Reflected biaxial modes and biaxial-to-biaxial interfaces (basis is independent on each side).
let doubleReflectionCases = 0,
  fourBranchCases = 0;
for (let i = 0; i < 50; i++) {
  const a = { ...base, tilt: 15 + i, azimuth: i * 17 },
    b = { ...base, nx: 1.22, ny: 1.46, nz: 1.72, tilt: 65 - i * 0.5, azimuth: 5 + i * 9 },
    t = [0.3 + i * 0.018, 0.12 * Math.sin(i), 0];
  for (const m of F.modes(a, t, N, 1).filter((x) => x.prop))
    for (const to of [air, b]) {
      const s = F.scatter(m, a, to, N);
      near(sum(s.children), 1, 3e-8);
      assert.ok(s.residual < 2e-9);
      if (s.children.filter((x) => x.reflection && x.weight > 1e-6).length === 2)
        doubleReflectionCases++;
      if (s.children.filter((x) => x.weight > 1e-6).length === 4) fourBranchCases++;
    }
}
assert.ok(doubleReflectionCases > 0 && fourBranchCases > 0);
console.log('PASS biaxial internal reflection and biaxial/biaxial interfaces.', {
  doubleReflectionCases,
  fourBranchCases,
});
// Exact isotropic and uniaxial limits, including any choice of the unique principal axis.
for (const ns of [
  [1.5, 1.5, 1.5],
  [1.5, 1.5, 1.8],
  [1.8, 1.8, 1.5],
  [1.5, 1.8, 1.5],
  [1.8, 1.5, 1.5],
])
  for (let i = 0; i < 8; i++) {
    const c = {
        ...base,
        nx: ns[0],
        ny: ns[1],
        nz: ns[2],
        tilt: 15 + i * 7,
        azimuth: i * 23,
        roll: i * 17,
      },
      equivalent = F.isIso(c) ? { ...air, n: ns[0] } : F.uniaxialLimit(c).medium,
      d = O.unit([0.3 * Math.sin(i), 0.2 * Math.cos(i), 1]);
    for (const E of F.basis(d)) {
      const actual = F.scatter({ p: d, E: F.cv(E) }, air, c, N),
        expected = F.scatter({ p: d, E: F.cv(E) }, air, equivalent, N);
      for (const ch of actual.children) {
        const ref = expected.children.find(
          (x) => x.reflection === ch.reflection && dist(x.p, ch.p) < 1e-8,
        );
        assert.ok(ref);
        near(ch.weight, ref.weight, 1e-8);
      }
    }
  }
// Full white environment checks include paths inside each finite shape from the new camera side.
for (const shape of ['sphere', 'cube', 'torus'])
  for (const ns of [
    [1.4, 1.6, 1.9],
    [1.7797, 1.7897, 1.8877],
    [1.5785, 1.6065, 1.6212],
    [1.5, 1.5, 1.5],
    [1.5, 1.5, 1.8],
  ]) {
    const c = { ...base, shape, nx: ns[0], ny: ns[1], nz: ns[2], background: 'white' },
      o = [shape === 'torus' ? 0.65 : 0.12, 0.05, 4],
      d = O.unit([0.01, -0.01, -1]),
      r = F.trace(o, d, c);
    assert.equal(r.status, 'ok', JSON.stringify({ shape, ns, message: r.message }));
    assert.ok(r.interfaces >= 2);
    near(r.accounted, 1);
    near(F.decode(r.color[0]), 1 - r.dropped, 3e-8);
  }
const e = [1.4 ** 2, 1.6 ** 2, 1.9 ** 2],
  p = [
    Math.sqrt((e[2] * (e[1] - e[0])) / (e[2] - e[0])),
    0,
    Math.sqrt((e[0] * (e[2] - e[1])) / (e[2] - e[0])),
  ];
assert.throws(() => F.maxwellFields(F.cv(p), { ...base, tilt: 0, azimuth: 0 }), /縮退/);
console.log(
  'PASS isotropic / uniaxial limits, 15 finite-shape radiance balances, and explicit conical degeneracy guard.',
);

// Principal-axis rotations must change the tensor, and mode views keep the same exposure.
{
  const c = { ...base, tilt: 0, azimuth: 0, roll: 90 },
    eps = O.biaxialTensor(c);
  near(eps[0][0], c.ny ** 2);
  near(eps[1][1], c.nx ** 2);
  near(eps[2][2], c.nz ** 2);
}
{
  const c = { ...base, shape: 'cube', background: 'white' },
    o = [0.08, 0.02, 4],
    d = [0, 0, -1],
    all = F.trace(o, d, c);
  for (const [view, key] of [
    ['mode1', 'mode1'],
    ['mode2', 'mode2'],
  ]) {
    const r = F.trace(o, d, { ...c, transportView: view });
    near(F.decode(r.color[0]), all.channels[key]);
    assert.ok(all.channels[key] > 0);
  }
}
console.log(
  'PASS independent 90-degree tensor rotation and absolute per-mode radiance contributions.',
);
