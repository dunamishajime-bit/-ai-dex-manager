/** Capability boundary for state-migration evidence. Rate budget and signing
 * remain in AsterV3Client; the transport itself cannot mutate venue state. */
export function createV4MigrationReadOnlyFetch(transport:typeof fetch=fetch):typeof fetch {
 return (async(input,init)=>{
  const request=input instanceof Request?input:undefined;
  const url=new URL(request?request.url:String(input));
  const method=String(init?.method||request?.method||'GET').toUpperCase();
  if(method!=='GET'||url.origin!=='https://fapi.asterdex.com'||url.username||url.password||url.hash||
     !['/fapi/v3/balance','/fapi/v3/positionRisk','/fapi/v3/openOrders'].includes(url.pathname)||init?.body)
   throw Error('V4_MIGRATION_READ_ONLY_TRANSPORT_REQUIRED');
  return transport(input,{...init,redirect:'error'});
 }) as typeof fetch;
}
