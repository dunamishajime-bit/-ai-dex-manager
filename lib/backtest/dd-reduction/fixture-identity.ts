import { createHash } from "node:crypto";

export type FixtureIdentityField = "sourceHash" | "productionSha" | "configHash" | "policyHash" | "resultHash";

export interface FixtureIdentitySchema {
    readonly required: readonly FixtureIdentityField[];
    readonly requiredNested?: Readonly<Record<string, FixtureIdentitySchema>>;
    readonly nested?: Readonly<Record<string, FixtureIdentitySchema>>;
    readonly items?: FixtureIdentitySchema;
    readonly nullable?: boolean;
}

const IDENTITY_FIELDS = new Set<FixtureIdentityField>([
    "sourceHash",
    "productionSha",
    "configHash",
    "policyHash",
    "resultHash",
]);

const LIFECYCLE_FIELDS = ["sourceHash", "configHash", "policyHash", "resultHash"] as const satisfies readonly FixtureIdentityField[];
const POLICY_FIELDS = ["sourceHash", "configHash", "policyHash", "resultHash"] as const satisfies readonly FixtureIdentityField[];

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

function nullable(required: readonly FixtureIdentityField[]): FixtureIdentitySchema {
    return { required, nullable: true };
}

const fillSchema: FixtureIdentitySchema = { required: ["sourceHash"] };
const policyInputSchema: FixtureIdentitySchema = { required: ["configHash", "policyHash"] };
const policySchema: FixtureIdentitySchema = { required: POLICY_FIELDS };
const eventSchema: FixtureIdentitySchema = {
    required: LIFECYCLE_FIELDS,
    requiredNested: {
        reservation: nullable(["sourceHash"]),
        fill: nullable(["sourceHash"]),
        exit: nullable(["sourceHash"]),
    },
};
const baselineRowSchema: FixtureIdentitySchema = {
    required: LIFECYCLE_FIELDS,
    requiredNested: {
        reservation: nullable(["sourceHash"]),
        entry: nullable(["sourceHash"]),
        finalExit: nullable(["sourceHash"]),
    },
};
const positionSchema: FixtureIdentitySchema = {
    required: LIFECYCLE_FIELDS,
    requiredNested: {
        reservation: nullable(["sourceHash"]),
        entryFill: nullable(["sourceHash"]),
        exit: nullable(["sourceHash"]),
        events: { items: eventSchema, required: [] },
    },
};
const stateSchema: FixtureIdentitySchema = {
    required: LIFECYCLE_FIELDS,
    requiredNested: {
        positions: { items: positionSchema, required: [] },
        events: { items: eventSchema, required: [] },
    },
};
const sourceSchema: FixtureIdentitySchema = {
    required: ["productionSha"],
    requiredNested: {
        input: { required: ["productionSha"] },
        candleSeries: {
            required: [],
            items: {
                required: ["sourceHash"],
                requiredNested: { bars: { items: fillSchema, required: [] } },
            },
        },
        baselineLedger: { required: [], items: baselineRowSchema },
        candidateEvents: { required: [], items: eventSchema },
    },
};

export const FIXTURE_SCHEMAS = {
    fill: fillSchema,
    bar: fillSchema,
    exit: fillSchema,
    policy: policySchema,
    policyInput: policyInputSchema,
    event: eventSchema,
    baselineRow: {
        ...baselineRowSchema,
    },
    candidateRow: eventSchema,
    tradePath: {
        required: LIFECYCLE_FIELDS,
        requiredNested: {
            reservation: nullable(["sourceHash"]),
            entry: nullable(["sourceHash"]),
            exit: nullable(["sourceHash"]),
            bars: { items: fillSchema, required: [] },
        },
    },
    position: {
        ...positionSchema,
    },
    policyBundle: {
        required: LIFECYCLE_FIELDS,
        requiredNested: { policy: policySchema },
    },
    candidateSummary: {
        required: LIFECYCLE_FIELDS,
        requiredNested: {
            candidatePolicy: { ...policySchema, nullable: true },
            baselinePolicy: policySchema,
        },
    },
    frozenSet: {
        required: LIFECYCLE_FIELDS,
        requiredNested: { policies: { required: [], items: policySchema } },
    },
    replayConfig: { required: ["sourceHash", "configHash", "policyHash"] },
    state: stateSchema,
    replaySource: { required: ["productionSha"], requiredNested: { source: sourceSchema } },
    gates: { required: LIFECYCLE_FIELDS },
} as const satisfies Record<string, FixtureIdentitySchema>;

function validateSchema(value: unknown, schema: FixtureIdentitySchema, path: string): void {
    if (value === null || value === undefined) {
        if (schema.nullable) return;
        throw new Error(`FIXTURE_IDENTITY_INVALID: ${path} must be an object`);
    }
    if (schema.items !== undefined) {
        if (!Array.isArray(value)) throw new Error(`FIXTURE_IDENTITY_INVALID: ${path} must be an array`);
        value.forEach((entry, index) => validateSchema(entry, schema.items!, `${path}[${index}]`));
        return;
    }
    if (!isRecord(value)) throw new Error(`FIXTURE_IDENTITY_INVALID: ${path} must be an object`);
    for (const field of schema.required) assertHash(value[field], `${path}.${field}`);
    for (const [key, nestedSchema] of Object.entries(schema.requiredNested ?? {})) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw new Error(`FIXTURE_NESTED_MISSING: ${path}.${key} is required by the fixture identity schema`);
        }
        validateSchema(value[key], nestedSchema, `${path}.${key}`);
    }
    for (const [key, nestedSchema] of Object.entries(schema.nested ?? {})) {
        if (Object.prototype.hasOwnProperty.call(value, key)) validateSchema(value[key], nestedSchema, `${path}.${key}`);
    }
}

function schemaFor(requiredFieldsOrSchema: readonly FixtureIdentityField[] | FixtureIdentitySchema): FixtureIdentitySchema {
    if (Array.isArray(requiredFieldsOrSchema)) return { required: requiredFieldsOrSchema as readonly FixtureIdentityField[] };
    return requiredFieldsOrSchema as FixtureIdentitySchema;
}

export function assertFixtureIdentity<T>(
    value: T,
    requiredFieldsOrSchema: readonly FixtureIdentityField[] | FixtureIdentitySchema,
    context: string,
): T {
    if (!isRecord(value)) throw new Error(`FIXTURE_IDENTITY_INVALID: ${context} must be an object`);
    validateSchema(value, schemaFor(requiredFieldsOrSchema), context);

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
