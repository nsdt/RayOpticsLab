// Copy an explicit file list. No bundling, numerical changes or source rewriting.
const fs = require('node:fs');
const path = require('node:path');
const { root, app, manifest, sha256, within, verify } = require('./distribution.cjs');
verify();
const output = path.join(root, 'dist', 'site');
fs.mkdirSync(output, { recursive: true });
for (const name of manifest.files) {
  const destination = within(output, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(within(app, name), destination);
}
// Unexpected stale files cause a failure rather than being uploaded silently.
const checked = verify(output);
const hashes = Object.fromEntries(
  manifest.files.map((name) => [name, sha256(within(output, name))]),
);
fs.writeFileSync(
  path.join(output, 'site-manifest.json'),
  JSON.stringify({ format: 1, sha256: hashes }, null, 2) + '\n',
);
console.log('Built dist/site:', checked);
