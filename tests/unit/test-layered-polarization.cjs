const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const O = require('../../app/optics.js');
for (const f of ['analytical', 'schur', 'homogeneous', 'branching', 'polarization', 'layered'])
  require('../../app/' + f + '.js');
const F = O.polarization,
  L = F.layered,
  C = globalThis.Polynomial.C,
  near = (a, b, t = 2e-9) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const base = {
  ...O.defaults,
  transport: 'polarized',
  material: 'heliconical',
  shape: 'cube',
  tilt: 60,
  twist: 1,
  branchModel: 'layers',
  branchPolicy: 'planes',
  branchPlanes: '-.5,0,.5',
  branchDepth: 8,
  maxInterfaces: 6,
  background: 'white',
  minContribution: 1e-5,
};
const J = [
    [
      [1, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [1, 0],
    ],
  ],
  M = L.jonesMueller(J);
M.forEach((row, i) => row.forEach((x, j) => near(x, i === j ? 1 : 0)));
const a = 0.31,
  rot = [
    [
      [Math.cos(a), 0],
      [-Math.sin(a), 0],
    ],
    [
      [Math.sin(a), 0],
      [Math.cos(a), 0],
    ],
  ],
  s = L.applyMueller(L.jonesMueller(rot), [1, 1, 0, 0]);
near(s[0], 1);
near(s[1], Math.cos(2 * a));
near(s[2], Math.sin(2 * a));
near(s[3], 0);
const quarter = [
    [
      [1, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [0, 1],
    ],
  ],
  qs = L.applyMueller(L.jonesMueller(quarter), [1, 0, 1, 0]);
near(qs[0], 1);
near(qs[2], 0);
near(qs[3], 1);
// Mueller/coherency equality for partially polarized and elliptical inputs, no
// implementation-specific ray expectations: compare against direct J rho J*.
for (let k = 0; k < 30; k++) {
  const J = Array.from({ length: 2 }, (_, i) =>
      Array.from({ length: 2 }, (_, j) => [Math.sin(k + i * 2 + j), 0.3 * Math.cos(k - i + j)]),
    ),
    S = [1, 0.3 * Math.cos(k), 0.2 * Math.sin(k), 0.4];
  const out = L.applyMueller(L.jonesMueller(J), S),
    rho = L.coherency(S),
    r = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => [0, 0]));
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++)
      for (let m = 0; m < 2; m++)
        for (let n = 0; n < 2; n++)
          r[i][j] = C.add(r[i][j], C.mul(C.mul(J[i][m], rho[m][n]), C.conj(J[j][n])));
  L.stokes(r).forEach((v, i) => near(v, out[i]));
  assert.ok(out[0] >= Math.hypot(...out.slice(1)) - 1e-12);
}
// Independent normal-incidence Fresnel/polarizer formula: input E along x,
// receiver's optic axis in xy at 37 deg. Project onto axis and its perpendicular.
const air = { ...base, material: 'isotropic', n: 1 },
  crystal = { ...base, material: 'uniaxial', tilt: 90, azimuth: 37, no: 1.65, ne: 1.49 };
let inc = F.modes(air, [0, 0, 0], [0, 0, 1], 1)[0],
  r = L.scatter(inc, air, crystal, [0, 0, 1]);
for (const mode of [0, 1]) {
  const proj =
      mode === 0 ? Math.sin((37 * Math.PI) / 180) ** 2 : Math.cos((37 * Math.PI) / 180) ** 2,
    n = mode === 0 ? crystal.no : crystal.ne;
  near(
    r.children.find((ch) => !ch.reflection && ch.mode === mode).weight,
    (proj * 4 * n) / (1 + n) ** 2,
  );
}
// Identical layers: no reflection or change of mode. Oblique reciprocal
// scattering: independently solve tangent E/H for a physical incident eigenfield.
let maxError = 0,
  maxReciprocity = 0,
  maxBoundary = 0;
for (let k = 0; k < 32; k++) {
  const from = { ...crystal, tilt: 15 + k * 2, azimuth: k * 11 },
    to = { ...from, no: 1.35 + 0.005 * k, ne: 1.7, azimuth: k * 7 + 32 },
    N = [0, 0, k % 2 ? 1 : -1],
    t = [0.25 * Math.sin(k), 0.3 * Math.cos(k), 0];
  for (const inc of F.modes(from, t, N, 1)) {
    const same = L.scatter(inc, from, from, N);
    near(
      same.children
        .filter((ch) => !ch.reflection && ch.mode === inc.mode)
        .reduce((s, ch) => s + ch.weight, 0),
      1,
    );
    assert.ok(
      same.children
        .filter((ch) => ch.reflection || ch.mode !== inc.mode)
        .reduce((s, ch) => s + ch.weight, 0) < 1e-12,
    );
    const r = L.scatter(inc, from, to, N),
      ref = F.scatter(inc, from, to, N);
    maxError = Math.max(maxError, r.error);
    maxBoundary = Math.max(maxBoundary, r.residual);
    for (const ch of r.children) {
      near(
        ch.weight,
        ref.children.find((q) => q.mode === ch.mode && q.reflection === ch.reflection)?.weight || 0,
      );
      if (ch.reflection) continue;
      const reverse = { ...ch, p: O.mul(ch.p, -1) },
        rev = L.scatter(reverse, to, from, O.mul(N, -1)),
        w = rev.children.find((q) => !q.reflection && q.mode === inc.mode)?.weight || 0;
      maxReciprocity = Math.max(maxReciprocity, Math.abs(w - ch.weight));
      near(w, ch.weight, 2e-8);
    }
  }
}
// All propagating power remains reflected under TIR; evanescent outputs are
// included in the boundary solve, never represented as power-carrying rays.
const hi = { ...crystal, no: 1.8, ne: 1.6, tilt: 40 },
  lo = { ...crystal, no: 1.1, ne: 1.05 },
  N = [0, 0, 1];
for (const inc of F.modes(hi, [1.3, 0, 0], N, 1)) {
  const r = L.scatter(inc, hi, lo, N);
  near(
    r.children.reduce((s, ch) => s + ch.weight, 0),
    1,
  );
  assert.ok(r.children.every((ch) => ch.reflection));
}
// Oblique high-index input with only one propagating input channel also works.
let oneChannel = 0;
for (const k of [1.35, 1.45, 1.55]) {
  const from = { ...crystal, no: 1.7, ne: 1.2, tilt: 90, azimuth: 90 },
    to = { ...from, no: 1.6, ne: 1.1, azimuth: 30 };
  for (const inc of F.modes(from, [k, 0, 0], N, 1).filter((f) => f.prop)) {
    const r = L.scatter(inc, from, to, N);
    near(
      r.children.reduce((s, ch) => s + ch.weight, 0),
      1,
    );
    oneChannel++;
  }
}
// Rendering invariants across positive z-dependent models, shapes and views.
const records = [];
for (const material of ['heliconical', 'common', 'quadratic', 'axial2013Uniaxial'])
  for (const shape of ['cube', 'sphere', 'torus'])
    for (const sign of [-1, 1]) {
      const c = {
          ...base,
          material,
          shape,
          gradient: 0.15,
          branchDebug: true,
          backgroundZ: 3 * sign,
        },
        o = shape === 'torus' ? [0.7, 0.04, -4 * sign] : [0.1, 0.05, -4 * sign],
        d = O.unit([0.03, 0.01, sign]),
        r = F.trace(o, d, c);
      assert.equal(r.status, 'ok', `${material}/${shape}: ${r.message}`);
      near(r.accounted, 1, 3e-8);
      assert.ok(r.internalBranches > 0);
      assert.ok(r.maxInternalDepth <= 8);
      r.color.forEach((v) => near(F.decode(v), r.weightSum, 3e-8));
      for (const ev of r.events) {
        near(
          ev.children.reduce((s, ch) => s + ch.weight, 0),
          1,
        );
        assert.ok(ev.position[2] >= -1.01 && ev.position[2] <= 1.01);
      }
      records.push({
        material,
        shape,
        sign,
        internalBranches: r.internalBranches,
        dropped: r.dropped,
        fluxError: r.fluxError,
      });
    }
const o = [0.1, 0.05, 4],
  d = [0, 0, -1],
  coarse = F.trace(o, d, { ...base, branchDebug: true, step: 0.1, solver: 'rkf45' }),
  fine = F.trace(o, d, { ...base, branchDebug: true, step: 0.005, solver: 'schur' });
assert.deepEqual(coarse, fine);
assert.ok(
  coarse.events.some((ev) =>
    ev.children.some(
      (ch) =>
        !ch.reflection &&
        ch.mode !== ev.parentMode &&
        ch.weight > 0.01 &&
        Math.abs(ch.weight - 0.5) > 0.05,
    ),
  ),
);
assert.ok(coarse.events.some((ev) => ev.children.some((ch) => ch.reflection && ch.weight > 1e-6)));
// Recrossings must not be suppressed by the old 'visited plane once' rule.
assert.ok(coarse.events.some((ev) => ev.depth > 3));
const shallow = F.trace(o, d, { ...base, branchDepth: 1 }),
  deep = F.trace(o, d, base),
  zero = F.trace(o, d, { ...base, branchDepth: 0 });
assert.ok(shallow.layerLimitWeight > 0.5);
assert.ok(deep.layerLimitWeight < shallow.layerLimitWeight);
near(shallow.accounted, 1);
near(zero.accounted, 1);
assert.equal(zero.internalBranches, 0);
assert.ok(zero.layerLimitWeight > 0.8);
const off = F.trace(o, d, { ...base, branchPolicy: 'off' }),
  original = F.trace(o, d, { ...base, branchPolicy: 'off', branchModel: 'equal' });
assert.deepEqual(off, original);
for (const c of [
  { ...base, material: 'uniaxial' },
  { ...base, tilt: 0 },
  { ...base, twist: 0 },
]) {
  assert.equal(L.enabled(c), false);
  assert.equal(F.trace(o, d, c).internalBranches, 0);
}
assert.throws(() => F.validate({ ...base, branchPlanes: '-1,1,2' }), /内部/);
assert.throws(() => F.validate({ ...base, branchPlanes: '0,0.0000001' }), /厚さ/);
const out = path.join(__dirname, '../../test-results/unit', 'internal-layers-20260917');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'kernel-validation.json'),
  JSON.stringify(
    {
      maxError,
      maxReciprocity,
      maxBoundary,
      oneChannel,
      records,
      demoEvent: coarse.events[0],
      demo: {
        dropped: deep.dropped,
        layerLimitWeight: deep.layerLimitWeight,
        accounted: deep.accounted,
      },
    },
    null,
    2,
  ),
);
console.log(
  'PASS Mueller identity/rotator/retarder/coherency; independent Fresnel limit; equal-layer identity; 64 oblique interfaces vs direct Maxwell; reciprocity; TIR/evanescence; 24 render rays; energy and cutoff bookkeeping; real recrossings; integration-step independence; old smooth/1:1 routing.',
);
console.log({ maxError, maxReciprocity, maxBoundary, oneChannel });
