import test from 'node:test';
import assert from 'node:assert/strict';
import {applyWatchdogAuditMode} from '../lib/disdex-watchdog-audit-mode.mjs';
test('audit mode records recovery intent without executing or weakening the operator gate',()=>{
 const restart={action:'RESTART',unit:'fixture',reason:'inactive'};
 assert.equal(applyWatchdogAuditMode(restart,true).action,'RESTART_REQUIRED_NOT_EXECUTED');
 assert.equal(applyWatchdogAuditMode(restart,false),restart);
 const denied={action:'HOLD_FAIL_CLOSED',reason:'OPERATOR_DENIED'};
 assert.equal(applyWatchdogAuditMode(denied,true),denied);
});
