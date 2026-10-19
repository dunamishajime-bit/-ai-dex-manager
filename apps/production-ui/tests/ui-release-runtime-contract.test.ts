import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('UI release packages the runtime dependencies required by standalone server.js', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const workflow = readFileSync(resolve(testDir, '../../../.github/workflows/realtime-full-gates-q102-deploy-20261006.yml'), 'utf8');
  assert.match(workflow, /cp -a node_modules\/\. \.deploy-ui\/node_modules\//);
  assert.match(workflow, /node_modules\/next\/dist\/server\/lib\/cpu-profile\.js/);
  assert.match(workflow, /test -f \.deploy-ui\/node_modules\/next\/dist\/server\/lib\/cpu-profile\.js/);
});

test('UI deployment uses a lexically-last dedicated drop-in and rolls it back atomically', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const workflow = readFileSync(resolve(testDir, '../../../.github/workflows/realtime-full-gates-q102-deploy-20261006.yml'), 'utf8');

  assert.match(workflow, /final_prefix="\$\(printf '%\*s' 250 '' \| tr ' ' '~'\)"/);
  assert.match(workflow, /final_dropin="\$dropin_dir\/\$\{final_prefix\}\.conf"/);
  assert.match(workflow, /final_dropin_backup=.*before-\$TARGET_SHA/);
  assert.match(workflow, /cp -a "\$final_dropin" "\$final_dropin_backup"/);
  assert.match(workflow, /WorkingDirectory=\$release[\s\S]*final_dropin/);
  assert.match(workflow, /systemctl show "\$ui_service" -p WorkingDirectory --value/);
  assert.match(workflow, /cp -a "\$final_dropin_backup" "\$final_dropin"/);
  assert.match(workflow, /rm -f "\$final_dropin"/);
});
