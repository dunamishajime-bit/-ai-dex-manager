/**
 * Owner-confirmed STABLE4 hard-cap arithmetic for the NEXT signed release.
 * Does not change the old immutable risk-source SHA or issue an order permit.
 * No dynamic profit tier, TWR or available margin can raise these caps.
 */
export const OWNER_STABLE4_GROSS_HARD_CAP_CANDIDATE=Object.freeze({
  crypto:3.0,stock:4.0,total:4.25,hype:1.5,
});
const EPS=1e-10;
const fail=(why:string):never=>{throw Error("STABLE4_OWNER_GROSS_MATH_INVALID:"+why)};
const nonneg=(v:unknown):v is number=>typeof v==="number"
  &&Number.isFinite(v)&&v>=0;
export type OwnerGrossInput=Readonly<{
  currentCrypto:number;
  currentStock:number;
  currentHype:number;
  pendingCrypto:number;
  pendingStock:number;
  pendingHype:number;
  requestedCrypto:number;
  requestedStock:number;
  requestedHype:number;
}>;
export type OwnerGrossCandidateDecision=Readonly<{
  status:"WITHIN_ABSOLUTE_CAPS_NOT_AUTHORIZED"|"OVER_ABSOLUTE_CAP";
  reasons:readonly string[];
  totals:Readonly<{crypto:number;stock:number;total:number;hype:number}>;
  headroom:Readonly<{crypto:number;stock:number;total:number;hype:number}>;
  tradingAuthorization:false;
}>;
export function evaluateOwnerStable4HardGross(input:OwnerGrossInput):OwnerGrossCandidateDecision{
  for(const [key,value] of Object.entries(input))
    if(!nonneg(value))fail("INVALID_GROSS_"+key);
  if(input.currentHype>input.currentCrypto+EPS
    ||input.pendingHype>input.pendingCrypto+EPS
    ||input.requestedHype>input.requestedCrypto+EPS)
    fail("HYPE_NOT_SUBSET_OF_CRYPTO");
  const c=OWNER_STABLE4_GROSS_HARD_CAP_CANDIDATE;
  const totals={
    crypto:input.currentCrypto+input.pendingCrypto+input.requestedCrypto,
    stock:input.currentStock+input.pendingStock+input.requestedStock,
    hype:input.currentHype+input.pendingHype+input.requestedHype,
    total:input.currentCrypto+input.pendingCrypto+input.requestedCrypto
      +input.currentStock+input.pendingStock+input.requestedStock,
  };
  const reasons=Object.keys(c).filter(k=>totals[k as keyof typeof c]>c[k as keyof typeof c]+EPS)
    .map(k=>"OWNER_GROSS_HARD_CAP_"+k.toUpperCase());
  return Object.freeze({
    status:reasons.length?"OVER_ABSOLUTE_CAP" as const:"WITHIN_ABSOLUTE_CAPS_NOT_AUTHORIZED" as const,
    reasons:Object.freeze(reasons),
    totals:Object.freeze(totals),
    headroom:Object.freeze({
      crypto:Math.max(0,c.crypto-totals.crypto),
      stock:Math.max(0,c.stock-totals.stock),
      hype:Math.max(0,c.hype-totals.hype),
      total:Math.max(0,c.total-totals.total),
    }),
    tradingAuthorization:false as const,
  });
}
