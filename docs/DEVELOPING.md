# Maintaining Ray Optics Lab

The application runs directly in a browser. There is no bundler or production
npm dependency. Node.js is used for development checks and formatting only.

## Start here

Run all commands from the repository root, not from `app/` or `docs/`.

```sh
python launch.py --no-browser --port 8877
npm ci
npm test
npm run format:check
```

Open the URL printed by the launcher. On Windows, run npm from a local drive
or a mapped drive if `cmd.exe` rejects the WSL UNC working directory. The checks
can also be invoked directly with `node scripts/check.cjs`.

For a JavaScript/CSS/HTML edit:

```sh
npm run format
npm run paper:hashes
npm test
```

`paper:hashes` updates hashes of maintained runtime files. It first verifies
that the archived CPU engine and experiment settings have not changed. Do not
silence an integrity failure by replacing the archived hashes manually.

## Module map

Paths in this table are relative to `app/`.

| Responsibility | Files |
| --- | --- |
| Application controls and render lifecycle | `app.js`, `scene-config.js`, `material-notes.js`, `material-picker.js` |
| Tabs, language and help | `workspace-ui.js`, `i18n.js`, `context-help.js` |
| Worker scheduling and pixel generation | `render-workers.js`, `worker.js` |
| Numerical diagnostic aggregation and display | `render-statistics.js`, `render-diagnostics.js` |
| Vector/matrix operations, geometry, Hamiltonian state and background | `optics.js`, `asphere.js`, `polynomial.js`, `landmark-target.js` |
| Trajectory propagation | `analytical.js`, `schur.js`, `rkf45.js`, `homogeneous.js`, `grin.js`, `approximate.js`, `literature-media.js` |
| Material choices | `catalog.js` |
| Interface fields, reflected/transmitted rays and radiance budgets | `polarization.js` |
| Optional interior polarization models | `branching.js`, `layered.js`, `modal.js`, `coherent*.js` |
| Wavelength sampling, colour integration and controls | `spectral.js`, `spectral-renderer.js`, `spectral-ui.js`, `data/spectral/` |
| GPU capability policy and host execution | `gpu-support.js`, `gpu-transport.js` |
| GPU transport, numerical trajectories and coherent transport | `gpu-optics.wgsl`, `gpu-numerical.wgsl`, `gpu-phase.wgsl` |
| Development comparisons | `comparison*.js`, `phase-comparison.js`, `gpu-comparison.js` |
| Paper selection, verification and rendering | `paper-ui.js`, `paper/selection.js`, `paper/worker.js`, `paper/protocol.js` |

Scripts extend explicit globals such as `Optics` and `Optics.polarization`.
Their load order is defined in `index.html` and the `importScripts` list in
`worker.js`. The paper worker has a separate, verified dependency list.
A new worker helper must be added to that worker's import list. It does not
need to be loaded by the UI unless the UI uses it.

## Rendering flow

1. `app.js` validates a scene and obtains a worker from `render-workers.js`.
   A generation counter rejects late messages from cancelled renders.
2. `worker.js` prepares the camera and GPU backend, then renders tiles of rows.
   `renderRows` performs camera sampling and converts ray colours to pixels.
   `render-statistics.js` combines ray diagnostics without changing the rays.
3. `GPUOptics.create` owns the buffers for one image. Device and pipeline
   caches survive completed GPU jobs. `packUniforms`, `dispatchTile`,
   `decodeResults` and `retryOnCPU` handle successive stages of a tile.
4. A GPU precision guard rejects an entire pixel. Its original camera ray is
   retraced in double precision on the CPU, including its reflection tree.
   A device or tile failure switches the remaining work to CPU rendering.
5. Spectral rendering repeats monochromatic transport, integrates scalar
   radiance against the wavelength weights, then converts XYZ to RGB.
   Only the last wavelength emits `done`, so the worker cannot be reused early.
6. The UI receives pixel tiles and diagnostics. Cancelled workers are terminated.
   A completed GPU worker may be retained to reuse its compiled pipelines.

## Numerical conventions

- A ray state is `[x, y, z, px, py, pz]`. Position and momentum have separate
  absolute tolerances. Momentum is normal to the wavefront. The energy direction
  follows the Hamiltonian derivative with respect to momentum.
- In formula kernels, `x`, `p`, `G`, `c`, `s` and `O` mean position, momentum,
  optical metric, scene configuration, ray state and the `Optics` namespace.
  Keep standard mathematical names in short formulas. Prefer descriptive names
  for orchestration, buffers, flags and intermediate render results.
- Mode `0`/`1` is ordinary/extraordinary for uniaxial media. For biaxial media it
  denotes the ordered Fresnel branches and must not be relabelled o/e.
- CPU calculations use JavaScript numbers (float64). GPU calculations use f32
  with explicit guards and CPU recovery. Do not tighten, remove or reinterpret
  a guard as part of a formatting change.
- The RKF45 routine accepts the fifth-order estimate. Surface intersections and
  internal events have their own brackets outside the integrator.
- Keep operation order in numerical expressions. Algebraically equivalent
  expressions need not produce identical floating-point results.
- Separate geometric propagation, polarization evolution, interface splitting
  and radiance accumulation. The optional interior models make different
  approximations. Sharing a function must not silently change the chosen model.

## GPU buffer contract

`gpu-transport.js` and `gpu-optics.wgsl` share numeric model IDs and binary layouts.
The material, shape and solver ID tables are defined once in the host module.
When a shader interpretation changes, check both uniform packing and pipeline
specialization. The pipeline cache key must include each specialized setting.

The uniform block contains **40 `vec4f` values / 160 float32 values / 640 bytes**.
Offsets in `packUniforms` count scalar floats, whereas shader indices count vec4s.

| Shader `cfg` slots | Contents |
| --- | --- |
| 0–3 | Tile geometry, material indices, optical axis, gradient and trace budget |
| 4–7 | Camera frame, projection extent, background plane and background kind |
| 8–9 | Integration step, view channel, pixel count, shape and branch ordering |
| 10–15 | Constitutive tensor and inverse; padding also stores solver, twist and shift |
| 16–18 | Interior branching, phase settings and ODE tolerances |
| 19 | Reserved |
| 20–21 | Radial/transform centre and radii, ENG strength and radiance bound |
| 22–23 | Reserved |
| 24–31 | Internal event planes |
| 32–38 | Seven linear-RGB palette entries with padding |
| 39 | Paper/spectral flags |

A `Ray` occupies **80 bytes** and a `Pixel` **272 bytes / 68 words**. The same
readback bytes are viewed as both `Float32Array` and `Uint32Array`. Never convert
integer counters through a float view. Pixel word 20 is the completion flag and
word 21 is the CPU-retry reason. `traceResult` maps the remaining fields to the
public diagnostic record. Retain padding and field order when editing structs.

## Paper reproducibility

`app/paper/engine/` is a historical CPU engine, not a second maintained copy of the
live source. `app/paper/experiments.json`, reference images and measured records are
also generated or archived assets. They are excluded from routine formatting.
The current GPU host and shaders are intentionally shared with paper rendering.
The paper worker verifies their hashes before executing them.

Use `scripts/build-paper-catalog.py` only when regenerating the catalog from manuscript
and experiment sources. It copies the historical engine again. Ordinary live
runtime edits need `npm run paper:hashes`, not catalog regeneration.

For deployment, update `APP_BUILD`, `WORKER_BUILD` and the asset query versions in
`index.html` together. A changed worker URL alone does not invalidate its imported
scripts. Paper runtime hashes must also reflect the deployed bytes.

## Verification

`npm test` runs the CPU test files once each in separate processes. Historical
aggregate runners and browser scripts are excluded, since they either rerun the
same tests or depend on old UI versions and server URLs. Numerical tests requiring
small residuals set their own pruning budget rather than inheriting UI defaults.

Browser checks use the built distribution under a project-site subpath:

```sh
npm run build
npx playwright install chromium
npm run test:browser
```

The browser runner starts its own temporary HTTP server. Set `BROWSER_CHANNEL`
to `msedge` to use installed Edge, or leave it unset for Playwright Chromium.
Set `REQUIRE_GPU=1` to require actual GPU execution. `DISABLE_GPU=1` exercises
CPU fallback. Reports are written under `test-results/browser/`.

The scripts check English/Japanese switching, archived and custom settings,
CPU/GPU rendering, cancellation, downloads, source-integrity failures and mobile
layout. No absolute workstation path is required. `PLAYWRIGHT_PATH` is an optional
override for an existing Playwright module installation.

The one-time refactoring comparison and its source checkpoint are under
`dev/archive/review_20261117_readability/`. They compare image arrays and non-timing
statistics with the pre-refactoring implementation. Their small images are
regression checks, not replacements for the manuscript's accuracy measurements.

## Distribution layout

`app/` contains only files selected in `distribution/site-files.json`, including
archived reference data. `tests/unit/` holds the 21 maintained CPU tests,
`tests/helpers/` their independent reference calculations, and `tests/fixtures/`
the retained samples. Browser tests are in `tests/browser/`. Test output goes to
`test-results/`, never into the source directories.

`node scripts/build-site.cjs` copies the explicit distribution list to `dist/site/`
and verifies all paper hashes. It does not bundle or alter code. The file list
must be reviewed when assets are added. `scripts/package-local.py` creates a ZIP
with the app and local launchers. See [RELEASING.md](RELEASING.md) for future Pages
publication and the current guards that keep preparation private.
