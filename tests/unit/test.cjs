const assert = require('node:assert/strict');
const O = require('../../app/optics.js');
require('../../app/analytical.js');
let c = { ...O.defaults, backgroundZ: 3 };
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
// Snell tangential conservation and dispersion at an oblique plane.
let d = O.unit([0.4, 0, 1]),
  N = [0, 0, -1],
  p = O.boundary([0, 0, -1], d, N, c, 1);
near(p[0], d[0]);
near(2 * O.H([0, 0, -1], p, c, 1), 1);
assert.ok(O.velocity([0, 0, -1], p, c, 1)[2] > 0);
// Biaxial eigenproblem reduces to isotropic and uniaxial roots.
c = { ...c, material: 'biaxial', nx: 1.5, ny: 1.5, nz: 1.5 };
near(2 * O.H([0, 0, 0], [0, 0, 1.5], c, 0), 1);
near(2 * O.H([0, 0, 0], [0, 0, 1.5], c, 1), 1);
c = { ...c, nx: 1.5, ny: 1.5, nz: 1.7, tilt: 0, azimuth: 0 };
near(2 * O.H([0, 0, 0], [1.7, 0, 0], c, 0), 1);
near(2 * O.H([0, 0, 0], [1.5, 0, 0], c, 1), 1);
// Closed trajectory vs Hamiltonian RKF45, including both orientations.
for (let material of ['axial2013', 'common', 'quadratic', 'shear', 'heliconical'])
  for (let sign of [-1, 1]) {
    c = { ...O.defaults, backgroundZ: 3, material, gradient: 0.2, solver: 'auto' };
    let x = [0.1, 0.1, 0],
      k = material === 'heliconical' ? [0, 0] : [0.15, 0.08],
      G = O.metric(x, c, 1),
      K = O.inv(G),
      a = K[2][2],
      b = 2 * (K[2][0] * k[0] + K[2][1] * k[1]),
      cc = K[0][0] * k[0] ** 2 + 2 * K[0][1] * k[0] * k[1] + K[1][1] * k[1] ** 2 - 1,
      pz = (-b + sign * Math.sqrt(b * b - 4 * a * cc)) / (2 * a),
      s = [...x, ...k, pz];
    for (let j = 0; j < 100; j++) s = O.rkf45(s, 0.001, c, 1);
    let exact = O.exactAdvance([...x, ...k, pz], s[2], c, 1);
    assert.ok(exact);
    for (let j = 0; j < 6; j++) near(s[j], exact[j], 2e-7);
  }
// Shape intersections and vacuum identity through all shapes.
for (let shape of ['sphere', 'cube', 'torus']) {
  c = { ...O.defaults, backgroundZ: 3, shape, n: 1, solver: 'auto' };
  let o = [0.6, 0.05, -4],
    d = O.unit([0, 0, 1]),
    r = O.trace(o, d, c, 1);
  assert.equal(r.status, 'ok');
  let expected = O.bg(o, d, c);
  for (let i = 0; i < 3; i++) near(r.color[i], expected[i], 1e-4);
}
// Actual image rays through every requested material category.
for (let material of [
  'isotropic',
  'radial',
  'axial',
  'uniaxial',
  'biaxial',
  'axial2013',
  'eng2013',
  'molded2013',
  'common',
  'quadratic',
  'hyperbolic',
  'heliconical',
  'shear',
]) {
  c = { ...O.defaults, backgroundZ: 3, material, solver: 'auto' };
  for (let shape of ['sphere', 'cube', 'torus']) {
    c.shape = shape;
    for (let a of [-0.5, 0, 0.5]) {
      let r = O.trace([0, 0, -4], O.unit([a, 0.2, 4]), c, 1);
      assert.ok(r.color.every(Number.isFinite));
      assert.ok(r.drift < 0.05, `${material} ${shape} drift ${r.drift}`);
    }
  }
}
console.log(
  'PASS: Snell, Maxwell eigenbranches, analytical/RKF45 agreement, reverse orientation, vacuum identity, 13 materials × 3 shapes.',
);
require('../../app/approximate.js');
// Approximate molded model exactly reproduces the axial solution at zero transverse grading.
{
  let c = { ...O.defaults, backgroundZ: 3, material: 'moldedApprox', gradient: 0 },
    x = [0.1, 0.1, 0],
    p = O.boundary(x, O.unit([0.03, 0.02, 1]), [0, 0, -1], c, 1),
    s = [...x, ...p],
    a = O.approximate(s, 0.1, c, 1),
    t = s;
  for (let i = 0; i < 100; i++) t = O.rkf45(t, 0.001, c, 1);
  let b = O.approximate(s, t[2], c, 1);
  for (let j = 0; j < 6; j++) near(t[j], b[j], 1e-7);
  assert.ok(a.every(Number.isFinite));
}
console.log('PASS: molded small-slope axial limit.');
require('../../app/schur.js');
for (let material of ['axial', 'common', 'heliconical', 'shear']) {
  let c = { ...O.defaults, backgroundZ: 3, material },
    s = [0, 0, 0, ...O.boundary([0, 0, 0], O.unit([0.1, 0.03, 1]), [0, 0, -1], c, 1)],
    t = s;
  for (let j = 0; j < 100; j++) t = O.rkf45(t, 0.001, c, 1);
  let q = O.schurAdvance(s, t[2], c, 1);
  assert.ok(q);
  for (let i = 0; i < 6; i++) near(q[i], t[i], 1e-7);
}
console.log('PASS: Schur integral vs Hamiltonian integration.');
require('../../app/homogeneous.js');
for (let material of ['isotropic', 'uniaxial', 'biaxial']) {
  let c = { ...O.defaults, backgroundZ: 3, material },
    x = [0, 0, 0],
    p = O.boundary(x, O.unit([0.1, 0.05, 1]), [0, 0, -1], c, 1),
    s = [...x, ...p],
    a = O.advance(s, 0.5, c, 1),
    b = O.rkf45(s, 0.5, c, 1);
  for (let i = 0; i < 6; i++) near(a[i], b[i], 1e-8);
}
console.log('PASS: homogeneous straight-ray optimization.');
