import { createHash } from "node:crypto";

export type FixtureIdentityField = "sourceHash" | "productionSha" | "configHash" | "policyHash" | "resultHash";

const IDENTITY_FIELDS = new Set<FixtureIdentityField>([
    "sourceHash",
    "productionSha",
    "configHash",
    "policyHash",
    "resultHash",
]);

export const FIXTURE_HASH = createHash("sha256")
    .update("dis-dex-manager-dd-reduction-deterministic-fixture-v1", "utf8")
    .digest("hex");

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isPlaceholderHash(value: string): boolean {
    return /^(.)\1{63}$/.test(value) || /^(?:HASH|PLACEHOLDER|TODO|UNKNOWN|UNDEFINED|NULL)$/i.test(value);
}

function assertHash(value: unknown, path: string): asserts value is string {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value) || isPlaceholderHash(value)) {
        throw new Error(`FIXTURE_HASH_INVALID: ${path} must be a canonical non-placeholder 64-hex SHA256`);
    }
}

export function assertFixtureIdentity<T>(value: T, requiredFields: readonly FixtureIdentityField[], context: string): T {
    if (!isRecord(value)) throw new Error(`FIXTURE_IDENTITY_INVALID: ${context} must be an object`);
    for (const field of requiredFields) assertHash(value[field], `${context}.${field}`);

    const seen = new Set<object>();
    const visit = (current: unknown, path: string): void => {
        if (Array.isArray(current)) {
            if (seen.has(current)) return;
            seen.add(current);
            current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
            return;
        }
        if (!isRecord(current) || seen.has(current)) return;
        seen.add(current);
        for (const [key, child] of Object.entries(current)) {
            const childPath = `${path}.${key}`;
            if (IDENTITY_FIELDS.has(key as FixtureIdentityField)) assertHash(child, childPath);
            visit(child, childPath);
        }
    };

    visit(value, context);
    return value;
}
