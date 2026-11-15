import type {AccountLockDocument} from "./disdex-account-order-lock";
import type {PendingExposureEntry} from "./disdex-pending-exposure-registry";
import type {DirectTradeCommand} from "./direct-trade-executor";
import {v4OrderIdentity,type V4ExecutionDocument} from "./v12-v4-execution-store";
import {Stable4EntryGrossAdmissionError} from "./stable4-entry-gross-guard";

/** A V4 CID reservation is journal-bound rather than created by lease.reserve().
 * Caller supplies its replay-validated store snapshot while holding the real
 * shared lease. This proof replaces only that exact unsent ENTRY reservation.
 */
export function assertStable4V4ReservationOwnership(input:{sourceSha:string;lease:AccountLockDocument;document:V4ExecutionDocument;row:PendingExposureEntry;command:Pick<DirectTradeCommand,"clientOrderId"|"symbol"|"side"|"quantity"|"reduceOnly">}):void{
 const fail=()=>{throw new Stable4EntryGrossAdmissionError("OWN_RESERVATION_CONFLICT","V4 durable entry reservation not bound to current V4 lease");};
 const {sourceSha:sha,lease,document:d,row,command:c}=input;
 if(!/^[a-f0-9]{40}$/.test(sha)||lease?.schema!=="disdex-account-lock/v1"||lease.accountScope!=="ASTER_FUTURES"||lease.ownerId!=="V12_V4_RUNNER"||d?.schema!==2||d.releaseSha!==sha||d.state?.executionReview||!row||!c||c.reduceOnly===true||!Number.isFinite(c.quantity)||c.quantity<=0)fail();
 const intent=d.intents?.[c.clientOrderId],leg=intent&&d.state.legs[intent.legId];
 const raw=intent?.command;
 const durable=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw as Record<string,unknown>:undefined;
 const expectedSide=c.side==="BUY"?"LONG":c.side==="SELL"?"SHORT":undefined;
 if(!intent||!leg||!durable||!expectedSide||intent.clientOrderId!==c.clientOrderId||intent.action!=="ENTRY"||intent.stage!=="SUBMITTING"||intent.venueOrderId!==undefined||
  !Number.isSafeInteger(intent.sequence)||intent.sequence<0||v4OrderIdentity(sha,intent.legId,"ENTRY",intent.sequence)!==c.clientOrderId||
  leg.id!==intent.legId||leg.status!=="PENDING_ENTRY"||leg.qty!==0||leg.requestedQty!==c.quantity||leg.candidate.symbol!==c.symbol||leg.candidate.effectiveSide!==expectedSide||
  durable.action!=="ENTRY"||durable.legId!==leg.id||durable.sequence!==intent.sequence||durable.symbol!==c.symbol||durable.positionSide!==expectedSide||durable.quantity!==c.quantity||durable.signalTs!==leg.entryTs||
  row.reservationId!==c.clientOrderId||row.idempotencyKey!==c.clientOrderId||row.strategyId!=="V12_V4"||row.sleeve!=="CRYPTO"||row.symbol!==c.symbol||row.side!==expectedSide||row.runtimeSha!==sha||row.status!=="PENDING"||
  typeof row.notionalUsd!=="number"||!Number.isFinite(row.notionalUsd)||row.notionalUsd<=0||row.notionalUsd!==leg.reservationUsd||typeof row.gross!=="number"||!Number.isFinite(row.gross)||row.gross<=0)fail();
}
