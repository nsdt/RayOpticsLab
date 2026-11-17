// Simulate a browser whose WebGPU API cannot obtain an adapter. Intercepting
// worker responses also covers worker-only navigator instances, unlike page mocks.
async function configure(page) {
  if (!process.env.DISABLE_GPU) return;
  await page.context().route(/\/worker\.js(?:\?|$)/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        "Object.defineProperty(self.navigator, 'gpu', { value: { requestAdapter: async () => null } });\n" +
        (await response.text()),
    });
  });
}
module.exports = { configure };
