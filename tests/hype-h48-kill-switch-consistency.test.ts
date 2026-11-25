import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  H48_CANONICAL_KILL_SWITCH,H48_KILL_SWITCH_ALIASES,
  validateH48CanonicalKillPaths,inspectH48CanonicalKillSwitch,
} from "../lib/hype-h48-kill-switch-consistency";

function allCanonical():NodeJS.ProcessEnv {
  return Object.fromEntries(H48_KILL_SWITCH_ALIASES.map(key=>[key,H48_CANONICAL_KILL_SWITCH]));
}

test("all seven H48 Kill Switch aliases must resolve to canonical GLOBAL protection",()=>{
  assert.equal(H48_KILL_SWITCH_ALIASES.length,7);
  assert.equal(validateH48CanonicalKillPaths(allCanonical()),H48_CANONICAL_KILL_SWITCH);
  for(const name of H48_KILL_SWITCH_ALIASES){
    const bad={...allCanonical(),[name]:"/home/deploy/ai-dex-manager-v96-paper/.runtime-state/disdex-v13d-v11eq-v96/kill-switch.json"};
    assert.throws(()=>validateH48CanonicalKillPaths(bad),new RegExp("H48_KILL_SWITCH_ENV_ALIAS_MISMATCH:"+name));
    const missing={...allCanonical()};
    delete missing[name];
    assert.throws(()=>validateH48CanonicalKillPaths(missing),new RegExp("H48_KILL_SWITCH_ENV_ALIAS_MISMATCH:"+name));
  }
});

test("HYPE last-loaded operator env generator pins every Kill Switch alias",()=>{
  const script=readFileSync(new URL("../scripts/ops/root/disdex-current-runtime-wiring",import.meta.url),"utf8");
  const start=script.indexOf('  write_atomic "$HYPE_OPERATOR_ENV_FILE" "');
  const end=script.indexOf('DISDEX_TRADE_FILL_STRATEGY_ID=HYPE_LONG"',start);
  assert.ok(start>0&&end>start,"HYPE last-loaded env generator missing");
  const config=script.slice(start,end);
  for(const name of H48_KILL_SWITCH_ALIASES) {
    assert.equal(config.split(name+"=${SHARED_ROOT}/kill-switch.json").length-1,1,
      "missing or duplicate final override "+name);
  }
  const unit=readFileSync(new URL("../ops/systemd/disdex-hype-long@.service",import.meta.url),"utf8");
  const last=unit.indexOf("EnvironmentFile=-/etc/disdex/current-runtime/%i.hype-operator.env");
  assert.ok(last>0);
  assert.ok(last>unit.indexOf("EnvironmentFile=/etc/disdex/disdex-v13d-v11eq-v96.env"));
});

test("the H48 canonical checker never treats an absent live Kill Switch as clear",async()=>{
  const env=allCanonical();
  await assert.rejects(inspectH48CanonicalKillSwitch(env));
});
