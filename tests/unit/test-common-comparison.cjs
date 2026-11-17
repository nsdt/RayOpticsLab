const O = require('../../app/optics.js');
for (const n of ['analytical', 'schur', 'homogeneous', 'polarization'])
  require('../../app/' + n + '.js');
const F = O.polarization,
  assert = require('assert/strict'),
  fs = require('fs'),
  path = require('path');
const c = {
  ...O.defaults,
  material: 'common',
  shape: 'cube',
  no: 1.6557,
  ne: 1.4852,
  tilt: 35,
  azimuth: 25,
  yaw: 12,
  pitch: 0,
  projection: 'ortho',
  transport: 'polarized',
  solver: 'auto',
  gradient: 0.18,
  maxInterfaces: 4,
};
const dist = (a, b) => O.norm(O.add(a, O.mul(b, -1))),
  { eye, forward, right, up } = O.cameraFrame(c);
function entry(c, mode, u = 0.12, v = 0.07) {
  const o = O.add(eye, O.add(O.mul(right, u), O.mul(up, v))),
    x = O.hit(o, forward, c.shape),
    p = O.boundary(x, forward, O.normal(x, c.shape), c, mode);
  return {
    o,
    d: forward,
    packet: F.launch(x, { p, E: F.fields(F.cv(p), F.localMaterial(c, x), mode).E, mode }, c, {
      drift: 0,
    }),
  };
}
function exit(c, mode, u, v) {
  return F.propagate(entry(c, mode, u, v).packet, c, { drift: 0 });
}
let solverMaxPosition = 0,
  solverMaxMomentum = 0,
  halfMaxPosition = 0,
  halfMaxMomentum = 0,
  smallGradient = [];
for (const mode of [0, 1]) {
  const uniform = exit({ ...c, gradient: 0 }, mode);
  let previous = Infinity;
  for (const gradient of [0.1, 0.01, 0.001]) {
    const e = exit({ ...c, gradient }, mode),
      position = dist(e.o, uniform.o),
      momentum = dist(e.p, uniform.p);
    assert.ok(position < previous);
    previous = position;
    smallGradient.push({ mode, gradient, position, momentum });
  }
  for (const gradient of [0, 0.06, 0.12, 0.18])
    for (const [u, v] of [
      [0.12, 0.07],
      [-0.35, 0.22],
      [0.3, -0.2],
    ]) {
      const local = { ...c, gradient },
        a = exit(local, mode, u, v);
      for (const solver of ['schur', 'rkf45']) {
        const b = exit({ ...local, solver }, mode, u, v),
          h = exit({ ...local, solver, step: c.step / 2 }, mode, u, v);
        solverMaxPosition = Math.max(solverMaxPosition, dist(a.o, b.o));
        solverMaxMomentum = Math.max(solverMaxMomentum, dist(a.p, b.p));
        halfMaxPosition = Math.max(halfMaxPosition, dist(a.o, h.o));
        halfMaxMomentum = Math.max(halfMaxMomentum, dist(a.p, h.p));
      }
    }
}
assert.ok(solverMaxPosition < 1e-6);
assert.ok(solverMaxMomentum < 1e-6);
assert.ok(halfMaxPosition < 1e-6);
assert.ok(halfMaxMomentum < 1e-6);
const balance = [];
for (const gradient of [0, 0.06, 0.12, 0.18]) {
  const p = entry({ ...c, gradient }, 0),
    r = F.trace(p.o, p.d, { ...c, gradient, background: 'white' });
  assert.equal(r.status, 'ok', r.message);
  assert.ok(Math.abs(r.accounted - 1) < 1e-12);
  assert.ok(Math.abs(F.decode(r.color[0]) - (1 - r.dropped)) < 1e-12);
  const a = F.trace(p.o, p.d, { ...c, gradient: 0 }),
    b = F.trace(p.o, p.d, { ...c, material: 'uniaxial' });
  assert.ok(dist(a.color, b.color) < 1e-9);
  balance.push({ gradient, dropped: r.dropped, fluxError: r.fluxError });
}
const result = {
  solverMaxPosition,
  solverMaxMomentum,
  halfMaxPosition,
  halfMaxMomentum,
  smallGradient,
  balance,
};
const out = path.join(__dirname, '../../test-results/unit/common-scale-comparison-20260916');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ray-validation.json'), JSON.stringify(result, null, 2));
console.log(
  'PASS common-scale uniform limit, g→0 continuity, both-mode exits across 3 solvers and half steps, uniform radiance including discarded weight.',
  JSON.stringify(result),
);
