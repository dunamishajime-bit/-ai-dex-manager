import test from "node:test";
import assert from "node:assert/strict";
import {privateKeyToAccount} from "viem/accounts";
import {recoverTypedDataAddress} from "viem";
import {AsterV3Client} from "../lib/aster-v3-client";

const testKey = ("0x" + "11".repeat(32)) as `0x${string}`; // PUBLIC SYNTHETIC KEY, NEVER USE FOR FUNDS
const testUser = "0x" + "22".repeat(20);
const domain = (chainId:number)=>({
 name:"AsterSignTransaction" as const,version:"1" as const,chainId,
 verifyingContract:"0x0000000000000000000000000000000000000000" as const,
});
const types={Message:[{name:"msg" as const,type:"string" as const}]};

for(const [name,host,chainId] of [
 ["live","https://fapi.asterdex.com",1666],
 ["testnet","https://fapi.asterdex-testnet.com",714],
] as const){
 test(name+" signed GET uses exact Aster EIP-712 chain and original query",async()=>{
  let captured:URL|undefined;
  const transport:typeof fetch=async input=>{
   captured=new URL(String(input));
   return new Response("[]",{status:200,headers:{"content-type":"application/json"}});
  };
  const client=new AsterV3Client({baseUrl:host,privateKey:testKey,
   userAddress:testUser,fetchImpl:transport,readOnlyRateLimitMaxRetries:0});
  await client.getBalances();
  assert.ok(captured);
  assert.equal(captured.origin,host);
  assert.equal(captured.pathname,"/fapi/v3/balance");
  const signature=captured.searchParams.get("signature");
  assert.ok(signature);
  assert.equal(captured.searchParams.get("user")?.toLowerCase(),testUser.toLowerCase());
  assert.equal(captured.searchParams.get("signer")?.toLowerCase(),
   privateKeyToAccount(testKey).address.toLowerCase());
  const without=new URLSearchParams(captured.searchParams);
  without.delete("signature");
  const signedMessage=without.toString();
  const recovered=await recoverTypedDataAddress({domain:domain(chainId),types,
   primaryType:"Message",message:{msg:signedMessage},signature:signature as `0x${string}`});
  assert.equal(recovered.toLowerCase(),privateKeyToAccount(testKey).address.toLowerCase());
  const wrong=await recoverTypedDataAddress({domain:domain(chainId===714?1666:714),types,
   primaryType:"Message",message:{msg:signedMessage},signature:signature as `0x${string}`});
  assert.notEqual(wrong.toLowerCase(),privateKeyToAccount(testKey).address.toLowerCase());
 });
}
