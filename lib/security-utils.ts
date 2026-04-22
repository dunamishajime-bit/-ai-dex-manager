export type SecurityMethod = "email" | "totp" | "passkey";

export type SecuritySettings = {
  enabled: boolean;
  minMethods: number;
  methods: Record<SecurityMethod, boolean>;
  updatedAt?: number;
};

type LegacySecuritySettings = {
  requireAllMethods?: boolean;
};

type SecuritySettingsInput = {
  enabled?: boolean;
  minMethods?: number;
  methods?: Partial<Record<SecurityMethod, boolean>>;
  updatedAt?: number;
  requireAllMethods?: boolean;
} | null | undefined;

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  enabled: false,
  minMethods: 2,
  methods: {
    email: true,
    totp: true,
    passkey: false,
  },
};

export function normalizeSecuritySettings(input?: SecuritySettingsInput): SecuritySettings {
  const legacy = input as LegacySecuritySettings | undefined;
  const enabledFromLegacy = legacy?.requireAllMethods === true;
  const methods = {
    email: input?.methods?.email ?? DEFAULT_SECURITY_SETTINGS.methods.email,
    totp: input?.methods?.totp ?? DEFAULT_SECURITY_SETTINGS.methods.totp,
    passkey: input?.methods?.passkey ?? DEFAULT_SECURITY_SETTINGS.methods.passkey,
  };
  return {
    enabled: input?.enabled ?? enabledFromLegacy ?? DEFAULT_SECURITY_SETTINGS.enabled,
    minMethods: Math.max(2, input?.minMethods ?? DEFAULT_SECURITY_SETTINGS.minMethods),
    methods,
    updatedAt: input?.updatedAt,
  };
}

export function maskEmail(email?: string) {
  if (!email || !email.includes("@")) return "";
  const [local, domain] = email.split("@");
  const keep = local.slice(0, 2);
  return `${keep}${"*".repeat(Math.max(2, local.length - 2))}@${domain}`;
}
