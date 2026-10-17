import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const routePath = join(root, 'app', 'realtime', 'page.tsx');

assert.equal(existsSync(routePath), true, 'realtime route source must exist');
const source = readFileSync(routePath, 'utf8');
assert.match(source, /RealtimeRankingBoard/, 'realtime route must render the ranking board');

console.log('realtime route presence: PASS');
