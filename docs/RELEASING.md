# Preparing a release

## Current state

Keep the repository private. The local build and CI checks do not publish a site.
The Pages workflow has only a manual trigger and runs only when all of the following
are true: the repository is public, `PAGES_ENABLED` is `true`, and the selected
branch is the default branch. Leave the variable unset during preparation.

This matters because a Pages site can be public even when its source repository
is private. See [GitHub's Pages documentation](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/creating-a-github-pages-site).

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

## Before the first public release

Finalize the software license, the author-approved release description, and the
relationship between this software version and the manuscript. Retain the CIE
attribution/license and separate manufacturer data notices. Update `CITATION.cff`
with the actual repository URL and release version. Add a software DOI only after
it has been reserved or issued for this software release. Do not use the DOI of a
theoretical paper as the software DOI.

When publication is explicitly authorized:

1. Change repository visibility as intended and remove the preparation-only
   status text from the README.
2. In **Settings → Pages**, select **GitHub Actions** as the publishing source.
3. Add repository variable **PAGES_ENABLED = true**.
4. Run **Publish GitHub Pages** manually on the default branch.
5. Check the generated HTTPS URL, including a paper calculation and its downloads.
6. Put that verified URL in both READMEs. Archive the reviewed software release
   with Zenodo and record its actual DOI and version in the citation metadata.

For a project repository the URL has the form
`https://<owner>.github.io/<repository>/`. The workflow uploads only `dist/site/`;
source tests and development records are not web content. Workflow setup follows
[GitHub's custom Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
