const assert = require('node:assert/strict'),
  O = require('../../app/optics.js');
require('../../app/analytical.js');
require('../../app/schur.js');
require('../../app/approximate.js');
require('../../app/homogeneous.js');
require('../../app/grin.js');
require('../../app/branching.js');
require('../../app/catalog.js');
const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
// Exterior-medium Snell law, outgoing normalization and critical angle.
const c = { ...O.defaults, backgroundZ: 3, outsideN: 1.33, n: 1.5, solver: 'auto' },
  angle = 0.5,
  d = [Math.sin(angle), 0, Math.cos(angle)],
  x = [0, 0, -1],
  p = O.boundary(x, O.mul(d, c.outsideN), [0, 0, -1], c, 1);
near(p[0], 1.33 * Math.sin(angle));
near(O.unit(O.velocity(x, p, c, 1))[0], (1.33 / 1.5) * Math.sin(angle));
const out = O.exitDirection(p, [0, 0, 1], c);
out.forEach((v, i) => near(v, d[i]));
near(O.norm(out), 1);
assert.equal(O.exitDirection([1.2, 0, 0.9], [0, 0, 1], { outsideN: 1 }), null);
assert.ok(O.exitDirection([1.2, 0, 0.9], [0, 0, 1], { outsideN: 1.33 }));
// Index-matched material must leave the target mapping unchanged for all shapes.
for (const shape of ['sphere', 'cube', 'torus'])
  for (const n of [1, 1.33, 1.5168, 2]) {
    const cfg = { ...c, shape, n, outsideN: n },
      o = [0.6, 0.15, -4],
      d = O.unit([0.01, 0.007, 1]),
      r = O.trace(o, d, cfg, 1);
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.color, O.bg(o, d, cfg));
  }
// The matched homogeneous limit ignores artificial branching and retains its map.
{
  const cfg = {
      ...c,
      material: 'common',
      no: 1.33,
      ne: 1.33,
      gradient: 0,
      shape: 'cube',
      branchPolicy: 'planes',
      branchPlanes: '-.4,0,.4',
      branchDepth: 3,
    },
    o = [0.32, 0.13, -4],
    d = [0, 0, 1],
    r = O.branching.trace(o, d, cfg, 1);
  assert.equal(r.status, 'ok');
  near(r.weightSum, 1);
  assert.deepEqual(r.color, O.bg(o, d, cfg));
  assert.equal(r.leaves, 1);
  assert.equal(r.branches, 0);
}
// Exact quadratic-index trajectory vs independent integration of H=p²/(2n²).
for (const material of ['sphericalSquared', 'radialSquared', 'axialSquared'])
  for (const gradient of [-0.3, 0, 0.3])
    for (const sign of [-1, 1]) {
      const cfg = { ...c, material, n: 1.5, gradient },
        x = [0.12, 0.09, 0],
        p = O.boundary(x, [0.1, 0.04, sign], [0, 0, -sign], cfg, 1),
        s = [...x, ...p];
      let numeric = s;
      for (let i = 0; i < 300; i++) numeric = O.rkf45(numeric, 0.001, cfg, 1);
      let lo = 0,
        hi = 0.4;
      for (let i = 0; i < 60; i++) {
        const t = (lo + hi) / 2,
          end = O.polynomialAdvance(s, t, cfg);
        if (sign * (end[2] - numeric[2]) > 0) hi = t;
        else lo = t;
      }
      const exact = O.polynomialAdvance(s, (lo + hi) / 2, cfg);
      exact.forEach((v, i) => near(v, numeric[i], 2e-8));
      near(2 * O.H(exact.slice(0, 3), exact.slice(3), cfg, 1), 1, 1e-12);
    }
// Full aperture focusing of unit Luneburg sphere, including off-meridional rays.
for (const [x, y] of [
  [0.3, 0],
  [0.3, 0.4],
  [-0.5, 0.4],
  [0, 0],
]) {
  const c = { ...O.defaults, material: 'sphericalSquared', n: Math.SQRT2, gradient: 1 },
    s = [x, y, -Math.sqrt(1 - x * x - y * y), 0, 0, 1],
    e = O.polynomialAdvance(s, Math.PI / 2, c);
  near(e[0], 0);
  near(e[1], 0);
  near(e[2], 1);
  near(2 * O.H(e.slice(0, 3), e.slice(3), c, 1), 1);
}
// The current target uses neutral checker cells and four coloured landmarks.
{
  const c = { ...O.defaults, backgroundZ: 3 },
    bg = (x, y) => O.bg([x, y, 0], [0, 0, 1], c);
  for (const [x, y, rgb] of [
    [0.62, 0, [133, 60, 153]],
    [-0.62, 0, [0, 140, 100]],
    [0, 0.62, [0, 114, 178]],
    [0, -0.62, [213, 94, 0]],
  ])
    assert.deepEqual(bg(x, y), rgb);
  assert.deepEqual(bg(0.2, 0.8), [255, 255, 255]);
}
// Catalog every preset resolves to a supported model; material selections do not overwrite environment.
const C = global.MaterialCatalog;
assert.equal(C.presets.filter((p) => p.id.startsWith('glass-')).length, 32);
for (const p of C.presets) {
  const c = C.apply({ ...O.defaults, outsideN: 1.33, shape: 'torus' }, p.id);
  assert.ok(C.models[c.material]);
  assert.equal(c.outsideN, 1.33);
  assert.equal(c.shape, 'torus');
}
// Automatic method dispatch reports the actual path, including fallback and approximations.
for (const [material, kind, mode] of [
  ['isotropic', 'closed', 1],
  ['sphericalSquared', 'closed', 1],
  ['heliconical', 'quadrature', 1],
  ['radial', 'ode', 1],
  ['moldedApprox', 'approximate', 1],
]) {
  const c = { ...O.defaults, material, solver: 'auto' },
    x = [0, 0, 0],
    p = O.boundary(x, [0.03, 0.02, 1], [0, 0, -1], c, mode);
  O.evaluations = { closed: 0, quadrature: 0, ode: 0, approximate: 0 };
  O.advance([...x, ...p], 0.01, c, mode);
  assert.equal(O.evaluations[kind], 1, material);
}
console.log(
  'PASS: exterior Snell/TIR and matched indices (3 shapes × 4 indices), branching in immersion, 27 GRIN vs independent Hamiltonian cases, Luneburg full-aperture focus, landmark colors, catalog consistency and actual solver dispatch.',
);
