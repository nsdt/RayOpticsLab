# Preparing a release

## Current state

The source repository is public at https://github.com/nsdt/RayOpticsLab.
The hosted application is https://nsdt.github.io/RayOpticsLab/.
Pages deployment is manual and requires PAGES_ENABLED=true on the default branch.

## Files to keep in Git

Track `app/`, `tests/`, `scripts/`, `distribution/`, `docs/`, `.github/`, the README
files, launchers, npm lockfile and repository configuration. Do not force-add
`dev/`, `review*/`, `node_modules/`, `test-results/` or `dist/`.

The archived paper engine, complete configurations and reference figures are
required application data. `app/paper/analysis-reproduction.zip` is intentionally
included (about 67 MB) because the interface offers it as an offline analysis
download. Raw manufacturer downloads, scratch outputs, old screenshots and local
source checkpoints remain in the ignored development archive.

`.gitattributes` preserves the exact bytes of hash-verified files across platforms.
Do not let Git line-ending conversion rewrite the archived engine or provenance
inputs.

## Validate a candidate

From a clean checkout:

```sh
npm ci
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:browser
python scripts/package-local.py
```

The browser checks serve `dist/site/` under `/RayOpticsLab/`, matching a project
Pages path. They verify relative asset loading, English/Japanese UI, archived CPU
reproduction, source verification, custom spectral settings and CPU fallback.
For a local hardware-GPU check, set `BROWSER_CHANNEL=msedge` and `REQUIRE_GPU=1`
before running the browser checks. CI disables WebGPU so CPU fallback is tested
independently of the runner's graphics hardware.

The explicit distribution list is `distribution/site-files.json`. Unexpected
files in `app/` or the build directory cause validation to fail rather than being
silently included. Update the file list when adding an intentional runtime asset.

Outputs:

- `dist/site/`: the static site. Copy its contents as a unit to any HTTPS static host.
- `dist/RayOpticsLab-local.zip`: the same app with Python launchers and user docs.
- `test-results/`: generated validation reports, excluded from Git and hosting.

No DOI, GitHub release or public page is created by these commands.

## Archive a software release

1. Retain the source license and third-party data notices. Update CITATION.cff and
   .zenodo.json with the version, publication date and release description.
2. Run the validation commands above. Review the files in the local ZIP and the
   GitHub diff before creating a release.
3. In Zenodo, connect the GitHub account, synchronize repositories and enable
   nsdt/RayOpticsLab. This must precede the GitHub release.
4. Create a version tag and GitHub release on the reviewed commit. Attach
   RayOpticsLab-local.zip for users who prefer a local download.
5. Wait for Zenodo to archive the GitHub release. Verify the archived version,
   creator, license and DOI on the record page.
6. Add the actual version DOI to CITATION.cff, both READMEs and the manuscript.
   Use a version DOI when citing the implementation used in an experiment.
   Do not substitute the DOI of a theoretical paper.

The GitHub integration archives the tagged repository. The repository therefore
contains the archived CPU engine, experiment configurations, reference figures
and the additional-analysis archive required for reproduction. Release assets
are convenience downloads; the tagged source itself remains runnable.

## Deploy GitHub Pages

In Settings > Pages, choose GitHub Actions as the source. Keep the repository
variable PAGES_ENABLED=true and run Publish GitHub Pages on the default branch.
The workflow uploads only dist/site. Verify the HTTPS page, a paper calculation,
language switching and downloads after deployment.

The browser checks serve the app below /RayOpticsLab/, matching the public URL.
The workflow follows [GitHub's custom Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
Zenodo setup follows [the repository integration guide](https://help.zenodo.org/docs/github/enable-repository/).
