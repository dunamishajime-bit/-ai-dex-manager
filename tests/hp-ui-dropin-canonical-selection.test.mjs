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
    assert.match(source, /canonical_dropin=\"\\$dropin_dir\\/90-current-ui-release\\.conf\"/);
    assert.match(source, /CANONICAL_UI_DROPIN_MISSING/);
    assert.match(source, /CANONICAL_UI_WORKDIR_MISMATCH/);
    assert.match(source, /CANONICAL_UI_SHA_MISMATCH/);
    assert.match(source, /stale_dropins=\"\\$backup_root\\/stale-dropins\"/);
    assert.match(source, /STALE_DROPIN_ARCHIVED=/);
    assert.match(source, /cp -a -- \"\\$f\" \"\\$stale_dropins\\/\\$base\"/);
    assert.match(source, /rm -f -- \"\\$f\"/);
    assert.match(source, /cp -a -- \"\\$backup_root\\/canonical\\.conf\" \"\\$canonical_dropin\"/);
    assert.match(source, /HP_UI_ROLLBACK_ATTEMPTED=TRUE/);
    assert.doesNotMatch(source, /WORKDIR_DROPIN_COUNT=/);
    assert.doesNotMatch(source, /SHA_DROPIN_COUNT=/);
  });
}
