const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  O = require('../../app/optics.js');
for (const f of [
  'analytical',
  'schur',
  'homogeneous',
  'branching',
  'polarization',
  'layered',
  'modal',
])
  require('../../app/' + f + '.js');
const F = O.polarization,
  M = F.modal,
  C = globalThis.Polynomial.C,
  near = (a, b, t = 2e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const base = {
  ...O.defaults,
  transport: 'polarized',
  material: 'heliconical',
  shape: 'cube',
  tilt: 60,
  azimuth: 0,
  twist: 1,
  gradient: 0.18,
  solver: 'auto',
  branchPolicy: 'planes',
  branchPlanes: '-.5,0,.5',
  branchDepth: 3,
  branchModel: 'modal',
  maxInterfaces: 4,
  background: 'white',
  branchDebug: true,
};
let maxHelicalError = 0,
  maxProjectionError = 0,
  maxPositionError = 0,
  maxPowerError = 0;
// Independent analytic coefficient at k_perp=0 for rotating, constant-index axes.
for (const sign of [-1, 1])
  for (const tilt of [15, 35, 60, 85])
    for (const z of [-0.8, 0.2, 0.7]) {
      const c = { ...base, tilt, twist: 1.7, azimuth: 21 },
        t = (tilt * Math.PI) / 180,
        n = (c.no * c.ne) / Math.sqrt(c.no ** 2 * Math.sin(t) ** 2 + c.ne ** 2 * Math.cos(t) ** 2),
        g = sign * 0.5 * (Math.sqrt(c.no / n) + Math.sqrt(n / c.no)) * c.twist;
      const numeric = M.connection(z, [0, 0], c, sign);
      maxHelicalError = Math.max(maxHelicalError, Math.abs(numeric - g));
      near(numeric, g, 3e-8);
      const tr = M.transfer(-0.4, 0.7, [0, 0], c, sign);
      near(tr.angle, 1.1 * g);
      assert.equal(tr.method, 'closed');
      for (const mode of [0, 1]) {
        const out = F.layered.applyMueller(tr.M, [1, mode === 0 ? 1 : -1, 0, 0]);
        near(out[0], 1);
        near((out[0] + (mode === 0 ? -1 : 1) * out[1]) / 2, Math.sin(g * 1.1) ** 2);
      }
    }
// Independent full forward/backward tangential Maxwell basis inversion gives
// the same projected connection as the Poynting bilinear form implementation.
for (const material of ['heliconical', 'common', 'quadratic'])
  for (const sign of [-1, 1])
    for (let j = 0; j < 4; j++) {
      const c = { ...base, material, azimuth: 13, tilt: 35 },
        z = -0.5 + j * 0.3,
        k = [0.1 + j * 0.06, 0.13],
        h = 5e-6,
        N = [0, 0, sign];
      const loc = F.localMaterial(c, [0, 0, z]),
        forward = M.frame(z, k, c, sign),
        back = F.modes(loc, [...k, 0], N, -1).map((f) => ({
          E: f.E.map((v) => v[0] / Math.sqrt(-f.F)),
          H: f.H.map((v) => v[0] / Math.sqrt(-f.F)),
        }));
      const columns = [...forward, ...back].map((f) =>
          [f.E[0], f.E[1], f.H[0], f.H[1]].map((v) => [v, 0]),
        ),
        A = [0, 1, 2, 3].map((i) => columns.map((col) => col[i]));
      const left = M.frame(z - h, k, c, sign),
        right = M.frame(z + h, k, c, sign);
      let coeff = [];
      for (let i = 0; i < 2; i++) {
        const v = {
          E: right[i].E.map((x, j) => (x - left[i].E[j]) / (2 * h)),
          H: right[i].H.map((x, j) => (x - left[i].H[j]) / (2 * h)),
        };
        coeff[i] = F.solve(
          A,
          [v.E[0], v.E[1], v.H[0], v.H[1]].map((x) => [x, 0]),
        );
      }
      const g = 0.5 * (coeff[0][1][0] - coeff[1][0][0]),
        got = M.connection(z, k, c, sign);
      maxProjectionError = Math.max(maxProjectionError, Math.abs(g - got));
      near(g, got, 8e-8);
      const tr = M.transfer(-0.5, 0.5, k, c, sign),
        reverse = M.transfer(
          0.5,
          -0.5,
          k.map((x) => -x),
          c,
          -sign,
        );
      near(Math.sin(tr.angle) ** 2, Math.sin(reverse.angle) ** 2, 1e-7);
      let sum = 0,
        n = 400;
      for (let i = 0; i <= n; i++)
        sum += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * M.connection(-0.5 + i / n, k, c, sign);
      near(tr.angle, sum / (3 * n), 3e-6);
    }
// A fixed axial director cannot mix TE/TM; same for normal-incidence common scales.
for (const material of ['axial2013Uniaxial', 'common', 'quadratic'])
  for (const sign of [-1, 1]) {
    const c = { ...base, material },
      k = material === 'axial2013Uniaxial' ? [0.2, 0.1] : [0, 0],
      tr = M.transfer(-0.8, 0.8, k, c, sign);
    near(tr.angle, 0, 1e-14);
  }
// Geometry up to a prescribed node is IDENTICAL to the old continuous solver.
for (const material of ['heliconical', 'common', 'quadratic', 'axial2013Uniaxial'])
  for (const mode of [0, 1]) {
    const c = { ...base, material, branchPlanes: '0' },
      o = [0.05, 0.03, 0.8],
      p = O.boundary(o, [0, 0, 0], [0, 0, 1], c, mode, true),
      packet = {
        o,
        p,
        E: F.fields(F.cv(p), F.localMaterial(c, o), mode).E,
        mode,
        internalDepth: 0,
        visited: [],
      };
    O.evaluations = { closed: 0, quadrature: 0, ode: 0, approximate: 0, layered: 0 };
    const at = F.propagate(packet, c),
      old = F.propagate(packet, { ...c, branchModel: 'equal' });
    assert.deepEqual(at, old);
    assert.equal(O.evaluations.layered, 0);
    const exact = O.exactAdvance([...o, ...p], -0.8, c, mode);
    if (exact) {
      const err = O.norm(O.add(at.o, O.mul(exact.slice(0, 3), -1)));
      maxPositionError = Math.max(maxPositionError, err);
      assert.ok(err < 2e-9);
    }
    const children = F.splitInternal(at, c);
    near(
      children.reduce((s, ch) => s + ch.weight, 0),
      1,
    );
    for (const ch of children) {
      near(ch.p[0], p[0]);
      near(ch.p[1], p[1]);
      near(2 * O.H(at.o, ch.p, c, ch.mode), 1);
    }
    if (material === 'axial2013Uniaxial') {
      assert.equal(children.length, 1);
      assert.equal(children[0].mode, mode);
      near(children[0].weight, 1);
    }
  }
// Use a varying/curved ray whose local direction differs from the tangent line.
{
  const c = { ...base, branchPlanes: '0' },
    o = [0, 0, 0.8],
    p = O.boundary(o, [0, 0, 0], [0, 0, 1], c, 1, true),
    end = O.exactAdvance([...o, ...p], -0.8, c, 1),
    v = O.velocity(o, p, c, 1),
    straight = O.add(o, O.mul(v, -0.8 / v[2]));
  assert.ok(O.norm(O.add(end.slice(0, 3), O.mul(straight, -1))) > 0.01);
}
const rays = [];
for (const material of ['heliconical', 'common', 'quadratic', 'axial2013Uniaxial'])
  for (const sign of [-1, 1]) {
    const c = { ...base, material, backgroundZ: sign * 3 },
      o = [0.05, 0.04, -4 * sign],
      d = [0, 0, sign];
    O.evaluations = { closed: 0, quadrature: 0, ode: 0, approximate: 0, layered: 0 };
    const r = F.trace(o, d, c);
    assert.equal(r.status, 'ok', r.message);
    near(r.accounted, 1, 1e-8);
    r.color.forEach((v) => near(F.decode(v), r.weightSum));
    maxPowerError = Math.max(maxPowerError, Math.abs(r.accounted - 1));
    assert.ok(r.modalClosed > 0);
    assert.equal(O.evaluations.layered, 0);
    assert.ok(O.evaluations.closed > 0);
    assert.ok(r.maxInternalDepth <= 3);
    for (const ev of r.events)
      near(
        ev.weights.reduce((s, w) => s + w, 0),
        1,
      );
    rays.push({
      material,
      sign,
      modalClosed: r.modalClosed,
      modalQuadrature: r.modalQuadrature || 0,
      dropped: r.dropped,
      evaluations: { ...O.evaluations },
    });
    const numeric = F.trace(o, d, { ...c, solver: 'rkf45', step: 0.01 });
    assert.equal(numeric.status, 'ok', numeric.message);
    r.color.forEach((v, i) => near(v, numeric.color[i], 5e-5));
  }
// Reversing at the actual surface permits later visits to an earlier node.
const c = { ...base, branchPlanes: '0', branchDepth: 3 },
  r = F.trace([0.1, 0.1, 4], [0, 0, -1], c);
assert.ok(r.events.some((ev) => ev.depth > 1));
const zero = F.trace([0.1, 0.1, 4], [0, 0, -1], { ...c, branchDepth: 0 }),
  off = F.trace([0.1, 0.1, 4], [0, 0, -1], { ...c, branchPolicy: 'off' });
assert.deepEqual(zero, off);
assert.ok(M.integrate((x) => Math.sin(4 * x), 0, 1).error < 2e-6);
near(M.integrate((x) => Math.sin(4 * x), 0, 1).value, (1 - Math.cos(4)) / 4, 2e-6);
const curved = [];
for (const material of ['heliconical', 'common', 'quadratic', 'axial2013Uniaxial'])
  for (const shape of ['sphere', 'torus']) {
    const c = {
        ...base,
        material,
        shape,
        tilt: 35,
        gradient: 0.1,
        twist: 0.5,
        branchPlanes: '-.3,.3',
        branchDepth: 2,
      },
      r = F.trace(
        shape === 'sphere' ? [0.1, 0.1, 4] : [0.7, 0.04, 4],
        O.unit([0.01, 0.005, -1]),
        c,
      );
    assert.equal(r.status, 'ok', r.message);
    near(r.accounted, 1);
    curved.push({
      material,
      shape,
      modalClosed: r.modalClosed || 0,
      modalQuadrature: r.modalQuadrature || 0,
      accounted: r.accounted,
    });
  }
const out = path.join(__dirname, '../../test-results/unit', 'continuous-modal-20260917');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'kernel-validation.json'),
  JSON.stringify(
    {
      maxHelicalError,
      maxProjectionError,
      maxPositionError,
      maxPowerError,
      rays,
      curved,
      event: r.events[0],
    },
    null,
    2,
  ),
);
console.log(
  'PASS analytic helical mixing, full Maxwell basis projection, modal flux norm, interval reversal, independent fine quadrature, fixed-axis zero mixing, exact geometry preserved, non-straight trajectory, branch weights/dispersion, closed vs RKF45 rays, return crossings, depth zero.',
);
console.log({ maxHelicalError, maxProjectionError, maxPositionError, maxPowerError });
