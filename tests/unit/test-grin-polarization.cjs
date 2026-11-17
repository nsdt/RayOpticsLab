const assert = require('node:assert/strict'),
  O = require('../../app/optics.js');
for (const f of ['analytical', 'schur', 'homogeneous', 'grin', 'branching', 'polarization'])
  require('../../app/' + f + '.js');
const F = O.polarization,
  models = ['sphericalSquared', 'radialSquared', 'axialSquared', 'radial', 'axial'];
const base = {
  ...O.defaults,
  transport: 'polarized',
  solver: 'auto',
  n: 1.5,
  gradient: 0.25,
  step: 0.035,
  maxInterfaces: 6,
  minContribution: 1e-6,
  background: 'white',
};
const norm = O.norm,
  dist = (a, b) => Math.hypot(...a.map((x, i) => x - b[i])),
  flatE = (E) => E.flat(),
  near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
// Independent coupled ray / polarization ODE in tau: x'=p, p'=grad(n^2)/2.
function deriv(s, c) {
  const [x, y, z] = s,
    g = c.gradient,
    m = c.material,
    n = c.n,
    p = s.slice(3, 6),
    pp = O.dot(p, p);
  const dp =
    m === 'radial'
      ? [x, y, z].map((v) => 2 * g * (n + g * (x * x + y * y + z * z)) * v)
      : m === 'axial'
        ? [0, 0, g * (n + g * z)]
        : m === 'axialSquared'
          ? [0, 0, g / 2]
          : [-g * x, -g * y, m === 'sphericalSquared' ? -g * z : 0];
  const t = O.unit(p),
    dt = O.mul(O.add(dp, O.mul(p, -O.dot(p, dp) / pp)), 1 / Math.sqrt(pp)),
    dE = [];
  for (let j = 0; j < 3; j++)
    for (let part = 0; part < 2; part++)
      dE.push(-t[j] * (s[6 + part] * dt[0] + s[8 + part] * dt[1] + s[10 + part] * dt[2]));
  return [...p, ...dp, ...dE];
}
function rk(s, h, c) {
  const add = (a, b, f) => a.map((x, i) => x + f * b[i]),
    a = deriv(s, c),
    b = deriv(add(s, a, h / 2), c),
    d = deriv(add(s, b, h / 2), c),
    e = deriv(add(s, d, h), c);
  return s.map((x, i) => x + (h * (a[i] + 2 * b[i] + 2 * d[i] + e[i])) / 6);
}
function reference(packet, c) {
  let s = [...packet.o, ...packet.p, ...flatE(packet.E)];
  for (let i = 0; i < 40000; i++) {
    const h = 0.0004 / norm(s.slice(3, 6)),
      q = rk(s, h, c);
    if (O.sdf(q.slice(0, 3), c.shape) >= 0) {
      let lo = 0,
        hi = h;
      for (let j = 0; j < 30; j++) {
        let t = (lo + hi) / 2;
        if (O.sdf(rk(s, t, c).slice(0, 3), c.shape) < 0) lo = t;
        else hi = t;
      }
      return rk(s, (lo + hi) / 2, c);
    }
    s = q;
  }
  throw Error('reference failed to exit');
}
let maxPosition = 0,
  maxMomentum = 0,
  maxField = 0;
for (const material of models)
  for (const shape of ['sphere', 'cube', 'torus'])
    for (const sign of [-1, 1]) {
      const c = { ...base, material, shape, backgroundZ: sign * 3 },
        o = [shape === 'torus' ? 0.63 : 0.23, 0.12, -4 * sign],
        d = O.unit([0.04, 0.025, sign]),
        x = O.hit(o, d, shape),
        p = O.boundary(x, d, O.normal(x, shape), c, 0, true),
        [u, v] = F.basis(O.unit(p)),
        E = u.map((a, i) => [a / Math.sqrt(2), v[i] / Math.sqrt(2)]),
        packet = F.launch(x, { p, E, mode: 0 }, c, { drift: 0 }),
        a = F.propagate(packet, c),
        b = reference(packet, c);
      const position = dist(a.o, b.slice(0, 3)),
        momentum = dist(a.p, b.slice(3, 6)),
        field = dist(flatE(a.E), b.slice(6));
      maxPosition = Math.max(maxPosition, position);
      maxMomentum = Math.max(maxMomentum, momentum);
      maxField = Math.max(maxField, field);
      assert.ok(
        position < 3e-6 && momentum < 3e-6 && field < 3e-6,
        JSON.stringify({ material, shape, sign, position, momentum, field }),
      );
      for (const part of [0, 1])
        near(
          O.dot(
            a.p,
            a.E.map((z) => z[part]),
          ),
          0,
          1e-9,
        );
      near(norm(flatE(a.E)), 1, 1e-12);
      const r = F.trace(o, d, c);
      assert.equal(r.status, 'ok', `${material}/${shape}: ${r.message}`);
      near(r.accounted, 1, 2e-7);
      near(F.decode(r.color[0]), r.weightSum, 1e-12);
      assert.equal(r.internalBranches, 0);
      assert.ok(r.reflections > 0);
      assert.ok(r.fluxError < 2e-7);
    }
console.log(
  'PASS 30 independent curved bulk exits / complex polarization ODE / shape radiance balances',
  { maxPosition, maxMomentum, maxField },
);
// Surface Fresnel factors must use the index at each hit, including different axial faces.
for (const material of models) {
  const c = { ...base, material, shape: 'sphere' },
    ext = { ...c, material: 'isotropic', n: 1 };
  for (const x of [
    [0, 0, -1],
    [0.6, 0, 0.8],
  ]) {
    const local = F.localMaterial(c, x);
    near(local.n, F.localMaterial(c, [...x, 1, 2, 3]).n);
    const N = O.unit(x),
      inc = { p: N, E: F.cv(F.basis(N)[0]) },
      r = F.scatter(inc, ext, local, N),
      R = ((local.n - 1) / (local.n + 1)) ** 2;
    near(
      r.children.filter((a) => a.reflection).reduce((a, b) => a + b.weight, 0),
      R,
      1e-12,
    );
    near(
      r.children.filter((a) => !a.reflection).reduce((a, b) => a + b.weight, 0),
      1 - R,
      1e-12,
    );
    assert.equal(r.children.filter((a) => !a.reflection).length, 1);
  }
}
for (const material of models) {
  const c = { ...base, material, gradient: 0, shape: 'sphere' },
    o = [0.1, 0.2, 4],
    d = O.unit([0.02, 0, -1]),
    a = F.trace(o, d, c),
    b = F.trace(o, d, { ...c, material: 'isotropic' });
  assert.equal(a.status, 'ok', a.message);
  near(dist(a.color, b.color), 0, 1e-10);
  near(a.weightSum, b.weightSum, 1e-12);
  assert.equal(F.varying(c), false);
  assert.equal(O.branching.homogeneous(c), true);
}
// Independent slab sum: at normal incidence a smooth axial bulk adds no reflection.
{
  const saved = O.bg;
  try {
    O.bg = (o, d) => (d[2] < 0 ? [255, 255, 255] : [0, 0, 0]);
    for (const material of ['axial', 'axialSquared']) {
      const c = {
          ...base,
          material,
          shape: 'cube',
          maxInterfaces: 12,
          minContribution: 1e-6,
          untracedTolerance: 0,
        },
        n1 = F.localMaterial(c, [0, 0, 1]).n,
        n2 = F.localMaterial(c, [0, 0, -1]).n,
        R1 = ((1 - n1) / (1 + n1)) ** 2,
        R2 = ((1 - n2) / (1 + n2)) ** 2,
        expected = ((1 - R1) * (1 - R2)) / (1 - R1 * R2),
        r = F.trace([0, 0, 4], [0, 0, -1], c);
      assert.equal(r.status, 'ok', r.message);
      near(F.decode(r.color[0]), expected, 2e-6);
    }
  } finally {
    O.bg = saved;
  }
}
// Marchand's exact Cartesian ray solution, n^2=N0^2 +/- b^2 rho^2 (section 5.3).
for (const g of [-0.4, 0.4]) {
  const c = { ...base, material: 'radialSquared', gradient: g },
    s = [
      0.2,
      -0.15,
      0.1,
      0.1,
      0.2,
      Math.sqrt(c.n * c.n - g * (0.2 ** 2 + 0.15 ** 2) - 0.1 ** 2 - 0.2 ** 2),
    ],
    dz = 0.8,
    b = Math.sqrt(Math.abs(g)),
    u = (b * dz) / s[5],
    C = g > 0 ? Math.cos(u) : Math.cosh(u),
    S = g > 0 ? Math.sin(u) : Math.sinh(u),
    q = O.polynomialAdvance(s, dz / s[5], c);
  for (let i = 0; i < 2; i++) {
    near(q[i], s[i] * C + (s[i + 3] * S) / b, 1e-13);
    near(q[i + 3], s[i + 3] * C - Math.sign(g) * b * s[i] * S, 1e-13);
  }
  near(q[2], s[2] + dz);
  near(q[5], s[5]);
}
// z turning: exact K propagation remains valid; it is not an internal interface.
{
  const c = { ...base, material: 'axialSquared', gradient: 1, shape: 'cube' },
    p = [Math.sqrt(c.n * c.n - 0.2 ** 2), 0, -0.2],
    E = F.cv([0, 1, 0]),
    r = F.propagate({ o: [0, 0, 0], p, E, mode: 0 }, c);
  assert.ok(r.p[2] > 0);
  near(r.o[0], 1, 2e-8);
  near(dist(flatE(r.E), flatE(E)), 0, 1e-12);
}
for (const material of models)
  assert.throws(
    () =>
      F.validate({
        ...base,
        material,
        n: 0.1,
        gradient: material === 'radial' ? -1 : 1,
        shape: 'cube',
      }),
    /屈折率/,
  );
console.log(
  'PASS local Fresnel factors / coherent coincident modes / homogeneous limits / axial slab throughput / Marchand formula / turning / domain guards',
);
