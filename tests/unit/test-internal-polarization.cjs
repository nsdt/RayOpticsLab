const assert = require('node:assert/strict'),
  O = require('../../app/optics.js');
for (const f of ['analytical', 'schur', 'homogeneous', 'branching', 'polarization'])
  require('../../app/' + f + '.js');
const F = O.polarization,
  near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`),
  dist = (a, b) => O.norm(O.add(a, O.mul(b, -1)));
const base = {
  ...O.defaults,
  untracedTolerance: 0,
  shape: 'cube',
  solver: 'auto',
  transport: 'polarized',
  transportView: 'all',
  maxInterfaces: 4,
  minContribution: 1e-5,
  branchPolicy: 'off',
  background: 'white',
};
// The new realization adds a constitutive assumption; it does not reinterpret the old item.
for (const gradient of [-0.3, 0.2])
  for (const z of [-0.9, 0, 0.8])
    for (const mode of [0, 1]) {
      const c = { ...base, material: 'axial2013Uniaxial', gradient },
        x = [0.1, 0.2, z],
        local = F.localMaterial(c, x),
        g = O.metric(x, c, mode),
        gl = O.metric(x, local, mode);
      g.flat().forEach((v, i) => near(v, gl.flat()[i], 1e-13));
      if (mode === 1) assert.deepEqual(g, O.metric(x, { ...c, material: 'axial2013' }, 1));
      const p = O.boundary(x, [0.2, 0.1, 0], [0, 0, 1], c, mode, false),
        field = F.fields(F.cv(p), local, mode),
        E = field.E.map((z) => z[0]),
        epsE = [local.no ** 2 * E[0], local.no ** 2 * E[1], E[2]],
        res = O.add(O.cross(p, O.cross(p, E)), epsE);
      assert.ok(O.norm(res) < 1e-12);
      assert.ok(
        dist(
          O.unit(
            O.cross(
              E,
              field.H.map((z) => z[0]),
            ),
          ),
          O.unit(O.velocity(x, p, c, mode)),
        ) < 1e-12,
      );
    }
function reference(packet, c) {
  let s = [...packet.o, ...packet.p];
  for (let i = 0; i < 60000; i++) {
    const h = 0.0004 / O.norm(O.velocity(s.slice(0, 3), s.slice(3), c, packet.mode)),
      next = O.rkf45(s, h, c, packet.mode);
    if (O.sdf(next.slice(0, 3), c.shape) >= 0) {
      let lo = 0,
        hi = h;
      for (let j = 0; j < 30; j++) {
        const t = (lo + hi) / 2,
          q = O.rkf45(s, t, c, packet.mode);
        if (O.sdf(q.slice(0, 3), c.shape) < 0) lo = t;
        else hi = t;
      }
      return O.rkf45(s, (lo + hi) / 2, c, packet.mode);
    }
    s = next;
  }
  throw Error('reference did not exit');
}
let maxPosition = 0,
  maxMomentum = 0;
for (const shape of ['sphere', 'cube', 'torus'])
  for (const mode of [0, 1])
    for (const sign of [-1, 1]) {
      const c = { ...base, material: 'axial2013Uniaxial', shape },
        o = [shape === 'torus' ? 0.62 : 0.1, 0.05, -4 * sign],
        d = O.unit([0.015, 0.01, sign]),
        x = O.hit(o, d, shape),
        p = O.boundary(x, d, O.normal(x, shape), c, mode, true);
      const packet = F.launch(
          x,
          { p, mode, E: F.fields(F.cv(p), F.localMaterial(c, x), mode).E },
          c,
          { drift: 0 },
        ),
        a = F.propagate(packet, c),
        b = reference(packet, c);
      maxPosition = Math.max(maxPosition, dist(a.o, b.slice(0, 3)));
      maxMomentum = Math.max(maxMomentum, dist(a.p, b.slice(3)));
      assert.ok(maxPosition < 3e-6 && maxMomentum < 3e-6);
    }
console.log(
  'PASS new axial constitutive Maxwell fields and 12 bulk exits versus fine independent RKF45',
  { maxPosition, maxMomentum },
);
// Every accepted branch has two 0.5 children; weights, mode shell and transverse k are checked.
for (const material of ['axial2013Uniaxial', 'common', 'quadratic', 'heliconical'])
  for (const sign of [-1, 1]) {
    const c = {
        ...base,
        material,
        backgroundZ: sign * 3,
        tilt: 35,
        azimuth: 25,
        branchPolicy: 'planes',
        branchPlanes: '-.3, .3',
        branchDepth: 2,
        branchDebug: true,
      },
      r = F.trace([0.11, 0.05, -4 * sign], O.unit([0.03, 0.01, sign]), c);
    assert.equal(r.status, 'ok', r.message);
    near(r.accounted, 1, 2e-8);
    assert.ok(r.internalBranches > 0);
    assert.equal(r.maxInternalDepth, 2);
    assert.ok(r.fluxError < 2e-7);
    near(F.decode(r.color[0]), r.weightSum, 1e-12);
    assert.ok(
      r.events.every(
        (e) => e.depth <= 2 && [-0.3, 0.3].some((z) => Math.abs(z - e.position[2]) < 1e-12),
      ),
    );
    const x = [0.1, 0.1, 0.3],
      p = O.boundary(x, [0.05, 0.03, 0], [0, 0, 1], c, 1, sign < 0),
      ch = F.splitInternal({ o: x, p, mode: 1 }, c);
    for (const a of ch) {
      assert.ok(a);
      assert.equal(a.weight, 0.5);
      near(a.p[0], p[0], 1e-13);
      near(a.p[1], p[1], 1e-13);
      near(2 * O.H(x, a.p, c, a.mode), 1, 1e-8);
      assert.ok(O.velocity(x, a.p, c, a.mode)[2] * sign > 0);
    }
  }
console.log(
  'PASS four varying media / two directions: actual internal events, 0.5 split, transverse k, dispersion and radiance accounting',
);
for (let depth = 0; depth <= 4; depth++) {
  const c = {
      ...base,
      material: 'axial2013Uniaxial',
      branchPolicy: 'distributed',
      branchStart: -0.8,
      branchEnd: 0.8,
      branchCount: 3,
      branchDepth: depth,
      branchDebug: true,
    },
    r = F.trace([0.1, 0.05, 4], O.unit([0.03, 0.02, -1]), c);
  assert.equal(r.status, 'ok', r.message);
  near(r.accounted, 1);
  assert.equal(r.maxInternalDepth, Math.min(depth, 3));
  assert.equal(r.internalBranches > 0, depth > 0);
}
const c = { ...base, material: 'axial2013Uniaxial', background: 'uv' },
  origin = [0.2, 0.05, 4],
  direction = O.unit([0.04, 0.01, -1]),
  off = F.trace(origin, direction, c),
  zero = F.trace(origin, direction, {
    ...c,
    branchPolicy: 'planes',
    branchPlanes: '0',
    branchDepth: 0,
  }),
  split = F.trace(origin, direction, {
    ...c,
    branchPolicy: 'planes',
    branchPlanes: '-.5,.5',
    branchDepth: 2,
  });
assert.deepEqual(off.color, zero.color);
assert.ok(dist(off.color, split.color) > 1e-4);
const on = {
    ...c,
    branchPolicy: 'planes',
    branchPlanes: '-.5,.5',
    branchDepth: 2,
    branchDebug: true,
  },
  coarse = F.trace(origin, direction, { ...on, step: 0.06 }),
  fine = F.trace(origin, direction, { ...on, step: 0.015 });
assert.equal(coarse.internalBranches, fine.internalBranches);
assert.ok(dist(coarse.color, fine.color) < 2e-5);
const boundary = F.trace(origin, direction, {
  ...c,
  branchPolicy: 'planes',
  branchPlanes: '-1,1,2',
  branchDepth: 4,
});
assert.equal(boundary.internalBranches, 0);
// A real degeneracy at z=0 is permitted in the fixed-axis realization. No invented splitting rate.
const vacuum = F.trace([0, 0, 4], [0, 0, -1], {
  ...base,
  material: 'axial2013Uniaxial',
  gradient: 0,
});
assert.equal(vacuum.status, 'ok', vacuum.message);
near(vacuum.weightSum, 1);
near(vacuum.color[0], 255);
const axial = F.trace([0, 0, 4], [0, 0, -1], {
  ...base,
  material: 'axial2013Uniaxial',
  branchPolicy: 'planes',
  branchPlanes: '0',
  branchDepth: 1,
});
assert.equal(axial.status, 'ok', axial.message);
near(axial.accounted, 1);
// Equal splitting is not silently re-normalized when the target mode is evanescent.
const blocked = {
    ...base,
    material: 'common',
    gradient: 0.1,
    no: 1,
    ne: 2,
    tilt: 0,
    azimuth: 0,
    outsideN: 2,
    branchPolicy: 'planes',
    branchPlanes: '0',
    branchDepth: 1,
  },
  r = F.trace([-2.25, 0, 4], O.unit([0.6, 0, -1]), blocked);
assert.equal(r.status, 'ok', r.message);
assert.ok(r.internalBranches > 0);
assert.ok(r.unavailableWeight > 0);
near(r.accounted, 1);
near(F.decode(r.color[0]), r.weightSum, 1e-12);
for (const material of ['axial2013', 'eng2013', 'molded2013', 'moldedApprox'])
  assert.equal(F.supported({ ...base, material }), false);
console.log(
  'PASS depth caps, actual image change, step check, surface exclusion, degeneracies, explicit non-propagating weight, unsupported exclusion',
  {
    colorDifference: dist(off.color, split.color),
    stepDifference: dist(coarse.color, fine.color),
    unavailable: r.unavailableWeight,
  },
);

// At the axial isotropic plane, keep the limiting TE/TM basis for subsequent varying propagation.
{
  const c = { ...base, material: 'axial2013Uniaxial' },
    local = F.localMaterial(c, [1, 0, 0]),
    ext = { ...base, material: 'isotropic', n: 1 },
    p = O.unit([-0.8, 0, -0.6]),
    a = F.fields(F.cv(p), local, 0).E,
    b = F.fields(F.cv(p), local, 1).E,
    E = a.map((z, i) => [(z[0] + b[i][0]) / Math.SQRT2, 0]),
    r = F.scatter({ p, E }, ext, local, [-1, 0, 0]);
  const T = r.children.filter((c) => !c.reflection);
  assert.equal(T.length, 2);
  T.forEach((c) => near(c.weight, 0.5));
}
console.log('PASS limiting polarization basis at the axial isotropic plane');

let engExitError = 0;
for (const shape of ['cube', 'sphere', 'torus'])
  for (const sign of [-1, 1]) {
    const c = { ...base, material: 'eng2013Magnetic', shape },
      o = [shape === 'torus' ? 0.62 : 0.1, 0.05, -4 * sign],
      d = O.unit([0.025, 0.015, sign]),
      x = O.hit(o, d, shape),
      p = O.boundary(x, d, O.normal(x, shape), c, 1, true),
      packet = F.launch(x, { p, mode: 1, E: F.fields(F.cv(p), F.localMaterial(c, x), 1).E }, c, {
        drift: 0,
      }),
      a = F.propagate(packet, c),
      b = reference(packet, c);
    engExitError = Math.max(engExitError, dist(a.o, b.slice(0, 3)), dist(a.p, b.slice(3)));
    assert.ok(engExitError < 3e-6);
    assert.deepEqual(O.metric(x, c, 1), O.metric(x, { ...c, material: 'eng2013' }, 1));
  }
for (const sign of [-1, 1]) {
  const c = { ...base, material: 'eng2013Magnetic' },
    x = [0.1, 0.1, 0.2],
    p = O.boundary(x, [0.1, 0.1, 0], [0, 0, 1], c, 1, sign < 0),
    s = [...x, ...p];
  let r = s;
  for (let j = 0; j < 100; j++) r = O.rkf45(r, 0.001, c, 1);
  const exact = O.exactAdvance(s, r[2] - s[2], c, 1);
  assert.ok(exact);
  exact.forEach((v, i) => near(v, r[i], 1e-8));
}
console.log(
  'PASS ENG original extraordinary metric, six independent RKF45 exits, special meridional closed form',
  { engExitError },
);
