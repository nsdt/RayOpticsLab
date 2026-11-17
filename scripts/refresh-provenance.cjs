// Refresh only maintained runtime hashes. Historical experiment inputs must
// remain unchanged; a mismatch is an error, not an invitation to bless it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../app');
const paper = path.join(root, 'paper');
const file = path.join(paper, 'provenance.json');
const record = JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(
  sha256(path.join(paper, 'experiments.json')),
  record.configurationSHA256,
  'Historical experiment settings changed. Use the catalog generation workflow.',
);
for (const [name, expected] of Object.entries(record.packagedEngineSHA256)) {
  assert.equal(
    sha256(path.join(paper, 'engine', name)),
    expected,
    `Historical engine changed: ${name}`,
  );
}
record.protocolSHA256 = sha256(path.join(paper, 'protocol.js'));
for (const name of Object.keys(record.runtimeSHA256)) {
  record.runtimeSHA256[name] = sha256(path.join(paper, name));
}
for (const name of Object.keys(record.gpuSHA256)) {
  record.gpuSHA256[name] = sha256(path.join(root, name));
}
fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
console.log(
  'Updated runtime hashes. Historical engine and experiment settings verified unchanged.',
);
