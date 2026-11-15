/** Type-only source snapshot: frozen Git 9118eeaa6... lib/dd1296-entry-policy.ts.
 * Exact original SideLossLedger shape, no runtime risk or order functions imported. */
export interface SideLossLedger {
  LONG?:{losses:number;until:number};
  SHORT?:{losses:number;until:number};
  completed?:string[];
  initializedAt?:number;
}
