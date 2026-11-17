const assert = require('node:assert/strict'),
  O = require('../../app/optics.js');
for (const f of ['analytical', 'schur', 'homogeneous', 'branching', 'polarization'])
  require('../../app/' + f + '.js');
const F = O.polarization,
  C = globalThis.Polynomial.C,
  near = (a, b, t = 2e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`),
  base = {
    ...O.defaults,
    solver: 'auto',
    transport: 'polarized',
    transportView: 'all',
    maxInterfaces: 6,
    minContribution: 1e-4,
    background: 'white',
  };
const cross = (a, b) => [
  C.sub(C.mul(a[1], b[2]), C.mul(a[2], b[1])),
  C.sub(C.mul(a[2], b[0]), C.mul(a[0], b[2])),
  C.sub(C.mul(a[0], b[1]), C.mul(a[1], b[0])),
];
const mat = (A, v) => A.map((row) => row.reduce((s, x, i) => C.add(s, C.scale(v[i], x)), [0, 0]));
let maxFlux = 0,
  maxMaxwell = 0;
for (const material of ['shear', 'molded2013Transform', 'hyperbolic', 'eng2013Magnetic'])
  for (let i = 0; i < 100; i++) {
    const c = { ...base, material, tilt: i % 45, azimuth: (i * 11) % 180 },
      x = [0.6 * Math.sin(i), 0.5 * Math.cos(i), 0.7 * Math.sin(i * 0.3)],
      local = F.localMaterial(c, x),
      N = O.unit([Math.sin(i * 0.7), Math.cos(i * 0.2), 0.9]),
      [u] = F.basis(N),
      t = O.mul(u, 1.3 * Math.sin(0.3 * i)),
      ext = { ...base, material: 'isotropic', n: 1.5 };
    for (const incident of F.modes(ext, t, N, 1)) {
      const r = F.scatter({ p: incident.p, E: incident.E }, ext, local, N);
      maxFlux = Math.max(maxFlux, r.error);
      assert.ok(r.error < 2e-7);
    }
    for (const f of F.modes(local, t, N, 1)) {
      let eps = local.tensor || local.epsilonTensor;
      if (material === 'hyperbolic') {
        const axes = O.principalAxes(local),
          d = [-(local.no ** 2), -(local.no ** 2), local.ne ** 2];
        eps = [0, 1, 2].map((i) =>
          [0, 1, 2].map((j) => d.reduce((s, v, k) => s + v * axes[k][i] * axes[k][j], 0)),
        );
      }
      const residual = cross(f.k, f.H).map((v, i) => C.add(v, mat(eps, f.E)[i]));
      const e = Math.hypot(...residual.map(C.abs));
      maxMaxwell = Math.max(maxMaxwell, e);
      assert.ok(e < 1e-9, `${material} Maxwell ${e}`);
      if (['hyperbolic', 'eng2013Magnetic'].includes(material) && f.mode === 0) assert.ok(!f.prop);
      if (f.prop) {
        const S = cross(f.E, f.H.map(C.conj)).map((z) => z[0]),
          v = O.velocity(x, f.p, c, f.mode);
        assert.ok(O.norm(O.add(O.unit(S), O.mul(O.unit(v), -1))) < 1e-8);
      }
    }
  }
console.log(
  'PASS 800 polarized interface solves and 800 Maxwell fields including evanescent signed-epsilon modes',
  { maxFlux, maxMaxwell },
);
for (const material of ['shear', 'molded2013Transform', 'hyperbolic', 'eng2013Magnetic'])
  for (const shape of ['sphere', 'cube', 'torus'])
    for (const sign of [-1, 1]) {
      const c = { ...base, material, shape, backgroundZ: 3 * sign },
        o = [shape === 'torus' ? 0.62 : 0.1, 0.05, -4 * sign],
        r = F.trace(o, O.unit([0.03, 0.01, sign]), c);
      assert.equal(r.status, 'ok', JSON.stringify({ material, shape, sign, message: r.message }));
      near(r.accounted, 1);
      near(F.decode(r.color[0]), r.weightSum);
      assert.equal(r.internalBranches, 0);
      const ignored = F.trace(o, O.unit([0.03, 0.01, sign]), {
        ...c,
        branchPolicy: 'planes',
        branchPlanes: '0',
        branchDepth: 3,
      });
      assert.deepEqual(r.color, ignored.color);
    }
const normReflection = F.trace([0, 0, 4], [0, 0, -1], {
  ...base,
  material: 'hyperbolic',
  shape: 'cube',
});
assert.equal(normReflection.status, 'ok', normReflection.message);
near(normReflection.channels.reflected, 1);
near(normReflection.channels.e, 0);
const transmitted = F.trace([-3, 0, 4], O.unit([1, 0, -1]), {
  ...base,
  material: 'hyperbolic',
  shape: 'cube',
  outsideN: 2.5,
});
assert.equal(transmitted.status, 'ok', transmitted.message);
assert.ok(transmitted.channels.e > 0);
near(transmitted.channels.o, 0);
near(transmitted.accounted, 1);
// Matched shear slab: no physical reflection, exactly unit total throughput.
const shear = F.trace([0.1, 0.03, 4], O.unit([0.03, 0.01, -1]), {
  ...base,
  material: 'shear',
  shape: 'cube',
});
near(shear.dropped, 0);
near(shear.weightSum, 1);
assert.equal(shear.reflections, 0);
assert.throws(
  () => F.validate({ ...base, material: 'molded2013Transform', n: 0.1, gradient: 0.5 }),
  /正定値/,
);
assert.throws(() => F.validate({ ...base, material: 'hyperbolic', gradient: 1 }), /scale/);
console.log(
  'PASS 24 finite-shape white-radiance balances, signed-epsilon normal-incidence reflection, extraordinary transmission and no invented second trajectory',
);

// Independent constraint: both the virtual covector and Maxwell transversality persist through a curved physical path.
const transpose = (A) => A[0].map((_, i) => A.map((row) => row[i]));
let virtualError = 0,
  transportResidual = 0;
for (const material of ['shear', 'molded2013Transform'])
  for (const shape of ['sphere', 'cube', 'torus']) {
    const c = { ...base, material, shape },
      o = [shape === 'torus' ? 0.62 : 0.1, 0.05, 4],
      d = O.unit([0.02, 0.01, -1]),
      x = O.hit(o, d, shape),
      p = O.boundary(x, d, O.normal(x, shape), c, 1, true),
      local = F.localMaterial(c, x),
      a = F.fields(F.cv(p), local, 0).E,
      b = F.fields(F.cv(p), local, 1).E,
      E = a.map((v, i) => C.add(v, C.mul([0, 1], b[i]))),
      packet = F.launch(x, { p, E, mode: 0 }, c, { drift: 0 }),
      end = F.propagate(packet, c),
      localEnd = F.localMaterial(c, end.o);
    const initialVirtual = O.mv(O.inv(transpose(F.jacobian(c, x))), p),
      endVirtual = O.mv(O.inv(transpose(F.jacobian(c, end.o))), end.p);
    virtualError = Math.max(virtualError, O.norm(O.add(initialVirtual, O.mul(endVirtual, -1))));
    const H = F.magnetic(F.cv(end.p), end.E, localEnd),
      epsE = mat(localEnd.tensor, end.E),
      res = cross(F.cv(end.p), H).map((v, i) => C.add(v, epsE[i]));
    transportResidual = Math.max(transportResidual, Math.hypot(...res.map(C.abs)));
  }
assert.ok(virtualError < 1e-8 && transportResidual < 1e-8);
console.log('PASS coordinate mapping invariants and transported complex polarization', {
  virtualError,
  transportResidual,
});
