import { V12_V4_V2_CAPS } from "./v12-v4-v2-shadow";

/** V4's private production envelope, separate from the common peer contract. */
export const V12_V4_CERTIFIED_GROSS_CONTRACT = Object.freeze({
  v12: V12_V4_V2_CAPS.v12Gross,
  crypto: V12_V4_V2_CAPS.cryptoGross,
  total: V12_V4_V2_CAPS.totalGross,
  recovery: V12_V4_V2_CAPS.recoveryFamilyGross,
});
