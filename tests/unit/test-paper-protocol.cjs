const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const app = path.resolve(__dirname, '../../app'),
  ctx = vm.createContext({
    console,
    performance,
    Float32Array,
    Float64Array,
    Uint8ClampedArray,
    Map,
  });
const provenance = JSON.parse(fs.readFileSync(path.join(app, 'paper/provenance.json'), 'utf8'));
assert.equal(
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(app, 'paper/protocol.js')))
    .digest('hex'),
  provenance.protocolSHA256,
);
assert.equal(
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(app, 'paper/experiments.json')))
    .digest('hex'),
  provenance.configurationSHA256,
);
for (const [name, hash] of Object.entries(provenance.packagedEngineSHA256))
  assert.equal(
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(app, 'paper/engine', name)))
      .digest('hex'),
    hash,
  );
for (const n of [
  'polynomial',
  'landmark-target',
  'asphere',
  'literature-media',
  'optics',
  'rkf45',
  'analytical',
  'schur',
  'approximate',
  'homogeneous',
  'grin',
  'branching',
  'polarization',
  'data/spectral/cie-visible',
  'data/spectral/schott-visible',
  'spectral',
])
  vm.runInContext(fs.readFileSync(path.join(app, 'paper/engine', n + '.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(app, 'paper/protocol.js'), 'utf8'), ctx);
const P = ctx.PaperProtocol,
  catalog = JSON.parse(fs.readFileSync(path.join(app, 'paper/experiments.json'), 'utf8')),
  fixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../fixtures/paper-reference.json'), 'utf8'),
  );
(async () => {
  let channels = 0,
    maxDifference = 0;
  for (const fixture of fixtures) {
    const recipe = catalog.cases.find((c) => c.id === fixture.id),
      c = recipe.config,
      n = c.resolution;
    if (recipe.kind === 'constant')
      await P.render({ ...recipe, config: { ...c, resolution: 1 } }, () => {});
    for (const { x, y, value: expected } of fixture.points) {
      let actual;
      if (recipe.kind === 'mono') actual = P.pixel(x, y, n, c, P.palette(c)).linear;
      else if (recipe.kind === 'constant') actual = P.pixel(x, y, n, c, P.integrated(c)).linear;
      else {
        const xyz = [0, 0, 0],
          cover = P.coverage(x, y, n, c);
        for (const sample of ctx.Spectral.plan(c)) {
          const cc = { ...sample.config, paperTarget: 'landmarks' },
            v = P.pixel(x, y, n, cc, P.palette(cc), cover).linear,
            intensity = v.reduce((a, b) => a + b, 0) / 3;
          for (let j = 0; j < 3; j++) xyz[j] += intensity * sample.xyz[j];
        }
        actual = ctx.Spectral.rgb(...xyz);
      }
      for (let j = 0; j < 3; j++) {
        const d = Math.abs(actual[j] - expected[j]);
        assert(d < 1e-11, recipe.id + ': ' + d);
        maxDifference = Math.max(maxDifference, d);
        channels++;
      }
    }
  }
  console.log(
    JSON.stringify({
      cases: fixtures.length,
      channelComparisons: channels,
      maxDifference,
      engineHashes: 'verified',
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
