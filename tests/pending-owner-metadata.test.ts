import assert from 'node:assert/strict';
import test from 'node:test';
import {validatePendingPinMetadata} from '../lib/disdex-pending-owner-evidence';
test('only the root-owned canonical pin authority is usable for ownership reconciliation',()=>{
 const good={uid:0,mode:0o644,regular:true,symlink:false,parentUid:0,parentMode:0o755,parentDirectory:true,parentSymlink:false};
 assert.doesNotThrow(()=>validatePendingPinMetadata(good));
 for(const change of [{uid:1000},{mode:0o664},{symlink:true},{parentUid:1000},{parentMode:0o775},{parentSymlink:true}]){
  assert.throws(()=>validatePendingPinMetadata({...good,...change}),/PIN_FILE_UNTRUSTED/);
 }
});
