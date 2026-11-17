const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || undefined,
    headless: true,
    args: process.env.DISABLE_GPU ? ['--disable-webgpu'] : [],
  });
  try {
    const page = await browser.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await require('../helpers/browser-environment.cjs').configure(page);
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:8877');
    await page.waitForFunction(
      () => finished && !document.querySelector('#render').disabled,
      null,
      { timeout: 120000 },
    );
    const render = async (backend) => {
      await page.evaluate((backend) => {
        config = {
          ...SceneConfig.standard(),
          material: 'heliconical',
          preset: 'custom',
          shape: 'cube',
          resolution: 16,
          computeBackend: backend,
        };
        sync();
        window.render();
      }, backend);
      await page.waitForFunction(
        () => finished && !document.querySelector('#render').disabled,
        null,
        { timeout: 120000 },
      );
      return page.evaluate(() => ({
        stats: lastResult.stats,
        png: document.querySelector('#view').toDataURL(),
      }));
    };
    const cpu = await render('cpu');
    assert.equal(cpu.stats.error, 0);
    const gpu = await render('gpu');
    assert.equal(gpu.stats.error, 0);
    if (process.env.REQUIRE_GPU) assert(gpu.stats.gpu.gpuPixels > 0);
    if (process.env.DISABLE_GPU) assert.equal(gpu.stats.gpu.gpuPixels, 0);
    const reused = await render('gpu');
    if (gpu.stats.gpu.gpuPixels > 0) {
      assert(reused.stats.gpu.deviceReused);
      assert(reused.stats.gpu.pipelineCacheHit);
    }
    assert.equal(reused.png, gpu.png);
    await page.evaluate(() => {
      config.resolution = 64;
      config.computeBackend = 'cpu';
      render();
      stop();
    });
    const rerender = await render('cpu');
    assert.equal(rerender.png, cpu.png);
    for (const language of ['ja', 'en']) {
      await page.locator('#interfaceLanguage').selectOption(language);
      assert.equal(await page.locator('#view').evaluate((canvas) => canvas.toDataURL()), cpu.png);
    }
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      actualBackend: gpu.stats.gpu.actual,
      gpuPixels: gpu.stats.gpu.gpuPixels,
      checks: [
        'CPU rendering',
        'GPU rendering',
        'GPU device/pipeline reuse',
        'cancel and rerender',
        'Japanese/English switching preserves pixels',
      ],
      errors,
    };
    fs.mkdirSync(path.join(__dirname, '../../test-results/browser'), { recursive: true });
    fs.writeFileSync(
      path.join(__dirname, '../../test-results/browser/free-ui.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
