const fs = require('fs'),
  vm = require('vm'),
  assert = require('node:assert/strict'),
  path = require('path');
let c;
const context = vm.createContext({ performance, Uint8ClampedArray, console });
context.importScripts = (...files) =>
  files.forEach((f) =>
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '../../app', f.split('?')[0]), 'utf8'),
      context,
    ),
  );
context.postMessage = (r) => {
  assert.ok(r.pixels.length === c.resolution * r.rows * 4);
  if (r.done) {
    console.log(c.material, c.shape, Math.round(r.ms) + 'ms', JSON.stringify(r.stats));
    assert.equal(r.stats.error, 0);
    assert.equal(r.stats.limit, 0);
  }
};
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app', 'worker.js'), 'utf8'), context);
for (let [material, shape] of [
  ['isotropic', 'sphere'],
  ['common', 'torus'],
  ['biaxial', 'cube'],
  ['shear', 'cube'],
]) {
  c = { ...context.Optics.defaults, material, shape, resolution: 32, solver: 'auto' };
  context.onmessage({ data: c });
}
