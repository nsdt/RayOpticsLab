const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const S = require('../../app/paper/selection.js'),
  catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../app/paper/experiments.json'), 'utf8'),
  );
let cases = 0,
  rejections = 0;
for (const source of catalog.cases) {
  const r = S.create(catalog, source.id, {
    mode: 'archived',
    resolution: 4,
    backend: 'gpu',
    samples: 8,
  });
  assert.equal(r.config.computeBackend, 'cpu');
  assert.equal(r.config.resolution, source.config.resolution);
  if (source.kind !== 'mono') assert.equal(r.config.spectralSamples, source.config.spectralSamples);
  assert(r.execution.matchesManuscriptSettings);
  assert.deepEqual(S.validate(catalog, r), r);
  const preferred = S.create(catalog, source.id, {
    mode: 'manuscript',
    backend: 'gpu',
    resolution: 4,
    samples: 8,
  });
  assert.equal(preferred.config.computeBackend, 'gpu');
  assert.equal(preferred.config.gpuPrecision, 'validated-f32');
  assert.equal(preferred.config.resolution, source.config.resolution);
  if (source.kind !== 'mono')
    assert.equal(preferred.config.spectralSamples, source.config.spectralSamples);
  assert(preferred.execution.matchesManuscriptExperiment);
  assert(!preferred.execution.matchesArchivedCPU);
  S.validate(catalog, preferred);
  const originalGPUFields = structuredClone(preferred.config);
  delete originalGPUFields.gpuPrecision;
  originalGPUFields.computeBackend = source.config.computeBackend;
  assert.deepEqual(originalGPUFields, source.config);
  const badPrecision = structuredClone(preferred);
  badPrecision.config.odeRtol = 1e-3;
  assert.throws(() => S.validate(catalog, badPrecision));
  rejections++;
  const custom = S.create(catalog, source.id, {
    mode: 'custom',
    resolution: 16,
    backend: 'gpu',
    samples: 8,
  });
  assert.equal(custom.config.resolution, 16);
  assert.equal(custom.config.computeBackend, 'gpu');
  assert(!custom.execution.matchesManuscriptSettings);
  S.validate(catalog, custom);
  for (const key of ['resolution', 'computeBackend', 'gradient']) {
    const bad = structuredClone(r);
    bad.config[key] = key === 'computeBackend' ? 'gpu' : key === 'resolution' ? 4 : 99;
    assert.throws(() => S.validate(catalog, bad));
    rejections++;
  }
  const saved = S.documentFor(catalog, { source: 'test' }, r);
  assert.equal(saved.recordType, 'selected-settings');
  assert(!saved.outcome);
  const outcome = S.documentFor(catalog, { source: 'test' }, r, { completed: true });
  assert.equal(outcome.recordType, 'calculation-result');
  cases++;
}
assert.throws(() => S.create(catalog, catalog.cases[0].id, { mode: 'custom', resolution: 3 }));
assert.throws(() => S.create(catalog, catalog.cases[0].id, { mode: 'custom', resolution: 1025 }));
assert.throws(() => S.create(catalog, 'missing'));
assert.equal(catalog.figures.length, 35);
assert.equal(new Set(catalog.figures.map((f) => String(f.number))).size, 35);
assert(catalog.cases.every((c) => catalog.figures.some((f) => f.number === c.figure)));
console.log(
  JSON.stringify({
    passed: true,
    cases,
    modifiedArchivedSettingsRejected: rejections,
    referenceFigures: 35,
  }),
);
