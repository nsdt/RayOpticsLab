# Ray Optics Lab

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24357692.svg)](https://doi.org/10.5281/zenodo.24357692)

[日本語のREADME](README_JA.md)

Ray Optics Lab visualizes images observed through homogeneous and inhomogeneous
isotropic and anisotropic optical media. Change material parameters in the browser
to examine how analytical ray trajectories affect the observed image. The interface
supports English and Japanese. WebGPU is preferred when supported, with CPU
calculation available for unsupported environments and rejected pixels.

## Use in your browser

**[Open Ray Optics Lab](https://nsdt.github.io/RayOpticsLab/)** — no installation is required.

1. The app opens in English on your first visit. Use **Language / 言語** in the header
   to switch to Japanese. Your selection is saved for future visits.
2. In **Custom rendering**, choose a material and adjust its parameters.
3. Choose a resolution, then calculate the image. GPU preference can be changed
   in the calculation controls. The result reports the backend actually used.
4. Save the image or scene settings if needed.

Changing language does not alter optical parameters or rendered pixels. Use
**Paper experiments** to explore the conditions used in the paper.

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

## Run locally

You need a current browser and **Python 3.9 or later**. No Python packages, Node.js,
npm installation or internet connection are required to run the downloaded app.
Keep the `app/` folder and the launchers together.

1. Download `RayOpticsLab-local.zip` from the [releases page](https://github.com/nsdt/RayOpticsLab/releases),
   or download the repository ZIP using **Code → Download ZIP**, then extract it.
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

## Scope and attribution

This is a geometrical-optics application. Closed-form propagation is used only
where its conditions hold; numerical integration and the documented polarization
approximations are also used. GPU availability does not guarantee faster rendering.
Initial shader preparation and CPU fallback contribute to elapsed time.

See [spectral data sources](app/data/spectral/SOURCES.md) and
[third-party notices](app/THIRD_PARTY_NOTICES.md). The original software and associated documentation are distributed under the
[MIT License](LICENSE). Bundled third-party data retain their own terms.
Version 1.0.0 is archived on [Zenodo](https://doi.org/10.5281/zenodo.24357692).

## Cite this software

Yohei Nishidate (2026). *Ray Optics Lab* (Version 1.0.0). Zenodo.
[10.5281/zenodo.24357692](https://doi.org/10.5281/zenodo.24357692).

The version DOI identifies the archived implementation. The [concept DOI](https://doi.org/10.5281/zenodo.24357691)
identifies all archived versions. The public website may receive later updates.
