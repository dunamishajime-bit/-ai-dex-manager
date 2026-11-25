/**
 * Separate H48+resident STOP8 policy evidence. The unchanged H1 research
 * time-window contract is NOT a grant under the old H48_TIME_ONLY certificate.
 * A new Root+Owner bundle must be verified before prepare; the order writer
 * verifies the Root bundle again before POST.
 */
import {createHash} from "node:crypto";
import {validateH48ExecutionJournal,type H48ExecutionJournal} from "./hype-h48-execution-journal";
import {
  validateHypeH48TimeOnlyContract,evaluateHypeH48TimeOnlyExit,
  type HypeH48TimeOnlyContract,
} from "./hype-stable4-time-only-contract";
import type {H48ProtectedRestartResult} from "./hype-h48-protected-restart";
const fail=(reason:string):never=>{throw Error("H48_STOP8_PREPARE_BLOCKED:"+reason)};
const isTime=(x:unknown):x is number=>typeof x==="number"&&Number.isSafeInteger(x)&&x>0;
const isPositive=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x)&&x>0;
const HOUR=3_600_000;
export interface H48Stop8RootPositionEvidence {
  schema:"disdex-h48-stop8-position-policy-evidence/v1";
  policy:"H48_R4_RESIDENT_STOP8";
  runtimeSha:string;planSha256:string;
  positionId:string;logicalEntryTs:number;logicalExitTs:number;
  quantity:number;certificateSha256:string;validatedAt:number;expiresAt:number;
}
export function validateH48Stop8PositionEvidence(input:{
  proof:unknown;contract:HypeH48TimeOnlyContract;quantity:number;
  runtimeSha:string;planSha256:string;now:number;
}):H48Stop8RootPositionEvidence {
  const {proof:raw,now}=input;
  const c=validateHypeH48TimeOnlyContract(input.contract,input.contract);
  if(!raw||typeof raw!=="object"||Array.isArray(raw))fail("ROOT_PROOF_FIELDS");
  const p=raw as H48Stop8RootPositionEvidence;
  const fields=["schema","policy","runtimeSha","planSha256","positionId",
    "logicalEntryTs","logicalExitTs","quantity","certificateSha256","validatedAt","expiresAt"];
  if(Object.keys(p).length!==fields.length||Object.keys(p).some(k=>!fields.includes(k))
    ||p.schema!=="disdex-h48-stop8-position-policy-evidence/v1"
    ||p.policy!=="H48_R4_RESIDENT_STOP8"
    ||p.runtimeSha!==input.runtimeSha||p.runtimeSha!==c.sourceSha
    ||!(/^[a-f0-9]{64}$/.test(p.planSha256))||p.planSha256!==input.planSha256
    ||p.positionId!==c.positionId
    ||p.logicalEntryTs!==c.logicalEntryTs||p.logicalExitTs!==c.logicalExitTs
    ||!isPositive(input.quantity)||p.quantity!==input.quantity
    ||typeof p.certificateSha256!=="string"||!/^[a-f0-9]{64}$/.test(p.certificateSha256)
    ||!isTime(now)||!isTime(p.validatedAt)||!isTime(p.expiresAt)
    ||p.validatedAt>now||now-p.validatedAt>30_000
    ||p.expiresAt<=now||p.expiresAt-p.validatedAt>120_000)
    fail("ROOT_PROOF_INVALID");
  return p;
}
const orderId=(sha:string,position:string,phase:"ENTRY"|"EXIT")=>
  (phase==="ENTRY"?"h48e-":"h48x-")+createHash("sha256")
    .update([sha,position,phase].join("|")).digest("hex").slice(0,30);
export function prepareH48Stop8Entry(input:{
  state:H48ExecutionJournal;
  contract:HypeH48TimeOnlyContract;
  evidence:H48Stop8RootPositionEvidence;
  planSha256:string;
  quantity:number;referencePrice:number;now:number;
}):H48ExecutionJournal {
  const s=validateH48ExecutionJournal(input.state,input.state.sourceSha);
  const c=validateHypeH48TimeOnlyContract(input.contract,input.contract);
  if(s.mode!=="FLAT"||c.sourceSha!==s.sourceSha
    ||!isPositive(input.referencePrice)||!isTime(input.now)
    ||s.research.lastEvaluatedEntryTs!==c.logicalEntryTs
    ||s.research.nextBaseEligibleTs!==c.logicalExitTs
    ||input.now<c.logicalEntryTs||input.now-c.logicalEntryTs>120_000)
    fail("ENTRY_RESEARCH_OR_PORTFOLIO_NOT_READY");
  const proof=validateH48Stop8PositionEvidence({
    proof:input.evidence,contract:c,quantity:input.quantity,
    runtimeSha:s.sourceSha,planSha256:input.planSha256,now:input.now,
  });
  const next:H48ExecutionJournal={...s,revision:s.revision+1,mode:"ENTRY_PENDING",
    pending:{
      phase:"ENTRY",stage:"PREPARED",
      contract:c,quantity:input.quantity,referencePrice:input.referencePrice,
      clientOrderId:orderId(s.sourceSha,c.positionId,"ENTRY"),
      certificateSha256:proof.certificateSha256,
      authorizationExpiresAt:proof.expiresAt,
      preparedAt:input.now,submittedAt:null,
    }};
  return validateH48ExecutionJournal(next,s.sourceSha);
}
export function prepareH48Stop8TimeExit(input:{
  state:H48ExecutionJournal;
  contract:HypeH48TimeOnlyContract;
  evidence:H48Stop8RootPositionEvidence;
  planSha256:string;
  signedProtectedRestart:H48ProtectedRestartResult;
  exitBoundary:{openTs:number;open:number;observedAt:number};
  now:number;
}):H48ExecutionJournal {
  const s=validateH48ExecutionJournal(input.state,input.state.sourceSha);
  if(s.mode!=="OPEN"||!s.position
    ||input.signedProtectedRestart.decision!=="OPEN_STOP8_VERIFIED_READ_ONLY"
    ||!isTime(input.now))
    fail("EXIT_NOT_PROTECTED");
  const c=validateHypeH48TimeOnlyContract(input.contract,input.contract);
  const livePosition=s.position!;
  const same=livePosition.contract.positionId===c.positionId&&c.sourceSha===s.sourceSha;
  if(!same||input.now<c.logicalExitTs||input.now-c.logicalExitTs>120_000)
    fail("EXIT_POSITION_OR_DEADLINE");
  const due=evaluateHypeH48TimeOnlyExit(c,input.now,input.exitBoundary);
  if(due.due!==true)fail("TIME48_NOT_DUE");
  const proof=validateH48Stop8PositionEvidence({
    proof:input.evidence,contract:c,quantity:livePosition.quantity,
    runtimeSha:s.sourceSha,planSha256:input.planSha256,now:input.now,
  });
  return validateH48ExecutionJournal({
    ...s,revision:s.revision+1,mode:"EXIT_PENDING",
    pending:{phase:"EXIT",stage:"PREPARED",
      clientOrderId:orderId(s.sourceSha,c.positionId,"EXIT"),
      contract:c,quantity:livePosition.quantity,referencePrice:due.referenceOpen,
      certificateSha256:proof.certificateSha256,
      authorizationExpiresAt:proof.expiresAt,
      preparedAt:input.now,submittedAt:null,
    },
  },s.sourceSha);
}
