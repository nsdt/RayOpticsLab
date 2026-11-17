const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'app');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'distribution/site-files.json'), 'utf8'),
);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function within(base, name) {
  assert(
    !path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'),
    `Invalid relative path: ${name}`,
  );
  const target = path.resolve(base, name);
  assert(target.startsWith(path.resolve(base) + path.sep), `Path leaves directory: ${name}`);
  return target;
}
function filesUnder(directory, prefix = '') {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      assert(!entry.isSymbolicLink(), `Symlink is not a distribution file: ${entry.name}`);
      const name = prefix + entry.name;
      return entry.isDirectory()
        ? filesUnder(path.join(directory, entry.name), name + '/')
        : [name];
    })
    .sort();
}
function verify(directory = app) {
  assert.equal(new Set(manifest.files).size, manifest.files.length, 'Duplicate manifest entries');
  assert.deepEqual(
    filesUnder(directory).filter((name) => name !== 'site-manifest.json'),
    manifest.files,
    'Application files and distribution manifest differ. Review additions before including them.',
  );
  for (const name of manifest.files) {
    assert(fs.statSync(within(directory, name)).isFile(), name);
    assert(!/(^|\/)(node_modules|dev|tests|test-results|review[^/]*)(\/|$)/.test(name), name);
  }
  const paper = path.join(directory, 'paper');
  const provenance = JSON.parse(fs.readFileSync(path.join(paper, 'provenance.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(paper, 'experiments.json'), 'utf8'));
  const check = (file, expected) => assert.equal(sha256(file), expected, file);
  check(path.join(paper, 'experiments.json'), provenance.configurationSHA256);
  check(path.join(paper, 'protocol.js'), provenance.protocolSHA256);
  for (const [name, hash] of Object.entries(provenance.packagedEngineSHA256))
    check(within(path.join(paper, 'engine'), name), hash);
  for (const [name, hash] of Object.entries(provenance.runtimeSHA256))
    check(within(paper, name), hash);
  for (const [name, hash] of Object.entries(provenance.gpuSHA256))
    check(within(directory, name), hash);
  for (const figure of catalog.figures) check(within(directory, figure.file), figure.sha256);
  check(path.join(paper, 'analysis-reproduction.zip'), provenance.analysisArchiveSHA256);
  // Project Pages are served below /repository/. Internal URLs must stay relative.
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
    const url = match[1].split('?')[0];
    if (/^[a-z]+:/i.test(url) || url === './') continue;
    assert(!url.startsWith('/'), `Root-relative URL breaks project Pages: ${url}`);
    assert(fs.existsSync(within(directory, url.split('?')[0])), `Missing HTML asset: ${url}`);
  }
  return {
    files: manifest.files.length,
    cases: catalog.cases.length,
    figures: catalog.figures.length,
  };
}
module.exports = { root, app, manifest, sha256, within, filesUnder, verify };
