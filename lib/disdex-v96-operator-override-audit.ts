import type { DisDexV96OperatorOverrideApproval } from "@/lib/disdex-v96-live-risk-controls";
import type { DisDexV96OperatorOverrideAudit } from "@/lib/disdex-v96-runner-state";

export function disDexV96OperatorOverrideAuditFromApproval(
    approval: DisDexV96OperatorOverrideApproval,
): DisDexV96OperatorOverrideAudit {
    return {
        artifactSha256: approval.artifactSha256,
        operator: approval.operator,
        approvedAt: approval.approvedAt,
        expiresAt: approval.expiresAt,
        approvedCommitSha: approval.approvedCommitSha,
        initialPenguGrossCap: approval.initialPenguGrossCap,
        maximumPortfolioGross: approval.maximumPortfolioGross,
        maximumDailyLossPct: approval.maximumDailyLossPct,
        maximumDailyLossUsd: approval.maximumDailyLossUsd,
    };
}

export function disDexV96OperatorOverrideAuditMismatches(
    audit: DisDexV96OperatorOverrideAudit,
    approval: DisDexV96OperatorOverrideApproval,
) {
    const expected = disDexV96OperatorOverrideAuditFromApproval(approval);
    const mismatches: string[] = [];
    for (const key of Object.keys(expected) as Array<keyof DisDexV96OperatorOverrideAudit>) {
        if (audit[key] !== expected[key]) mismatches.push(String(key));
    }
    return mismatches;
}

export function disDexV96OperatorOverrideAuditMatches(
    audit: DisDexV96OperatorOverrideAudit | undefined,
    approval: DisDexV96OperatorOverrideApproval,
) {
    return Boolean(audit && disDexV96OperatorOverrideAuditMismatches(audit, approval).length === 0);
}
