import test from "node:test";
import assert from "node:assert/strict";
import * as gates from "../lib/pengu-stable4-opportunity";

test("Recovery V8 causal BTC24 boundary is exact, LIVE only, and fails closed for invalid values",()=>{
 const pass=(gates as any).stable4PenguRecoveryV8Pass;
 assert.equal(typeof pass,"function");
 const cutoff=.011611625094354983;
 assert.equal(pass("LIVE",{btcReturn24h:cutoff}),true);
 assert.equal(pass("LIVE",{btcReturn24h:cutoff+1e-10}),false);
 for(const x of [NaN,Infinity,-Infinity,undefined,null])assert.equal(pass("LIVE",{btcReturn24h:x}),false);
 for(const mode of ["OFF","SHADOW"])assert.equal(pass(mode,{btcReturn24h:1}),true);
});
