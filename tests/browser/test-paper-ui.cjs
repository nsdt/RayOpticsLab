const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const out = path.resolve(
    __dirname,
    process.env.UI_TEST_OUTPUT || '../../test-results/browser/paper',
  );
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || undefined,
      headless: true,
      args: process.env.DISABLE_GPU ? ['--disable-webgpu'] : [],
    }),
    page = await browser.newPage({ viewport: { width: 1440, height: 1040 }, locale: 'en-US' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const base = process.env.APP_URL || 'http://127.0.0.1:8876';
  const waitPaper = () =>
    page.waitForFunction(() => !document.querySelector('#paperPNG').disabled, null, {
      timeout: 120000,
    });
  const signature = () =>
    page.evaluate(() => ({
      config: JSON.stringify(config),
      free: document.querySelector('#view').toDataURL(),
      paper: document.querySelector('#paperCanvas').toDataURL(),
    }));
  const save = async (id, file) => {
    const promise = page.waitForEvent('download');
    await page.locator(id).click();
    const item = await promise;
    await item.saveAs(path.join(out, file));
    return JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
  };
  await require('../helpers/browser-environment.cjs').configure(page);
  await page.goto(base + '/?ui=20261114-gpu-asphere1#paper');
  await page.waitForFunction(
    () =>
      document.querySelector('#paperCase option') && !document.querySelector('#render').disabled,
  );
  assert.equal(await page.locator('#paperMode').inputValue(), 'manuscript');
  assert.equal(await page.locator('#paperBackend').inputValue(), 'gpu');
  assert(await page.locator('#paperResolution').isDisabled());
  assert(!(await page.locator('#paperBackend').isDisabled()));
  await page.locator('#paperMode').selectOption('archived');
  for (const id of ['paperResolution', 'paperBackend', 'paperSamples'])
    assert(await page.locator('#' + id).isDisabled());
  const original = await signature();
  await page.locator('#paperRun').click();
  await waitPaper();
  assert.match(
    await page.locator('#paperStatus').innerText(),
    /Calculation complete.*Archived CPU reference.*256 × 256/,
  );
  assert.match(
    await page.locator('#paperStatus').innerText(),
    /Archived CPU files and experiment settings verified/,
  );
  const before = await signature();
  assert.equal(before.config, original.config);
  assert.equal(before.free, original.free);
  for (const lang of ['ja', 'en']) {
    await page.locator('#interfaceLanguage').selectOption(lang);
    assert.deepEqual(await signature(), before);
  }
  const record = await save('#paperResultJSON', 'result-record.json');
  assert.equal(record.recordType, 'calculation-result');
  assert.equal(record.recipe.id, 'iso-uniform-v1');
  assert.equal(record.outcome.actualBackend, 'CPU');
  assert(record.outcome.verifiedArchivedFiles);
  assert.equal(record.outcome.image.sha256.length, 64);
  await page.screenshot({ path: path.join(out, 'english-desktop.png') });
  await page.locator('#interfaceLanguage').selectOption('ja');
  await page.screenshot({ path: path.join(out, 'japanese-desktop.png') });
  await page.locator('#interfaceLanguage').selectOption('en');
  await page.locator('#paperGroup').selectOption('iso-uniform-dispersion');
  await page.locator('#paperCase').selectOption('iso-uniform-dispersion-spectral');
  assert.equal(await page.locator('#paperSamples').inputValue(), '128');
  await page.locator('#paperMode').selectOption('custom');
  assert(!(await page.locator('#paperResolution').isDisabled()));
  await page.locator('#paperBackend').selectOption('cpu');
  await page.locator('#paperResolution').fill('16');
  await page.locator('#paperSamples').selectOption('8');
  await page.locator('#paperRun').click();
  await waitPaper();
  assert.match(
    await page.locator('#paperStatus').innerText(),
    /Adjusted calculation settings.*16 × 16/,
  );
  const spectralPixels = await page
    .locator('#paperCanvas')
    .evaluate((c) => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data));
  assert(spectralPixels.some((v, i) => i % 4 !== 3 && v > 100));
  await page.locator('#paperRestoreAll').click();
  assert.equal(await page.locator('#paperMode').inputValue(), 'manuscript');
  assert.equal(await page.locator('#paperBackend').inputValue(), 'gpu');
  assert.equal(await page.locator('#paperSamples').inputValue(), '128');
  assert.equal(await page.locator('#paperResolution').inputValue(), '256');
  const selected = await save('#paperJSON', 'selected-settings.json');
  const completed = await save('#paperResultJSON', 'previous-result-record.json');
  assert.equal(selected.recipe.config.spectralSamples, 128);
  assert.equal(completed.recipe.config.spectralSamples, 8);
  assert.equal(completed.recipe.config.resolution, 16);
  assert.match(await page.locator('#paperSelectionNotice').innerText(), /previous settings/);
  assert.equal(await page.locator('#paperReference option').count(), 35);
  await page.locator('.paper-reference summary').click();
  await page.locator('#paperReference').selectOption('S16');
  await page.waitForFunction(
    () =>
      document.querySelector('#paperReferenceImage').complete &&
      document.querySelector('#paperReferenceImage').naturalWidth > 0,
  );
  const bad = await page.evaluate(async () => {
    const catalog = await (await fetch('paper/experiments.json')).json(),
      r = PaperSelection.create(catalog, catalog.cases[0].id);
    r.config.resolution = 4;
    return await new Promise((resolve) => {
      const worker = new Worker('paper/worker.js');
      const timer = setTimeout(() => {
        worker.terminate();
        resolve('Timed out awaiting rejection');
      }, 10000);
      worker.onmessage = ({ data }) => {
        if (data.error || data.done) {
          clearTimeout(timer);
          worker.terminate();
          resolve(data.error || 'Unexpectedly completed');
        }
      };
      worker.postMessage(r);
    });
  });
  assert.match(bad, /do not match/);
  await page.context().route('**/paper/engine/polynomial.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()) + '\n/* deliberate integrity-test alteration */',
    });
  });
  const corrupted = await page.evaluate(async () => {
    const catalog = await (await fetch('paper/experiments.json')).json(),
      r = PaperSelection.create(catalog, catalog.cases[0].id);
    return await new Promise((resolve) => {
      const worker = new Worker('paper/worker.js');
      const timer = setTimeout(() => {
        worker.terminate();
        resolve('Timed out awaiting rejection');
      }, 10000);
      worker.onmessage = ({ data }) => {
        if (data.error || data.done) {
          clearTimeout(timer);
          worker.terminate();
          resolve(data.error || 'Unexpectedly completed');
        }
      };
      worker.postMessage(r);
    });
  });
  assert.match(corrupted, /verification failed/);
  await page.context().unroute('**/paper/engine/polynomial.js');
  await page.locator('#paperGroup').selectOption('reciprocal');
  await page.locator('#paperMode').selectOption('custom');
  await page.locator('#paperResolution').fill('32');
  await page.locator('#paperBackend').selectOption('gpu');
  await page.locator('#paperRun').click();
  await waitPaper();
  const gpuRecord = await save('#paperResultJSON', 'gpu-result-record.json');
  if (process.env.REQUIRE_GPU) assert(gpuRecord.outcome.stats.gpu.gpuPixels > 0);
  if (process.env.DISABLE_GPU) assert.equal(gpuRecord.outcome.stats.gpu.gpuPixels, 0);
  assert.equal(gpuRecord.outcome.stats.errors, 0);
  if (gpuRecord.outcome.stats.gpu.gpuPixels > 0) {
    assert.equal(gpuRecord.outcome.stats.gpu.precision.effectiveODE.odeRtol, 1e-6);
    assert.equal(gpuRecord.outcome.stats.gpu.precision.requestedODE.odeRtol, 1e-9);
  } else {
    assert.equal(gpuRecord.outcome.actualBackend, 'CPU');
  }
  assert.equal(Object.keys(gpuRecord.provenance.gpuSHA256).length, 5);
  assert.equal(
    gpuRecord.outcome.stats.gpu.gpuPixels + gpuRecord.outcome.stats.gpu.cpuPixels,
    32 * 32,
  );
  await page.screenshot({ path: path.join(out, 'gpu-asphere-desktop.png') });
  await page.context().route('**/gpu-numerical.wgsl', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()) + '\\n// integrity-test mutation',
    });
  });
  const badGPU = await page.evaluate(async () => {
    const catalog = await (await fetch('paper/experiments.json')).json(),
      recipe = PaperSelection.create(catalog, 'reciprocal', {
        mode: 'custom',
        backend: 'gpu',
        resolution: 4,
      });
    return await new Promise((resolve) => {
      const w = new Worker('paper/worker.js'),
        timer = setTimeout(() => {
          w.terminate();
          resolve('Timeout');
        }, 15000);
      w.onmessage = ({ data }) => {
        if (data.error || data.done) {
          clearTimeout(timer);
          w.terminate();
          resolve(data.error || 'Unexpected completion');
        }
      };
      w.postMessage(recipe);
    });
  });
  assert.match(badGPU, /verification failed/);
  await page.context().unroute('**/gpu-numerical.wgsl');
  await page.locator('#paperGroup').selectOption('hyperbolic');
  await page.locator('#paperMode').selectOption('custom');
  await page.locator('#paperResolution').fill('64');
  await page.locator('#paperRun').click();
  await page.locator('#paperStop').click();
  assert.match(await page.locator('#paperStatus').innerText(), /stopped/);
  assert(await page.locator('#paperResultJSON').isDisabled());
  for (const lang of ['en', 'ja']) {
    await page.locator('#interfaceLanguage').selectOption(lang);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(out, lang + '-mobile.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.locator('#tab-paper').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-gpu').getAttribute('aria-selected'), 'true');
  await page.locator('#tab-render').click();
  assert(await page.locator('aside').isVisible());
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    actualBackend: gpuRecord.outcome.actualBackend,
    gpuPixels: gpuRecord.outcome.stats.gpu.gpuPixels,
    checks: [
      '80-case selection tests are separate',
      'GPU-preferred manuscript defaults and archived CPU mode',
      'complete 256px reference rendering',
      'runtime source hashes',
      'language and custom-scene independence',
      'completed vs selected record separation',
      'spectral custom sampling and full restore',
      '35 article and supplemental reference figures',
      'worker rejects altered settings',
      'worker rejects altered engine and GPU shader',
      'inhomogeneous aspherical GPU rendering and precision records',
      'cancel',
      'mobile layout',
      'keyboard navigation',
    ],
    errors,
  };
  fs.writeFileSync(path.join(out, 'ui-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
