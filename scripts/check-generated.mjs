import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function snapshot(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? snapshot(path) : [path, readFileSync(path, 'utf8')];
  });
}
const snapshotAll = () => JSON.stringify([
  snapshot('api/generated'), snapshot('frontend/src/api'),
  readFileSync('backend/internal/api/generated.go', 'utf8'),
]);
const before = snapshotAll();
execFileSync('mise', ['run', 'generate'], { stdio: 'inherit' });
if (before !== snapshotAll()) {
  throw new Error('Generated API files were stale. Review changes from mise run generate.');
}
