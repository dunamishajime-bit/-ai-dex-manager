import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflows = [
  '.github/workflows/disdex-hp-approval-ui-production-deploy.yml',
  '.github/workflows/disdex-hp-standard-approval-ui-deploy.yml',
];

for (const file of workflows) {
  test('canonical UI drop-in selection is fail-closed in ' + file, () => {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(source.includes('canonical_dropin="$dropin_dir/90-current-ui-release.conf"'));
    assert.ok(source.includes('CANONICAL_UI_DROPIN_MISSING'));
    assert.ok(source.includes('CANONICAL_UI_WORKDIR_MISMATCH'));
    assert.ok(source.includes('CANONICAL_UI_SHA_MISMATCH'));
    assert.ok(source.includes('stale_dropins="$backup_root/stale-dropins"'));
    assert.ok(source.includes('STALE_DROPIN_ARCHIVED='));
    assert.ok(source.includes('cp -a -- "$f" "$stale_dropins/$base"'));
    assert.ok(source.includes('rm -f -- "$f"'));
    assert.ok(source.includes('cp -a -- "$backup_root/canonical.conf" "$canonical_dropin"'));
    assert.ok(source.includes('HP_UI_ROLLBACK_ATTEMPTED=TRUE'));
    assert.ok(!source.includes('WORKDIR_DROPIN_COUNT='));
    assert.ok(!source.includes('SHA_DROPIN_COUNT='));
  });
}
