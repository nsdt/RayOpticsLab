# Reproducing the manuscript experiments

[Quick start](../README.md) · [日本語](REPRODUCING_JA.md)

## Choose the appropriate calculation

Open [Ray Optics Lab](https://nsdt.github.io/RayOpticsLab/#paper) and select
**Paper experiments**, or use the [local launch instructions](../README.md#run-locally). This workspace has its own settings and canvas. It
does not overwrite the scene in Custom rendering.

The catalog has 80 conditions (76 monochromatic and 4 spectral). Experiment
selection follows Supplement Figures S2–S16, S18–S21 and S23. Representative panels
also appear in the article. The 35 reference illustrations include trajectory,
difference and quantitative figures as well as camera images.

For a first check, select **Homogeneous isotropic medium**, choose a panel, select
**CPU reference used for the paper**, then click **Calculate image**. This uses the retained
implementation and the original resolution. The status should report completed
calculation and successful source/settings verification.

The three modes serve different purposes:

- **Paper settings (GPU preferred)** preserves the physical scene, panel
  resolution and wavelength sampling. The backend can be switched to CPU.
- **CPU reference used for the paper** restores the original implementation, tolerances,
  resolution and sampling together. Use it when comparing with retained CPU data.
- **Adjust calculation settings** permits a different backend, side length
  (4–1024 pixels) and spectral sample count (8, 16, 32, 64, 128 or 256). Material,
  lens, camera and background parameters remain those of the selected experiment.

Use **Restore paper settings** to return from adjusted settings to the
manuscript mode. Resolution and wavelength sampling also have individual restore
buttons. The default mode again prefers GPU.

## Spectral examples and computation time

The final groups include homogeneous-isotropic and reciprocal-profile dispersion.
Each has constant-index and dispersive conditions. The manuscript uses 128 samples
over 380–780 nm. For a quick exploration, choose adjusted settings, a small image
and 8 or 16 samples, then restore the manuscript settings for the retained protocol.

GPU setup includes shader and pipeline preparation. A completed GPU worker can
reuse its device and compiled pipelines. Unreliable GPU pixels are recalculated
on the CPU, and unsupported environments use CPU calculation. Thus elapsed time
includes setup, transport, transfers, CPU fallback and spectral accumulation.
Read the actual-backend and fallback diagnostics rather than inferring GPU use
from the selected preference alone.

GPU float32 calculations and the archived float64 CPU calculation are different
numerical implementations. The GPU has an explicit tolerance profile and precision
guards. A saved record contains both requested and effective settings.

## Save an image with its provenance

After completion, save:

1. The **PNG** image.
2. The **completed calculation record (JSON)** for that image.

The completed record stores the evaluated recipe, runtime/source hashes, actual
backend, precision, diagnostics and image hash. **Save selected settings (JSON)**
is a separate export for the current selector state. If you change the selection
after rendering, it no longer describes the displayed image. The interface shows
this distinction; the completed-image record retains the previous recipe.

If source verification fails, reload the application from one consistent copy.
Opening files with `file://` does not provide the required worker and secure-context
features. Use localhost or an HTTPS host.

## Reference figures and additional calculations

The reference selector displays article Figures 1–9 and Supplement Figures S1–S26.
It displays saved illustrations. **Calculate image** regenerates the selected camera
image, not the entire multi-panel figure or its trajectory/quantitative plots.

The **additional analysis** download is `app/paper/analysis-reproduction.zip`.
Extract it into a separate directory and follow the READMEs inside it. These
calculations require Python/Node.js and their listed numerical dependencies;
those dependencies are not required by the browser app.

| Archive directory | Additional calculations |
| --- | --- |
| `contribution/` | Landmark connections, dielectric-interface checks, internal conversion assessment and CPU records |
| `interfaces/` | Independent indefinite/transform-medium interface checks and image-mechanism decomposition |
| `normalization/` | Image-size-normalized landmark measures |
| `physical-interpretation/` | Heliconical pi example, trajectories and reciprocal direct/reflected contributions |
| `internal-conversion/` | Interior-coupling comparisons and the associated plotting inputs |

The archive preserves historical script names and documentation. Use
`MANUSCRIPT_MAP.json`, `PHYSICAL_INTERPRETATION_README.md` and each subdirectory's
README to interpret their figure labels. The current browser catalog, not an
older count in an archived README, defines the 80 selectable image conditions.

## What is preserved

`app/paper/experiments.json` contains full configurations rather than a list of
changes relative to current defaults. `app/paper/engine/` contains the retained
CPU source. `app/paper/provenance.json` records the engine, protocol, maintained
GPU runtime and additional-analysis hashes. The worker verifies them before use.
