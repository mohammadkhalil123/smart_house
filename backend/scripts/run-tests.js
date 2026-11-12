// Runs every compiled test file (dist/tests/*.test.js) with Node's built-in test runner.
// Listing the files explicitly keeps this working across Node versions and on Windows.
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = join(__dirname, '..', 'dist', 'tests');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => join(dir, f));

if (files.length === 0) {
  console.error(`No compiled test files found in ${dir}. Run "npm run build" first.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
