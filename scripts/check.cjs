// Run the maintained CPU regression suite in isolated processes.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const unit = path.join(root, 'tests', 'unit');
// Browser tests and historical aggregate runners have separate environments.
const tests = fs
  .readdirSync(unit)
  .filter((name) => {
    if (!/^test.*\.cjs$/.test(name) || /regressions|compatibility/.test(name)) return false;
    return !/playwright|chromium/.test(fs.readFileSync(path.join(unit, name), 'utf8'));
  })
  .sort();
const failures = [];
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(unit, test)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${test}`);
  if (result.status !== 0) {
    failures.push(test);
    console.error(result.error || result.stderr || result.stdout);
  }
}
console.log(`${tests.length - failures.length}/${tests.length} test files passed.`);
process.exitCode = failures.length ? 1 : 0;
