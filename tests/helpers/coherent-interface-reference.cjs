/* Independent laboratory-field single-pass reference. Entry and exit interfaces
 * are solved from tangential E/H continuity. Bulk is the independent continuous
 * four-field Maxwell solution. External-surface round trips are excluded on both
 * sides of the comparison; this is not a complete Fabry-Perot calculation. */
const ref = require('../helpers/coherent-general-reference.cjs'),
  C = require('../../app/polynomial.js').C;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  unit = (a) => a.map((v) => v / Math.hypot(...a));
function external(k, n, sign) {
  const p = [...k, sign * Math.sqrt(n * n - dot(k, k))],
    d = unit(p),
    s = unit(cross(d, Math.abs(d[2]) < 0.85 ? [0, 0, 1] : [0, 1, 0]));
  return [s, cross(d, s)].map((E) => {
    const H = cross(p, E),
      flux = 0.5 * (E[0] * H[1] - E[1] * H[0]),
      q = 1 / Math.sqrt(Math.abs(flux));
    return [E[0], E[1], H[0], H[1]].map((v) => [v * q, 0]);
  });
}
function solve(A, b) {
  const M = A.map((row, i) => [...row.map((z) => z.slice()), b[i].slice()]);
  for (let k = 0; k < 4; k++) {
    let p = k;
    for (let i = k + 1; i < 4; i++) if (C.abs(M[i][k]) > C.abs(M[p][k])) p = i;
    [M[k], M[p]] = [M[p], M[k]];
    for (let i = k + 1; i < 4; i++) {
      const q = C.div(M[i][k], M[k][k]);
      for (let j = k; j < 5; j++) M[i][j] = C.sub(M[i][j], C.mul(q, M[k][j]));
    }
  }
  const x = [];
  for (let i = 3; i >= 0; i--) {
    let q = M[i][4];
    for (let j = i + 1; j < 4; j++) q = C.sub(q, C.mul(M[i][j], x[j]));
    x[i] = C.div(q, M[i][i]);
  }
  return x;
}
function surface(I, R, T) {
  const columns = [...T, ...R.map((v) => v.map((z) => C.scale(z, -1)))],
    A = [0, 1, 2, 3].map((i) => columns.map((v) => v[i])),
    sol = I.map((v) => solve(A, v));
  return {
    JT: [0, 1].map((i) => sol.map((v) => v[i])),
    JR: [2, 3].map((i) => sol.map((v) => v[i])),
  };
}
const multiply = (A, B) =>
  A.map((row) => [0, 1].map((j) => row.reduce((s, z, k) => C.add(s, C.mul(z, B[k][j])), [0, 0])));
function onePass(c, k, sign, n = 32768) {
  const z0 = -sign,
    z1 = sign,
    ext = external(k, c.outsideN, sign),
    back = external(k, c.outsideN, -sign),
    entry = surface(ext, back, ref.port(z0, c, sign, k)),
    exit = surface(ref.port(z1, c, sign, k), ref.port(z1, c, -sign, k), ext),
    bulk = ref.scatter(c, n, sign, k),
    Jbulk = [0, 1].map((i) => bulk.map((v) => v.amplitudes[i])),
    J = multiply(exit.JT, multiply(Jbulk, entry.JT));
  return { J, entry, exit, bulk, Jbulk };
}
module.exports = { external, surface, onePass, multiply };
