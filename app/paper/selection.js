/* Selection rules shared by the manuscript interface and its isolated worker. */
(function (root) {
  'use strict';
  const implementation = '20261114-gpu-asphere1';
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const stable = (x) =>
    JSON.stringify(
      x && typeof x === 'object'
        ? Array.isArray(x)
          ? x.map((v) => JSON.parse(stable(v)))
          : Object.fromEntries(
              Object.keys(x)
                .sort()
                .map((k) => [k, JSON.parse(stable(x[k]))]),
            )
        : x,
    );
  function create(catalog, id, settings = {}) {
    const source = catalog.cases.find((c) => c.id === id);
    if (!source) throw Error('Unknown manuscript image.');
    const mode = settings.mode || 'manuscript';
    if (!['manuscript', 'archived', 'custom'].includes(mode))
      throw Error('Unknown calculation mode.');
    const recipe = copy(source),
      c = recipe.config;
    recipe.originalResolution = c.resolution;
    if (recipe.kind !== 'mono') recipe.originalSpectralSamples = c.spectralSamples;
    c.computeBackend =
      mode === 'archived' ? 'cpu' : settings.backend || (mode === 'manuscript' ? 'gpu' : 'cpu');
    if (c.computeBackend === 'gpu') c.gpuPrecision = 'validated-f32';
    if (mode === 'custom') {
      c.resolution = Number(settings.resolution ?? c.resolution);
      if (recipe.kind !== 'mono') c.spectralSamples = Number(settings.samples ?? c.spectralSamples);
    }
    if (!Number.isInteger(c.resolution) || c.resolution < 4 || c.resolution > 1024)
      throw Error('Image side length must be an integer from 4 to 1024 pixels.');
    if (!['cpu', 'gpu'].includes(c.computeBackend)) throw Error('Unknown calculation device.');
    if (recipe.kind !== 'mono' && ![8, 16, 32, 64, 128, 256].includes(c.spectralSamples))
      throw Error('Unsupported wavelength sample count.');
    const differences = [];
    if (c.computeBackend !== 'cpu') differences.push('backend');
    if (c.resolution !== source.config.resolution) differences.push('resolution');
    if (recipe.kind !== 'mono' && c.spectralSamples !== source.config.spectralSamples)
      differences.push('spectralSamples');
    recipe.execution = {
      mode,
      protocol: catalog.protocol,
      implementation,
      matchesManuscriptSettings: !differences.length,
      matchesManuscriptExperiment: !differences.some((k) => k !== 'backend'),
      matchesArchivedCPU: !differences.length,
      differences,
    };
    return recipe;
  }
  function validate(catalog, recipe) {
    const expected = create(catalog, recipe.id, {
      mode: recipe.execution?.mode,
      backend: recipe.config?.computeBackend,
      resolution: recipe.config?.resolution,
      samples: recipe.config?.spectralSamples,
    });
    if (stable(recipe) !== stable(expected))
      throw Error(
        'The selected settings do not match the archived experiment catalog. Reload the application.',
      );
    return expected;
  }
  function documentFor(catalog, provenance, recipe, outcome = null) {
    validate(catalog, recipe);
    return {
      format: 'RayOpticsLab-paper',
      version: 4,
      protocol: catalog.protocol,
      implementation,
      recordType: outcome ? 'calculation-result' : 'selected-settings',
      recipe: copy(recipe),
      provenance: copy(provenance),
      ...(outcome ? { outcome: copy(outcome) } : {}),
    };
  }
  root.PaperSelection = { implementation, create, validate, documentFor, stable };
  if (typeof module === 'object' && module.exports) module.exports = root.PaperSelection;
})(globalThis);
