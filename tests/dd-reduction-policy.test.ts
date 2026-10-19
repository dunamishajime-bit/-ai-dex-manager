import assert from "node:assert/strict";
import { test } from "node:test";

import {
    applyCandidatePolicy,
    acceptCandidate,
    buildCandidateGrid,
    freezeAcceptedStage,
    predeclareAcceptanceGates,
    type ResearchProductionPolicy,
} from "../lib/backtest/dd-reduction/policies";
import { SEQUENTIAL_STAGES, type StageId } from "../lib/backtest/dd-reduction/stages";
import type {
    AcceptanceGates,
    BaselineSummary,
    CandidatePolicy,
    CandidateSummary,
    Direction,
    FrozenStageSet,
    ProductionPolicy,
} from "../lib/backtest/dd-reduction/types";
import { assertFixtureIdentity, FIXTURE_HASH, FIXTURE_SCHEMAS } from "../lib/backtest/dd-reduction/fixture-identity";

const HASH = FIXTURE_HASH;

function baseline(overrides: Partial<ResearchProductionPolicy> = {}): ResearchProductionPolicy {
    const base: ResearchProductionPolicy = {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        strategy: "V12_V4",
        direction: "LONG",
        policyHash: HASH,
        reason: "production-baseline",
        fee: 0,
        funding: 0,
        slippage: 0,
        entryPolicy: "entry-v1",
        sizingPolicy: "sizing-v1",
        grossCap: 1_500,
        sharedRiskCap: 500,
        marginGuard: "margin-v1",
        leverage: 1,
        initialStopBps: 500,
        profitFloorBps: 0,
        trailingGivebackBps: 100,
        timeStopBars: null,
        supportedDirections: ["LONG", "SHORT"],
    };
    return assertFixtureIdentity({ ...base, ...overrides }, FIXTURE_SCHEMAS.policy, "policy.baseline");
}

function candidateSummary(overrides: Partial<CandidateSummary> = {}): CandidateSummary {
    const defaultPolicy = buildCandidateGrid("V12_V4_LONG", "LONG", baseline())[0];
    assert.ok(defaultPolicy);
    const base: CandidateSummary = {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        candidateId: defaultPolicy.candidateId,
        stageId: "V12_V4_LONG",
        strategy: "V12_V4",
        direction: "LONG",
        policyHash: defaultPolicy.policyHash,
        accepted: true,
        status: "AVAILABLE",
        candidatePolicy: defaultPolicy,
        baselinePolicy: baseline(),
        reason: "candidate-replay",
        fee: 1,
        funding: 2,
        slippage: 3,
        metrics: {
            normalDdImprovementBps: 120,
            severeDdImprovementBps: 140,
            oosDdImprovementBps: 10,
            walkForwardImprovementBps: 5,
            profitFactorDeclinePct: 5,
            finalEquityDeclinePct: 1,
            tradeCountRatio: 0.95,
            capacityRegression: 0,
            safetyRegression: 0,
            costStressPass: 1,
            candidateSelectionUsesFuturePnl: 0,
        },
    };
    return assertFixtureIdentity({ ...base, ...overrides }, FIXTURE_SCHEMAS.candidateSummary, "policy.candidateSummary");
}

function baselineSummary(overrides: Partial<BaselineSummary> = {}): BaselineSummary {
    const base: BaselineSummary = {
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        strategy: "V12_V4",
        direction: "LONG",
        policyHash: HASH,
        reason: "baseline-replay",
        fee: 1,
        funding: 2,
        slippage: 3,
        metrics: {},
    };
    return assertFixtureIdentity({ ...base, ...overrides }, FIXTURE_SCHEMAS.policy, "policy.baselineSummary");
}

function gates(overrides: Partial<AcceptanceGates> = {}): AcceptanceGates {
    const base = predeclareAcceptanceGates({
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        policyHash: HASH,
        declaredAtTs: 1_700_000_000_000,
    });
    return assertFixtureIdentity({ ...base, ...overrides }, FIXTURE_SCHEMAS.gates, "policy.gates");
}

function initialFrozen(): FrozenStageSet {
    return assertFixtureIdentity({
        sourceHash: HASH,
        configHash: HASH,
        resultHash: HASH,
        policyHash: HASH,
        stageIds: [],
        policies: [],
        reason: "initial-frozen-set",
    }, ["sourceHash", "configHash", "policyHash", "resultHash"], "policy.initialFrozen");
}

test("keeps the sequential stage order immutable", () => {
    assert.deepEqual(SEQUENTIAL_STAGES, [
        "V12_V4_LONG",
        "V12_V4_SHORT",
        "Q102_LONG",
        "Q102_SHORT",
        "PENGU_LONG",
        "PENGU_SHORT",
        "FET",
        "HYPE_LONG",
        "IDLE_SHORT",
        "IDLE_RESIDUAL",
        "V52",
    ] satisfies readonly StageId[]);
});

test("builds independent Long and Short grids without inventing shared policy state", () => {
    const base = baseline();
    const longGrid = buildCandidateGrid("V12_V4_LONG", "LONG", base);
    const shortGrid = buildCandidateGrid("V12_V4_SHORT", "SHORT", base);

    assert.ok(longGrid.length > 0);
    assert.ok(shortGrid.length > 0);
    assert.ok(longGrid.every((candidate) => candidate.direction === "LONG"));
    assert.ok(shortGrid.every((candidate) => candidate.direction === "SHORT"));
    assert.notDeepEqual(longGrid.map((candidate) => candidate.candidateId), shortGrid.map((candidate) => candidate.candidateId));
    assert.equal(base.direction, "LONG");
    assert.deepEqual(base.supportedDirections, ["LONG", "SHORT"]);
});

test("fails closed when a policy identity override is invalid", () => {
    assert.throws(() => baseline({ configHash: "invalid" }), /FIXTURE_HASH_INVALID.*policy\.baseline\.configHash/);
});

test("searches one protection axis at a time in the declared order", () => {
    const grid = buildCandidateGrid("V12_V4_LONG", "LONG", baseline());
    const axes = grid.map((candidate) => candidate.axis);

    assert.deepEqual([...new Set(axes)], ["initial-stop", "profit-floor", "trail", "time-stop"]);
    assert.equal(axes[0], "initial-stop");
    assert.equal(axes.findIndex((axis) => axis === "profit-floor") > axes.findIndex((axis) => axis === "initial-stop"), true);
    assert.equal(axes.findIndex((axis) => axis === "trail") > axes.findIndex((axis) => axis === "profit-floor"), true);
    assert.equal(axes.findIndex((axis) => axis === "time-stop") > axes.findIndex((axis) => axis === "trail"), true);

    for (const candidate of grid.filter((entry) => entry.applicability === "AVAILABLE")) {
        const changed = [
            candidate.initialStopBps !== 500,
            candidate.profitFloorBps !== 0,
            candidate.trailingGivebackBps !== 100,
            candidate.timeStopBars !== null,
        ].filter(Boolean).length;
        assert.equal(changed, 1);
    }
});

test("applies only protection changes and preserves entry, sizing, Gross, and shared-risk controls", () => {
    const base = baseline();
    const candidate = buildCandidateGrid("V12_V4_LONG", "LONG", base).find((entry) => entry.axis === "initial-stop");
    assert.ok(candidate);

    const applied = applyCandidatePolicy(base, candidate);

    assert.notEqual(applied, base);
    assert.equal(applied.entryPolicy, base.entryPolicy);
    assert.equal(applied.sizingPolicy, base.sizingPolicy);
    assert.equal(applied.grossCap, base.grossCap);
    assert.equal(applied.sharedRiskCap, base.sharedRiskCap);
    assert.equal(applied.marginGuard, base.marginGuard);
    assert.equal(applied.leverage, base.leverage);
    assert.equal(applied.initialStopBps, candidate.initialStopBps);
    assert.equal(applied.profitFloorBps, base.profitFloorBps);
    assert.equal(applied.trailingGivebackBps, base.trailingGivebackBps);
    assert.equal(applied.timeStopBars, base.timeStopBars);
});

test("accepts only candidates that pass every predeclared DD, OOS, performance, safety, and cost gate", () => {
    const candidate = candidateSummary();
    const acceptanceGates = gates();
    const before = structuredClone(acceptanceGates);
    const decision = acceptCandidate(candidate, baselineSummary(), acceptanceGates);

    assert.equal(decision.accepted, true);
    assert.equal(decision.status, "ACCEPTED");
    assert.deepEqual(acceptanceGates, before);
    assert.deepEqual(decision.gateResults, {
        normalDrawdown: true,
        severeDrawdown: true,
        outOfSample: true,
        walkForward: true,
        profitFactor: true,
        finalEquity: true,
        tradeCount: true,
        capacity: true,
        safety: true,
        costStress: true,
        noFutureSelection: true,
    });
});

test("rejects a candidate when any fixed gate fails instead of tuning the gate from results", () => {
    const acceptanceGates = gates();
    const before = structuredClone(acceptanceGates);
    const rejected = acceptCandidate(candidateSummary({ metrics: { ...candidateSummary().metrics, severeDdImprovementBps: 99 } }), baselineSummary(), acceptanceGates);

    assert.equal(rejected.accepted, false);
    assert.equal(rejected.status, "REJECTED");
    assert.match(rejected.reason, /severeDrawdown/);
    assert.deepEqual(acceptanceGates, before);
});

test("rejects an accepted candidate when its policy evidence is missing or does not match its identity", () => {
    assert.throws(
        () => candidateSummary({ candidatePolicy: null }),
        /FIXTURE_IDENTITY_INVALID: policy\.candidateSummary\.candidatePolicy must be an object/,
    );

    const policy = buildCandidateGrid("V12_V4_LONG", "LONG", baseline())[0];
    assert.ok(policy);
    const mismatchedPolicy = acceptCandidate(candidateSummary({
        candidateId: "tampered-candidate-id",
        candidatePolicy: policy,
    }), baselineSummary(), gates());
    assert.equal(mismatchedPolicy.accepted, false);
    assert.match(mismatchedPolicy.reason, /candidatePolicy/);
});

test("rejects caller-tuned or incomplete acceptance gate manifests and mismatched provenance", () => {
    const tunedThreshold = acceptCandidate(candidateSummary({ metrics: { ...candidateSummary().metrics, normalDdImprovementBps: 0, severeDdImprovementBps: 0 } }), baselineSummary(), gates({ normalDrawdownImprovementBps: 0, severeDrawdownImprovementBps: 0 }));
    assert.equal(tunedThreshold.accepted, false);
    assert.match(tunedThreshold.reason, /gates/);

    const alteredHash = acceptCandidate(candidateSummary(), baselineSummary(), gates({ gateHash: "ALTERED" }));
    assert.equal(alteredHash.accepted, false);
    assert.match(alteredHash.reason, /gates/);

    const missingDeclaration = acceptCandidate(candidateSummary(), baselineSummary(), gates({ declaredAtTs: undefined }));
    assert.equal(missingDeclaration.accepted, false);
    assert.match(missingDeclaration.reason, /gates/);

    assert.throws(() => candidateSummary({ sourceHash: "b".repeat(64) }), /FIXTURE_HASH_INVALID.*policy\.candidateSummary\.sourceHash/);
});

test("records an unavailable production direction as NOT_APPLICABLE without creating a Short policy", () => {
    const base = baseline({ supportedDirections: ["LONG"] });
    const grid = buildCandidateGrid("V12_V4_SHORT", "SHORT", base);
    assert.equal(grid.length, 1);
    assert.equal(grid[0]?.applicability, "NOT_APPLICABLE");
    assert.equal(grid[0]?.direction, "SHORT");
    assert.equal(grid[0]?.reason, "NOT_APPLICABLE");

    const decision = acceptCandidate(candidateSummary({
        candidateId: grid[0]?.candidateId,
        stageId: "V12_V4_SHORT",
        direction: "SHORT",
        policyHash: HASH,
        status: "NOT_APPLICABLE",
        accepted: false,
        candidatePolicy: null,
        baselinePolicy: baseline({ supportedDirections: ["LONG"] }),
        reason: "NOT_APPLICABLE",
        metrics: {},
    }), baselineSummary({ direction: "SHORT" }), gates());
    assert.equal(decision.status, "NOT_APPLICABLE");
    assert.equal(decision.accepted, false);
});

test("rejects NOT_APPLICABLE when the Production stage and direction are actually supported", () => {
    const decision = acceptCandidate(candidateSummary({
        stageId: "V12_V4_LONG",
        direction: "LONG",
        policyHash: HASH,
        status: "NOT_APPLICABLE",
        accepted: false,
        candidatePolicy: null,
        baselinePolicy: baseline(),
        reason: "NOT_APPLICABLE",
        metrics: {},
    }), baselineSummary(), gates());

    assert.equal(decision.accepted, false);
    assert.equal(decision.status, "REJECTED");
    assert.match(decision.reason, /NOT_APPLICABLE|supported|applicable/);
});

test("rejects a Q102 stage carrying a relabeled V12 policy", () => {
    const v12Policy = buildCandidateGrid("V12_V4_LONG", "LONG", baseline())[0];
    assert.ok(v12Policy);
    const relabeledPolicy = { ...v12Policy, stageId: "Q102_LONG" as const };
    const decision = acceptCandidate(candidateSummary({
        stageId: "Q102_LONG",
        strategy: "V12_V4",
        direction: "LONG",
        candidateId: relabeledPolicy.candidateId,
        policyHash: relabeledPolicy.policyHash,
        candidatePolicy: relabeledPolicy,
        baselinePolicy: baseline(),
    }), baselineSummary(), gates());

    assert.equal(decision.accepted, false);
    assert.equal(decision.status, "REJECTED");
    assert.match(decision.reason, /stage|strategy|metadata/i);
});

test("freezes accepted policy evidence and excludes rejected candidates", () => {
    const base = baseline();
    const acceptedPolicy = buildCandidateGrid("V12_V4_LONG", "LONG", base).find((entry) => entry.axis === "initial-stop");
    assert.ok(acceptedPolicy);
    const accepted = acceptCandidate(candidateSummary({ candidateId: acceptedPolicy.candidateId, candidatePolicy: acceptedPolicy }), baselineSummary(), gates());
    const frozen = freezeAcceptedStage(initialFrozen(), accepted);

    assert.equal(frozen.stageIds.includes("V12_V4_LONG"), true);
    assert.equal(frozen.policies.some((policy) => policy.candidateId === acceptedPolicy.candidateId), true);

    const rejected = acceptCandidate(candidateSummary({ candidateId: "rejected-candidate", metrics: { ...candidateSummary().metrics, normalDdImprovementBps: 0 } }), baselineSummary(), gates());
    const afterRejected = freezeAcceptedStage(frozen, rejected);
    assert.equal(afterRejected.policies.some((policy) => policy.candidateId === "rejected-candidate"), false);
    assert.equal(afterRejected.stageIds.filter((stageId) => stageId === "V12_V4_LONG").length, 1);
});

test("freezes only the next sequential stage and only one policy per stage", () => {
    const q102Base = baseline({ strategy: "Q102" });
    const q102Policy = buildCandidateGrid("Q102_LONG", "LONG", q102Base)[0];
    assert.ok(q102Policy);
    const outOfOrder = acceptCandidate(candidateSummary({
        candidateId: q102Policy.candidateId,
        stageId: "Q102_LONG",
        strategy: "Q102",
        policyHash: q102Policy.policyHash,
        candidatePolicy: q102Policy,
        baselinePolicy: q102Base,
    }), baselineSummary({ strategy: "Q102", policyHash: q102Base.policyHash }), gates());
    const emptyResult = freezeAcceptedStage(initialFrozen(), outOfOrder);
    assert.equal(emptyResult.policies.length, 0);
    assert.match(emptyResult.reason, /V12_V4_LONG/);

    const firstPolicy = buildCandidateGrid("V12_V4_LONG", "LONG", baseline())[0];
    assert.ok(firstPolicy);
    const firstDecision = acceptCandidate(candidateSummary({ candidateId: firstPolicy.candidateId, policyHash: firstPolicy.policyHash, candidatePolicy: firstPolicy }), baselineSummary(), gates());
    const firstFrozen = freezeAcceptedStage(initialFrozen(), firstDecision);
    const duplicate = freezeAcceptedStage(firstFrozen, firstDecision);
    assert.equal(duplicate.policies.length, 1);
    assert.match(duplicate.reason, /duplicate|next/i);
});

test("does not emit no-op candidates when baseline protection values are at the lower boundary", () => {
    const boundary = baseline({ initialStopBps: 1, trailingGivebackBps: 1 });
    const grid = buildCandidateGrid("V12_V4_LONG", "LONG", boundary).filter((candidate) => candidate.applicability === "AVAILABLE");

    assert.ok(grid.length > 0);
    assert.equal(grid.filter((candidate) => candidate.axis === "initial-stop").some((candidate) => candidate.initialStopBps === boundary.initialStopBps), false);
    assert.equal(grid.filter((candidate) => candidate.axis === "trail").some((candidate) => candidate.trailingGivebackBps === boundary.trailingGivebackBps), false);
    assert.equal(new Set(grid.map((candidate) => candidate.candidateId)).size, grid.length);
});

test("does not mutate Production policy state while freezing research replay evidence", () => {
    const base = baseline();
    const candidate = buildCandidateGrid("V12_V4_LONG", "LONG", base).find((entry) => entry.axis === "trail");
    assert.ok(candidate);
    const before = structuredClone(base);
    const applied = applyCandidatePolicy(base, candidate);
    const decision = acceptCandidate(candidateSummary({ candidateId: candidate.candidateId }), baselineSummary(), gates());
    freezeAcceptedStage(initialFrozen(), decision);

    assert.deepEqual(base, before);
    assert.equal(applied.entryPolicy, base.entryPolicy);
    assert.equal(applied.sharedRiskCap, base.sharedRiskCap);
});

void (undefined as Direction | undefined);
void (undefined as CandidatePolicy | undefined);
void (undefined as ProductionPolicy | undefined);
