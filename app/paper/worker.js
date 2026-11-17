/* Execute catalog-approved settings after verifying their source hashes.
 * The CPU engine is a historical snapshot. GPU support uses the current host
 * and shaders whose hashes are recorded in provenance.json. Never replace the
 * archived engine with live sources merely to share a helper function.
 */
const engineOrder = [
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
];
let loadedGPU = false;
var rootGPUShaders;
const ready = (async () => {
  const response = await fetch('provenance.json', { cache: 'no-store' });
  if (!response.ok) throw Error('Cannot load manuscript provenance.');
  const provenance = await response.json();
  async function bytes(file, expected) {
    const response = await fetch(file, { cache: 'no-store' });
    if (!response.ok) throw Error('Cannot load manuscript file: ' + file);
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== expected)
      throw Error('Manuscript file verification failed: ' + file + '. Reload the application.');
    return bytes;
  }
  function execute(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    try {
      importScripts(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const catalog = JSON.parse(
    new TextDecoder().decode(await bytes('experiments.json', provenance.configurationSHA256)),
  );
  for (const name of engineOrder) {
    const file = name + '.js';
    execute(await bytes('engine/' + file, provenance.packagedEngineSHA256[file]));
  }
  execute(await bytes('selection.js', provenance.runtimeSHA256['selection.js']));
  execute(await bytes('protocol.js', provenance.protocolSHA256));
  return { catalog, provenance, bytes, execute };
})();
// Attach a rejection handler before the first request, while preserving the failure for that request.
ready.catch(() => {});
onmessage = async (e) => {
  try {
    const { catalog, provenance, bytes, execute } = await ready,
      recipe = PaperSelection.validate(catalog, e.data);
    if (recipe.config.computeBackend === 'gpu' && !loadedGPU) {
      const files = Object.keys(provenance.gpuSHA256);
      const content = await Promise.all(
        files.map((f) => bytes('../' + f, provenance.gpuSHA256[f])),
      );
      const verified = Object.fromEntries(files.map((f, i) => [f, content[i]]));
      execute(verified['gpu-support.js']);
      execute(verified['gpu-transport.js']);
      rootGPUShaders = ['gpu-optics.wgsl', 'gpu-numerical.wgsl', 'gpu-phase.wgsl'].map((f) =>
        new TextDecoder().decode(verified[f]),
      );
      loadedGPU = true;
    }
    postMessage({
      verified: true,
      protocol: catalog.protocol,
      implementation: PaperSelection.implementation,
      provenance,
    });
    await PaperProtocol.render(recipe, (r) => postMessage(r, r.pixels ? [r.pixels.buffer] : []));
  } catch (error) {
    postMessage({ error: error.message || String(error) });
  }
};
