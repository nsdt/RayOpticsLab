# Ray Optics Lab

[日本語](README_JA.md) · [Experiment reproduction](docs/REPRODUCING.md) · [Development](docs/DEVELOPING.md)

Ray Optics Lab visualizes images observed through homogeneous and inhomogeneous
isotropic and anisotropic optical media. Change material parameters in the browser
to examine how analytical ray trajectories affect the observed image. The interface
supports English and Japanese. WebGPU is preferred when supported, with CPU
calculation available for unsupported environments and rejected pixels.

**[Open Ray Optics Lab](https://nsdt.github.io/RayOpticsLab/)** ·
[Source code](https://github.com/nsdt/RayOpticsLab) ·
[Releases and downloads](https://github.com/nsdt/RayOpticsLab/releases)

The hosted application runs in the browser without installation. For offline use,
follow the local launch instructions below.

## Run locally

You need a current browser and **Python 3.9 or later**. No Python packages, Node.js,
npm installation or internet connection are required to run the downloaded app.
Keep the `app/` folder and the launchers together.

1. Download and extract the repository ZIP, or extract `RayOpticsLab-local.zip`.
2. Start the launcher for your platform:

   | Platform | Start command |
   | --- | --- |
   | Windows | Double-click `start-windows.bat`, or run `py -3 launch.py` |
   | macOS | Run `sh start-macos.command` in Terminal |
   | Linux | Run `sh start-linux.sh` in a terminal |

3. Open the URL printed by the launcher if a browser does not open automatically.
4. Leave the terminal running. Press **Ctrl+C** there to stop the server.

Alternatively, run `python launch.py` or `python3 launch.py` in this directory.
`--port 8876` selects a starting port and `--no-browser` suppresses automatic browser
opening. The server listens only on the local computer.

Open the app through the launcher rather than double-clicking `index.html`.
Workers and verified experiment files require HTTP on localhost or HTTPS. The
[GitHub Pages application](https://nsdt.github.io/RayOpticsLab/) runs directly in the
browser without Python or installation.

## First image

1. Use **Language / 言語** in the header to select English or Japanese.
2. In **Custom rendering**, choose a material and adjust its parameters.
3. Choose a resolution, then calculate the image. GPU preference can be changed
   in the calculation controls. The result reports the backend actually used.
4. Save the image or scene settings if needed.

Changing language does not alter optical parameters or rendered pixels. The
comparison workspaces contain development examples. Use **Paper experiments**
for the paper's retained conditions.

## Reproduce a manuscript image

The application contains **80 image conditions**: 76 monochromatic and 4 spectral.
There are **35 reference figures**: article Figures 1–9 and Supplement Figures
S1–S26. A reference figure may contain several panels or a quantitative plot.

1. Open **Paper experiments**.
2. Select the medium/figure and the desired panel. The displayed description
   identifies the corresponding experiment.
3. Choose the calculation mode:

   | Mode | Purpose |
   | --- | --- |
   | **Paper settings (GPU preferred)** | Retain the paper's scene, resolution and wavelength sampling; prefer GPU with CPU fallback. |
   | **CPU reference used for the paper** | Use the preserved CPU implementation, original numerical tolerances and original sampling. Choose this for the closest reproduction of the archived image. |
   | **Adjust calculation settings** | Keep the physical scene and vary the backend, resolution or wavelength sampling for comparison. |

4. Click **Calculate image** and wait for completion.
5. Save the **PNG** and the **completed calculation record (JSON)** together.
   The separate **selected settings (JSON)** export describes the current selection,
   which may differ from the last completed image.

GPU and archived CPU calculations use different arithmetic precision and need not
be pixel-identical. The completed record includes source hashes, actual backend,
CPU fallback counts, precision and diagnostics. Custom resolution is 4–1024 pixels
per side. Spectral examples permit 8–256 wavelength samples; the manuscript uses
128. Smaller settings are useful for exploration but are not the original sampling.

See the [step-by-step reproduction guide](docs/REPRODUCING.md) for reference figures,
restoring settings, spectral examples and regenerating trajectory/analysis plots.

## Repository contents

| Path | Contents | Needed to run the app? |
| --- | --- | --- |
| `app/` | Browser application, shaders, data, archived paper engine, conditions and reference figures | Yes |
| `launch.py`, `start-*` | Local HTTP launchers | For local use |
| `tests/` | Maintained CPU/browser regressions and fixtures | No |
| `scripts/`, `distribution/` | Validation, explicit distribution file list and packaging tools | No |
| `docs/` | Reproduction, development and release instructions | Documentation |
| `.github/workflows/` | CI and the manual Pages deployment workflow | GitHub only |

`dev/`, `test-results/`, `dist/`, local review folders and `node_modules/` are ignored
by Git. Historical development archives and scratch images are not distributed.
The optional analysis download inside `app/paper/` is retained so the paper's
additional calculations remain available offline.

## Development and deployment

With Node.js 22 or later:

```sh
npm ci
npm test
npm run build
```

`dist/site/` contains only the files selected for static hosting. No scientific
code is bundled or rewritten. `python scripts/package-local.py` packages that
verified build with the launchers into `dist/RayOpticsLab-local.zip`.

See [DEVELOPING.md](docs/DEVELOPING.md) for browser checks and
[RELEASING.md](docs/RELEASING.md) for Pages deployment and Zenodo archiving. Running the build does not publish anything.

## Scope and attribution

This is a geometrical-optics application. Closed-form propagation is used only
where its conditions hold; numerical integration and the documented polarization
approximations are also used. GPU availability does not guarantee faster rendering.
Initial shader preparation and CPU fallback contribute to elapsed time.

See [spectral data sources](app/data/spectral/SOURCES.md) and
[third-party notices](app/THIRD_PARTY_NOTICES.md). The application release license
and software DOI will be finalized before public release. No theoretical-paper DOI
is used as a substitute for the software DOI.
