export type IdleAdmissionInput = {
  baselineOpenPositions:number;
  baselineAcceptedThisTimestamp:number;
  baselinePendingExposure:number;
  nonBaselineCryptoExposure:number;
  nonBaselinePendingExposure:number;
  sharedSafetyPass:boolean;
  fullGrossAvailable:number;
  venueFiveXCrossConfirmed:boolean;
};

export type IdleAdmissionResult={accepted:boolean;reason:string;gross:0|1};

export function evaluateIdlePriorityAdmission(input:IdleAdmissionInput):IdleAdmissionResult {
  if(!input.sharedSafetyPass) return {accepted:false,reason:"SHARED_SAFETY_GATE_BLOCKED",gross:0};
  if(input.baselineOpenPositions>0) return {accepted:false,reason:"BASELINE_POSITION_OPEN",gross:0};
  if(input.baselineAcceptedThisTimestamp>0) return {accepted:false,reason:"BASELINE_ACCEPTED_SAME_TIMESTAMP",gross:0};
  if(input.baselinePendingExposure>0) return {accepted:false,reason:"BASELINE_PENDING_EXPOSURE",gross:0};
  if(input.nonBaselineCryptoExposure>0 || input.nonBaselinePendingExposure>0) return {accepted:false,reason:"NON_BASELINE_SIDECAR_EXPOSURE",gross:0};
  if(input.fullGrossAvailable<1) return {accepted:false,reason:"FULL_1X_CAPACITY_UNAVAILABLE",gross:0};
  if(!input.venueFiveXCrossConfirmed) return {accepted:false,reason:"VENUE_5X_CROSS_UNCONFIRMED",gross:0};
  return {accepted:true,reason:"IDLE_ADMISSION_ACCEPTED",gross:1};
}
