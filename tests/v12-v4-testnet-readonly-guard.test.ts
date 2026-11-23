import test from "node:test";
import assert from "node:assert/strict";
import {assertV4TestnetEndpoint} from "../scripts/v12-v4-aster-testnet-readonly-certification";

test("testnet-only probe cannot target live or arbitrary hosts",()=>{
 assert.equal(assertV4TestnetEndpoint("https://fapi.asterdex-testnet.com"),
  "https://fapi.asterdex-testnet.com");
 for(const uri of [
  "https://fapi.asterdex.com","http://fapi.asterdex-testnet.com",
  "https://fapi.asterdex-testnet.com.attacker.invalid",
  "https://fapi.asterdex-testnet.com/",
  "https://fapi.asterdex-testnet.com:443",
 ])assert.throws(()=>assertV4TestnetEndpoint(uri),/V4_TESTNET_BASE_URL/);
});
