const assert = require('node:assert/strict'),
  O = require('../../app/optics.js'),
  P = require('../../app/polynomial.js');
require('../../app/polarization.js');
const F = O.polarization,
  C = P.C;
const near = (a, b, t = 2e-9) => assert.ok(Math.abs(a - b) < t, a + ' != ' + b);
const mulPoly = (a, b) => {
  let c = Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => (c[i + j] += x * y)));
  return c;
};
for (const roots of [
  [-2, -0.1, 0.3, 4],
  [-1, -1, 2, 2],
  [-1e6, -2, 1e-8, 3],
  [0, -2, 1, 4],
  [-0.001, 0.002, 5, 100],
]) {
  let a = roots.reduce((s, x) => mulPoly(s, [-x, 1]), [1]),
    got = P.solve(a);
  for (let x of roots)
    assert.ok(
      got.real.some((v) => Math.abs(v - x) < 2e-7 * Math.max(Math.abs(x), 1e-8)),
      JSON.stringify({ roots, got }),
    );
  assert.ok(got.residual < 1e-12);
}
assert.equal(P.solve([1, 0, 2, 0, 1]).real.length, 0);
console.log('PASS polynomial reciprocal, small roots, double roots, zero roots, no real roots.');
const air = { ...O.defaults, untracedTolerance: 0, material: 'isotropic', n: 1 },
  glass = { ...air, n: 1.5 },
  N = [0, 0, 1];
let s = F.scatter({ p: [0, 0, 1], E: F.cv([1, 0, 0]) }, air, glass, N);
near(
  s.children.filter((x) => x.reflection).reduce((s, x) => s + x.weight, 0),
  0.04,
);
near(
  s.children.filter((x) => !x.reflection).reduce((s, x) => s + x.weight, 0),
  0.96,
);
let theta = Math.atan(1.5),
  d = [Math.sin(theta), 0, Math.cos(theta)],
  E = [Math.cos(theta), 0, -Math.sin(theta)];
s = F.scatter({ p: d, E: F.cv(E) }, air, glass, N);
assert.ok(s.children.filter((x) => x.reflection).reduce((s, x) => s + x.weight, 0) < 1e-20);
theta = Math.PI / 3;
d = [Math.sin(theta), 0, Math.cos(theta)];
E = [Math.cos(theta), 0, -Math.sin(theta)];
s = F.scatter({ p: O.mul(d, 1.5), E: F.cv(E) }, glass, air, N);
near(
  s.children.reduce((s, x) => s + x.weight, 0),
  1,
);
assert.ok(s.children.every((x) => x.reflection));
for (let i = 0; i < 50; i++) {
  let c = {
      ...O.defaults,
      untracedTolerance: 0,
      material: 'uniaxial',
      tilt: 5 + i * 1.6,
      azimuth: i * 11,
    },
    d = O.unit([0.8 * Math.sin(i), 0.6 * Math.cos(i * 1.7), 1]);
  for (const E of F.basis(d)) {
    let a = { p: d, E: F.cv(E) },
      s = F.scatter(a, air, c, N);
    assert.ok(s.error < 2e-10);
    assert.ok(s.residual < 2e-10);
    // Reciprocal, flux-normalized transmission coefficient projected back onto the initial polarization.
    for (let ch of s.children.filter((x) => !x.reflection)) {
      let rev = F.scatter({ p: O.mul(ch.p, -1), E: ch.E.map(C.conj) }, c, air, O.mul(N, -1)),
        out = rev.children.find((x) => !x.reflection);
      assert.ok(out);
      let proj = out.E.reduce((a, z, j) => C.add(a, C.scale(z, E[j])), [0, 0]);
      near(ch.weight, out.weight * C.abs(proj) ** 2, 2e-8);
    }
  }
}
console.log(
  'PASS interface Fresnel normal incidence, Brewster, total reflection including evanescent fields, 100 anisotropic incidences and reciprocity.',
);
for (let shape of ['sphere', 'cube', 'torus'])
  for (let material of ['isotropic', 'uniaxial']) {
    let c = {
      ...O.defaults,
      untracedTolerance: 0,
      backgroundZ: 3,
      shape,
      material,
      transport: 'polarized',
      background: 'white',
      maxInterfaces: 8,
      minContribution: 1e-6,
    };
    for (let x of [0, 0.4, 0.7]) {
      let r = F.trace([x, 0.05, -4], [0, 0, 1], c);
      assert.equal(r.status, 'ok', r.message);
      near(r.accounted, 1, 2e-8);
      assert.ok(r.color.every((v) => v <= 255 + 1e-6));
      let intensity = F.decode(r.color[0]);
      near(intensity, 1 - r.dropped, 2e-8);
    }
  }
console.log(
  'PASS finite geometry, reflection trees, uniform-radiance balance, explicit discarded energy.',
);

// Closed incoherent plane-parallel slab transmission: T=(1-R)/(1+R), R=0.04.
{
  const old = O.bg;
  try {
    O.bg = (o, d) => (d[2] > 0 ? [255, 255, 255] : [0, 0, 0]);
    const r = F.trace([0, 0, -4], [0, 0, 1], {
      ...O.defaults,
      untracedTolerance: 0,
      backgroundZ: 3,
      shape: 'cube',
      maxInterfaces: 12,
      minContribution: 1e-6,
    });
    near(F.decode(r.color[0]), 12 / 13, 1e-7);
  } finally {
    O.bg = old;
  }
}
for (let i = 0; i < 80; i++)
  for (const mode of [0, 1]) {
    const c = {
        ...O.defaults,
        untracedTolerance: 0,
        material: 'biaxial',
        nx: 1.2 + 0.1 * Math.sin(i),
        ny: 1.6,
        nz: 2.1,
        tilt: i % 90,
        azimuth: 3 * i,
      },
      d = O.unit([Math.sin(i) * 0.8, Math.cos(i) * 0.6, 1]),
      p = O.mul(d, 1 / Math.sqrt(2 * O.H([0, 0, 0], d, c, mode)));
    const actual = O.boundary([0, 0, 0], p, [0, 0, -1], c, mode, true);
    assert.ok(actual);
    for (let j = 0; j < 3; j++) near(actual[j], p[j], 2e-7);
  }
{
  const c = {
    ...O.defaults,
    untracedTolerance: 0,
    material: 'biaxial',
    nx: 6,
    ny: 7,
    nz: 8,
    tilt: 0,
    azimuth: 0,
  };
  for (let mode of [0, 1]) {
    let p = O.boundary([0, 0, 0], [0, 0, 1], [0, 0, -1], c, mode, true);
    assert.ok(p && p[2] > 5);
    near(2 * O.H([0, 0, 0], p, c, mode), 1);
  }
}
console.log(
  'PASS slab analytic transmission, 160 biaxial dispersion reconstructions, roots beyond the old scan interval.',
);
