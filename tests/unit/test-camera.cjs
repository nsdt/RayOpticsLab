const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path'),
  O = require('../../app/optics.js');
const near = (a, b, t = 1e-12) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
for (const yaw of [-30, 0, 30])
  for (const pitch of [-20, 0, 20]) {
    const f = O.cameraFrame({ ...O.defaults, yaw, pitch });
    assert.ok(f.eye[2] > 0);
    near(O.dot(O.cross(f.right, f.up), O.mul(f.forward, -1)), 1);
    near(O.dot(f.right, f.up), 0);
  }
const front = O.cameraFrame({ ...O.defaults, yaw: 0, pitch: 0 });
assert.deepEqual(front.eye, [0, 0, 4]);
near(front.right[0], 1);
near(front.up[1], 1);
near(front.forward[2], -1);
near(O.backgroundDistance([0, 0, 4], [0, 0, -1], O.defaults), 7);
assert.equal(O.backgroundDistance([0, 0, 4], [0, 0, 1], O.defaults), Infinity);
// Camera/background intersections must sample the current landmark target.
// Use a known oblique displacement, independently of the target implementation.
const target = globalThis.LandmarkTarget;
for (const [x, y] of [
  [0, 0],
  [0.68, 0],
  [-0.68, 0],
  [0, 0.68],
  [0, -0.68],
]) {
  assert.deepEqual(O.bg([x - 0.7, y + 0.35, 4], [0.1, -0.05, -1], O.defaults), target.sample(x, y));
}
assert.deepEqual(O.bg([0, 0, 4], [0, 0, 1], O.defaults), [25, 34, 52]);
console.log('PASS right-handed camera, signed background intersection and landmark sampling.');
