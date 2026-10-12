/**
 * Admit a pre-lock, completed-H1 market-only snapshot into an account-critical
 * section only if the runner still owns no position or unresolved order and the
 * current candle boundary is identical. Never reuse external account/risk data.
 */
export function reuseFlatIdleMarketSnapshot<T extends {decisionTs:number}>(
 snapshot:T|undefined, now:number, flat:boolean,
):T|undefined{
 if(!snapshot||!flat||!Number.isFinite(now))return;
 const H=3_600_000;
 const expected=Math.floor(now/H)*H;
 return Number.isSafeInteger(snapshot.decisionTs)&&snapshot.decisionTs===expected?
  snapshot:undefined;
}
