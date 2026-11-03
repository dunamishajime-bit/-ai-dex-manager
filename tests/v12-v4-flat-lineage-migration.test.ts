import test from "node:test";
import assert from "node:assert/strict";
import { createProductionState,planProductionEntry,applyProductionEvent,HOUR } from "../lib/v12-v4-production-lifecycle";
import { v4OrderIdentity,V4ExecutionStore,type V4ExecutionDocument } from "../lib/v12-v4-execution-store";
import {evaluateV12V4Routes} from "../lib/v12-multilogic-v4-shadow";
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { migrateFlatV4State, type V4FlatLineageEvidence } from "../lib/v12-v4-flat-lineage-migration";
import { parseMigrationArgs } from "../scripts/v12-v4-flat-lineage-migration";

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const LEG_ID = "LTCUSDT:FAILED_BREAK_REV_SHORT_6H:SHORT:1791799200000";
const CID = v4OrderIdentity(OLD_SHA, LEG_ID, "ENTRY", 0);
const ACK = "I_ACK_V12_V4_FLAT_LINEAGE_MIGRATION_AFTER_SIGNED_RECONCILIATION";

test("migration CLI preserves the case-sensitive operator ACK and normalizes only SHAs", () => {
    const parsed = parseMigrationArgs(["node", "migration.ts", "--apply", "--old-sha", OLD_SHA.toUpperCase(), "--new-sha", NEW_SHA.toUpperCase(), "--ack", ACK]);
    assert.deepEqual(parsed, { expectedOldSha: OLD_SHA, newSha: NEW_SHA });
    assert.throws(
        () => parseMigrationArgs(["node", "migration.ts", "--apply", "--old-sha", OLD_SHA, "--new-sha", NEW_SHA, "--ack", ACK.toLowerCase()]),
        /V4_FLAT_LINEAGE_MIGRATION_ACK_REQUIRED/,
    );
    const valid=["node","migration.ts","--apply","--old-sha",OLD_SHA,"--new-sha",NEW_SHA,"--ack",ACK];
    assert.throws(()=>parseMigrationArgs([...valid,"--new-sha",NEW_SHA]),/DUPLICATE/);
    assert.throws(()=>parseMigrationArgs([...valid,"--force"]),/UNKNOWN/);
});

function flatObserved(): V4ExecutionDocument {
    const foreign = [{ owner: "FET", symbol: "FETUSDT", side: "LONG" as const, qty: 298, gross: 0, pendingGross: 0, crypto: true }];
    const state = createProductionState({ equityUsd: 72, foreign, holdProtected: false });
    return {
        schema: 2,
        releaseSha: OLD_SHA,
        revision: 0,
        state,
        intents: {},
        protections: {},
    };
}

function evidence(overrides: Partial<V4FlatLineageEvidence> = {}): V4FlatLineageEvidence {
    return {
        observedAt: 1_000,
        accountEquityUsd: 71.5,
        availableBalanceUsd: 70,
        prices: { FETUSDT: 0.234 },
        positions: [{ symbol: "FETUSDT", positionAmt: "298" }],
        openOrders: [
            { symbol: "FETUSDT", origQty: "298", executedQty: "0", reduceOnly: true, status: "NEW" },
            { symbol: "FETUSDT", origQty: "298", executedQty: "0", reduceOnly: true, status: "NEW" },
        ],
        pendingEntries: [],
        ...overrides,
    };
}

test("flat SHA migration retains closed trade PnL, cooldown, journal, legacy client IDs and terminal STOP history",async()=>{
 const observed=flatObserved();const ts=200*HOUR;
 const base=evaluateV12V4Routes({symbol:'ETHUSDT',sourceSide:'SHORT',sourceSignalTs:ts,age:2,volRatio:.5,er24:.5})[0];
 const candidate={...base,route:'REC_X01_TIME_24H',family:'RECOVERY_X' as const,symbol:'ETHUSDT',requestedGross:.1,effectiveSide:'LONG' as const};
 const reserved=await planProductionEntry(observed.state,{candidate,ts,eventId:'reserve',referencePrice:30,minimumOrderNotionalUsd:5,entryAtr:2,quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,px:number)=>({quantity:Math.floor((q+1e-10)/.01)*.01,notional:Math.floor((q+1e-10)/.01)*.01*px,stepSize:.01})} as any});
 let state=applyProductionEvent(observed.state,reserved);const id=reserved.leg.id;
 state=applyProductionEvent(state,{type:'ENTRY_FILL',id,eventId:'entry',ts:ts+1,qty:.2,price:30,feeUsd:.02});
 state=applyProductionEvent(state,{type:'ENTRY_TERMINAL',id,eventId:'terminal',ts:ts+2});
 state=applyProductionEvent(state,{type:'EXIT_REQUEST',id,eventId:'exit-request',ts:ts+3,qty:.2});
 state=applyProductionEvent(state,{type:'EXIT_FILL',id,eventId:'exit',ts:ts+4,qty:.2,price:33,feeUsd:.02,cooldownUntil:ts+HOUR});
 const cid=v4OrderIdentity(OLD_SHA,id,'STOP',0);
 Object.assign(observed,{state,revision:7,intents:{[cid]:{clientOrderId:cid,legId:id,action:'STOP',sequence:0,stage:'TERMINAL',createdAt:ts,updatedAt:ts+4}},protections:{[id]:{legId:id,phase:'CLOSED',protectedQty:0,updatedAt:ts+4,stopClientOrderId:cid}}});
 const folder=mkdtempSync(join(tmpdir(),'v4-flat-history-'));
 try {
  const oldPath=join(folder,'old.json');writeFileSync(oldPath,JSON.stringify(observed));new V4ExecutionStore(oldPath,OLD_SHA).read();
  const migrated=migrateFlatV4State({observed,expectedOldSha:OLD_SHA,newSha:NEW_SHA,evidence:evidence({observedAt:ts+1000})});
  assert.deepEqual(migrated.intents,observed.intents);assert.deepEqual(migrated.protections,observed.protections);
  assert.deepEqual(migrated.state.legs,observed.state.legs);assert.deepEqual(migrated.state.cooldown,observed.state.cooldown);
  assert.deepEqual(migrated.state.journal.slice(0,-1),observed.state.journal);assert.equal(migrated.revision,observed.revision);
  assert.ok(migrated.legacyReleaseShas?.includes(OLD_SHA));
  const newPath=join(folder,'new.json');writeFileSync(newPath,JSON.stringify(migrated));new V4ExecutionStore(newPath,NEW_SHA).read();
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test("flat lineage migration preserves foreign ownership and creates a new-SHA empty V4 ledger", () => {
    const migrated = migrateFlatV4State({ observed: flatObserved(), expectedOldSha: OLD_SHA, newSha: NEW_SHA, evidence: evidence() });
    assert.equal(migrated.releaseSha, NEW_SHA);
    assert.equal(migrated.revision, 0);
    assert.deepEqual(migrated.intents, {});
    assert.deepEqual(migrated.protections, {});
    assert.deepEqual(migrated.state.legs, {});
    assert.equal(migrated.state.foreign[0]?.owner, "FET");
    assert.equal(migrated.state.equityUsd, 71.5);
    assert.equal(migrated.state.journal.length, 1);
    assert.equal(migrated.state.journal[0]?.type, "ACCOUNT_MARK");
});

test("flat lineage migration fails closed on active owned lifecycle", () => {
    const observed = flatObserved();
    observed.state.legs[LEG_ID] = {
        id: LEG_ID,
        candidate: {} as any,
        qty: 0,
        entryNotional: 0,
        requestedQty: 1,
        reservationUsd: 1,
        entryTs: 900,
        status: "PENDING_ENTRY",
        exitRemainingQty: 0,
        realizedUsd: 0,
        feesUsd: 0,
        fundingUsd: 0,
    };
    assert.throws(
        () => migrateFlatV4State({ observed, expectedOldSha: OLD_SHA, newSha: NEW_SHA, evidence: evidence() }),
        /V4_FLAT_LINEAGE_ACTIVE_LIFECYCLE/,
    );
});

test("flat lineage migration fails closed on unknown pending exposure, unmanaged order, or mismatch", () => {
    assert.throws(
        () => migrateFlatV4State({
            observed: flatObserved(),
            expectedOldSha: OLD_SHA,
            newSha: NEW_SHA,
            evidence: evidence({ pendingEntries: [{ strategyId: "V12_V4", status: "UNKNOWN" } as any] }),
        }),
        /V4_FLAT_LINEAGE_PENDING_EXPOSURE/,
    );
    assert.throws(
        () => migrateFlatV4State({
            observed: flatObserved(),
            expectedOldSha: OLD_SHA,
            newSha: NEW_SHA,
            evidence: evidence({ openOrders: [{ symbol: "FETUSDT", origQty: "298", reduceOnly: false, status: "NEW" }] }),
        }),
        /V4_FLAT_LINEAGE_UNMANAGED_ORDER/,
    );
    assert.throws(
        () => migrateFlatV4State({
            observed: flatObserved(),
            expectedOldSha: OLD_SHA,
            newSha: NEW_SHA,
            evidence: evidence({ positions: [{ symbol: "FETUSDT", positionAmt: "297" }] }),
        }),
        /V4_FLAT_LINEAGE_POSITION_MISMATCH/,
    );
});
