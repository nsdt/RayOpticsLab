// Exercise the deployable files below a project-site URL, not just at '/'.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { root, within, verify } = require('./distribution.cjs');
const site = path.join(root, 'dist', 'site');
verify(site);
const prefix = '/RayOpticsLab/';
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wgsl': 'text/plain',
  '.css': 'text/css',
  '.png': 'image/png',
  '.zip': 'application/zip',
};
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    const file = within(site, pathname.slice(prefix.length) || 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(response);
  } catch {
    response.writeHead(400).end();
  }
});
function run(test, url) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(process.execPath, [path.join(root, 'tests/browser', test)], {
      cwd: root,
      env: { ...process.env, APP_URL: url },
      stdio: 'inherit',
    });
    processHandle.on('error', reject);
    processHandle.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${test}: exit ${code}`)),
    );
  });
}
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}${prefix.slice(0, -1)}`;
  try {
    await run('test-free-ui.cjs', url + '/');
    await run('test-paper-ui.cjs', url);
    console.log('Project-subpath browser checks passed.');
  } finally {
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
