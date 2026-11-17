const assert = require('node:assert/strict'),
  O = require('../../app/optics.js');
for (const name of ['analytical', 'schur', 'homogeneous', 'branching', 'polarization'])
  require('../../app/' + name + '.js');
const F = O.polarization,
  near = (a, b, t = 2e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b} (tol ${t})`),
  distance = (a, b) => O.norm(O.add(a, O.mul(b, -1)));
const base = {
  ...O.defaults,
  backgroundZ: 3,
  solver: 'auto',
  transport: 'polarized',
  maxInterfaces: 4,
  minContribution: 1e-4,
  no: 1.6557,
  ne: 1.4852,
  gradient: 0.18,
  twist: 1.3,
  tilt: 35,
  azimuth: 25,
};
// The local epsilon representation must reproduce BOTH manuscript ray metrics.
for (const material of ['common', 'quadratic', 'heliconical'])
  for (const z of [-0.9, 0, 0.7])
    for (const mode of [0, 1]) {
      const c = { ...base, material },
        x = [0.1, 0.2, z],
        local = F.localMaterial(c, x),
        A = O.metric(x, c, mode),
        B = O.metric(x, local, mode);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(A[i][j], B[i][j], 1e-12);
    }
// Constant-profile limits agree with the independently retained homogeneous path.
for (const material of ['common', 'quadratic', 'heliconical']) {
  const c = { ...base, material, gradient: 0, twist: 0, shape: 'cube' },
    a = F.trace([0.12, 0.03, -4], O.unit([0.13, 0.02, 1]), c),
    b = F.trace([0.12, 0.03, -4], O.unit([0.13, 0.02, 1]), { ...c, material: 'uniaxial' });
  assert.equal(a.status, 'ok', a.message);
  a.color.forEach((v, i) => near(v, b.color[i], 1e-10));
  near(a.dropped, b.dropped, 1e-12);
}
console.log('PASS local constitutive metrics, all three homogeneous limits.');
// Independent small-step Hamiltonian RKF45 followed to the physical exit surface.
function reference(packet, c) {
  let s = [...packet.o, ...packet.p];
  for (let i = 0; i < 60000; i++) {
    let h = 0.00035 / O.norm(O.velocity(s.slice(0, 3), s.slice(3), c, packet.mode)),
      n = O.rkf45(s, h, c, packet.mode);
    if (O.sdf(n.slice(0, 3), c.shape) >= 0) {
      let lo = 0,
        hi = h;
      for (let j = 0; j < 30; j++) {
        let mid = (lo + hi) / 2,
          q = O.rkf45(s, mid, c, packet.mode);
        if (O.sdf(q.slice(0, 3), c.shape) < 0) lo = mid;
        else hi = mid;
      }
      return O.rkf45(s, (lo + hi) / 2, c, packet.mode);
    }
    s = n;
  }
  throw Error('reference did not exit');
}
let maxPositionError = 0,
  maxMomentumError = 0,
  maxDrift = 0;
for (const material of ['common', 'quadratic', 'heliconical'])
  for (const shape of ['sphere', 'cube', 'torus'])
    for (const mode of [0, 1])
      for (const sign of [1, -1]) {
        const c = { ...base, material, shape },
          o = [shape === 'torus' ? 0.62 : 0.1, 0.06, -sign * 4],
          d = O.unit([0.045, 0, sign]),
          x = O.hit(o, d, shape),
          N = O.normal(x, shape),
          p = O.boundary(x, O.mul(d, 1.12), N, { ...c, outsideN: 1.12 }, mode, true);
        assert.ok(p);
        const local = F.localMaterial(c, x),
          packet = F.launch(x, { p, E: F.fields(F.cv(p), local, mode).E, mode }, c, { drift: 0 });
        const stats = { drift: 0 },
          end = F.propagate(packet, c, stats),
          ref = reference(packet, c),
          pe = distance(end.o, ref.slice(0, 3)),
          ke = distance(end.p, ref.slice(3));
        maxPositionError = Math.max(maxPositionError, pe);
        maxMomentumError = Math.max(maxMomentumError, ke);
        maxDrift = Math.max(maxDrift, stats.drift);
        assert.ok(pe < 3e-6, JSON.stringify({ material, shape, mode, sign, pe }));
        assert.ok(ke < 3e-6);
        near(O.sdf(end.o, shape), 0, 1e-9);
        // Reverse the endpoint along the same bulk eigenmode to recover the entry.
        const rev = F.launch(end.o, { p: O.mul(end.p, -1), E: end.E, mode }, c, { drift: 0 }),
          back = F.propagate(rev, c, { drift: 0 });
        assert.ok(
          distance(back.o, x) < 3e-6,
          JSON.stringify({ material, shape, mode, sign, reverse: distance(back.o, x) }),
        );
      }
console.log('PASS 36 curved exits + reversals against independent RKF45', {
  maxPositionError,
  maxMomentumError,
  maxDrift,
});
for (const material of ['common', 'quadratic', 'heliconical'])
  for (const shape of ['sphere', 'cube', 'torus']) {
    let c = { ...base, material, shape, background: 'white' },
      o = [shape === 'torus' ? 0.62 : 0.1, 0.06, -4],
      r = F.trace(o, O.unit([0.03, 0.01, 1]), c);
    assert.equal(r.status, 'ok', JSON.stringify({ material, shape, ...r }));
    near(r.accounted, 1);
    near(F.decode(r.color[0]), 1 - r.dropped);
    assert.ok(r.bulkSegments > 0 && r.bulkSteps > 0);
    assert.ok(r.fluxError < 1e-8);
    // Depth zero disables internal conversion while retaining prescribed planes.
    let b = F.trace(o, O.unit([0.03, 0.01, 1]), {
      ...c,
      branchPolicy: 'distributed',
      branchCount: 10,
      branchDepth: 0,
    });
    assert.deepEqual(r.color, b.color);
    near(r.dropped, b.dropped);
  }
console.log('PASS uniform radiance, surface flux balance and zero-depth internal branching.');
assert.throws(() => F.validate({ ...base, material: 'common', gradient: 1 }), /特異点/);
assert.throws(() => F.validate({ ...base, material: 'quadratic', gradient: -1 }), /scale/);
assert.throws(() => F.validate({ ...base, material: 'common', ne: base.no }), /縮退/);
assert.throws(() => F.validate({ ...base, material: 'eng2013' }), /対応/);
console.log('PASS domain, degeneracy and unsupported material validation.');
// z turning: the monotone-z closed-form/integral charts must yield to Hamiltonian ODEs.
{
  const c = { ...base, shape: 'cube', material: 'common', gradient: 0.5 },
    o = [-0.9, 0.04, -0.5],
    px = 1.8,
    n = c.no / (1 + c.gradient * o[2]),
    p = [px, 0, Math.sqrt(n * n - px * px)],
    packet = { o, p, mode: 0, E: F.fields(F.cv(p), F.localMaterial(c, o), 0).E };
  O.evaluations = { closed: 0, quadrature: 0, ode: 0, approximate: 0 };
  const end = F.propagate(packet, c, { drift: 0 }),
    ref = reference(packet, c),
    error = distance(end.o, ref.slice(0, 3));
  assert.ok(end.p[2] < 0, 'ray must turn towards negative z');
  assert.ok(O.evaluations.ode > 0);
  assert.ok(error < 2e-6, JSON.stringify({ turningError: error }));
  console.log('PASS actual z turning, ODE fallback and reference exit', error);
}
// A near-surface ray parallel to the cube face used to exhaust the distance-only step budget.
{
  const c = { ...base, shape: 'cube', material: 'common' },
    o = [0.999999, 0, -0.8],
    p = [0, 0, c.no / (1 + c.gradient * o[2])],
    packet = { o, p, mode: 0, E: F.fields(F.cv(p), F.localMaterial(c, o), 0).E },
    stats = { drift: 0 };
  const end = F.propagate(packet, c, stats);
  near(end.o[2], 1, 1e-9);
  assert.ok(stats.bulkSteps < 100);
  console.log('PASS near-face parallel ray', stats.bulkSteps, 'steps');
}
// Non-closed quadratic parameters and a user-requested RKF45 path remain available.
for (const solver of ['auto', 'schur', 'rkf45']) {
  const c = { ...base, shape: 'sphere', material: 'quadratic', gradient: -0.22, solver },
    o = [0.11, 0.06, -4],
    d = O.unit([0.14, 0.01, 1]),
    x = O.hit(o, d, c.shape),
    p = O.boundary(x, d, O.normal(x, c.shape), c, 1, true),
    packet = F.launch(x, { p, mode: 1, E: F.fields(F.cv(p), F.localMaterial(c, x), 1).E }, c, {
      drift: 0,
    });
  const ref = reference(packet, c),
    a = F.propagate(packet, c, { drift: 0 }),
    b = F.propagate(packet, { ...c, step: c.step / 2 }, { drift: 0 });
  assert.ok(distance(a.o, ref.slice(0, 3)) < 2e-6);
  assert.ok(distance(b.o, ref.slice(0, 3)) < 2e-6);
  console.log('PASS quadratic numerical exit', solver, {
    coarse: distance(a.o, ref.slice(0, 3)),
    fine: distance(b.o, ref.slice(0, 3)),
  });
}
