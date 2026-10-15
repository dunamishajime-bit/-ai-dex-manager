/** Read-only feasibility policy for exact 1x Idle quantities. Never places orders.
 * A venue-mandated ONE-step floor is permitted at most 1% below target.
 * This does not modify the order runner, portfolio caps or operator gates.
 */
export type IdleNormalizedLot = {
  symbol: string;
  equityUsd: number;
  referencePrice: number;
  normalizedQuantity: number;
  normalizedNotional: number;
  minQuantity: number;
  maxQuantity: number;
  quantityStep: number;
  minNotional: number;
};
export type IdleLotVerdict = {
  accepted: boolean;
  code: "VENUE_STEP_ROUNDING_OK" | "FULL_1X_EXACT" |
    "INPUT_INVALID" | "VENUE_MIN_QTY" | "VENUE_MIN_NOTIONAL" |
    "VENUE_MAX_QTY" | "QUANTITY_NOT_ONE_STEP_FLOOR" |
    "ORDER_OVER_1X" | "ROUNDING_LOSS_TOO_LARGE";
  actualGross: number | null;
  requiredGross: 1;
  orderQuantity: number;
  sideEffects: 0;
};
const finitePositive = (v: number) => Number.isFinite(v) && v > 0;
const reject = (code: IdleLotVerdict["code"], q: number, gross: number | null): IdleLotVerdict =>
  ({accepted:false,code,actualGross:gross,requiredGross:1,orderQuantity:q,sideEffects:0});
export function evaluateIdleOneStepFloor(input: IdleNormalizedLot): IdleLotVerdict {
  const x = input;
  const values = [x.equityUsd,x.referencePrice,x.normalizedQuantity,x.normalizedNotional,
    x.minQuantity,x.maxQuantity,x.quantityStep,x.minNotional];
  if (values.some(v=>!Number.isFinite(v)) || !finitePositive(x.equityUsd) ||
    !finitePositive(x.referencePrice) || !finitePositive(x.quantityStep) ||
    !finitePositive(x.maxQuantity) || !finitePositive(x.minQuantity) ||
    !finitePositive(x.normalizedQuantity) || x.minNotional < 0)
    return reject("INPUT_INVALID",x.normalizedQuantity,null);
  const gross = x.normalizedNotional / x.equityUsd;
  const desired = x.equityUsd / x.referencePrice;
  if (x.normalizedQuantity < x.minQuantity) return reject("VENUE_MIN_QTY",x.normalizedQuantity,gross);
  if (x.normalizedQuantity > x.maxQuantity || desired > x.maxQuantity)
    return reject("VENUE_MAX_QTY",x.normalizedQuantity,gross);
  if (x.normalizedNotional < x.minNotional) return reject("VENUE_MIN_NOTIONAL",x.normalizedQuantity,gross);
  const toler = Math.max(1e-9, x.quantityStep * 1e-7);
  const expectedFloor = Math.floor((desired + toler) / x.quantityStep) * x.quantityStep;
  // Report an impossible or manipulated normalized lot as invalid, not a rounding allowance.
  if (Math.abs(x.normalizedQuantity-expectedFloor) > toler ||
    Math.abs(x.normalizedNotional - x.referencePrice*x.normalizedQuantity)>Math.max(1e-7,x.equityUsd*1e-7))
    return reject("QUANTITY_NOT_ONE_STEP_FLOOR",x.normalizedQuantity,gross);
  if (gross > 1+1e-9 || x.normalizedQuantity > desired+toler)
    return reject("ORDER_OVER_1X",x.normalizedQuantity,gross);
  if (gross < 0.99-1e-9)
    return reject("ROUNDING_LOSS_TOO_LARGE",x.normalizedQuantity,gross);
  return {accepted:true,code:gross < 1-1e-6 ? "VENUE_STEP_ROUNDING_OK" : "FULL_1X_EXACT",
    actualGross:gross,requiredGross:1,orderQuantity:x.normalizedQuantity,sideEffects:0};
}
