"use client";

import { useEffect, useMemo, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { HelpCircle, Settings2, ShieldCheck, Smartphone, UserCircle2 } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import { getCurrentUser, saveUser, setCurrentUser } from "@/lib/user-store";
import {
  DEFAULT_SECURITY_SETTINGS,
  normalizeSecuritySettings,
  type SecurityMethod,
} from "@/lib/security-utils";

function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-gold-400/16 bg-[linear-gradient(180deg,rgba(8,10,15,0.40),rgba(4,6,10,0.78))] p-4 shadow-[0_0_24px_rgba(253,224,71,0.05)] backdrop-blur-[10px] md:p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl border border-gold-400/18 bg-white/[0.04] p-3">
          <Icon className="h-5 w-5 text-gold-100" />
        </div>
        <div>
          <h2 className="text-base font-black text-white">{title}</h2>
          <p className="mt-1 text-[11px] leading-5 text-white/72">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-gold-100/70">{label}</span>
      {children}
    </label>
  );
}

function MethodCard({
  label,
  description,
  active,
  provisioned,
  onToggle,
}: {
  label: string;
  description: string;
  active: boolean;
  provisioned: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-2xl border px-4 py-3 text-left transition ${
        active ? "border-gold-400/40 bg-gold-400/10 text-white" : "border-white/12 bg-white/[0.03] text-white/72"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold">{label}</div>
          <div className="mt-1 text-xs leading-5 text-white/65">{description}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
              active ? "border-gold-400/30 bg-gold-400/10 text-gold-100" : "border-white/12 text-white/55"
            }`}
          >
            {active ? "有効" : "無効"}
          </span>
          <span
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
              provisioned ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-white/12 text-white/55"
            }`}
          >
            {provisioned ? "登録済み" : "未登録"}
          </span>
        </div>
      </div>
    </button>
  );
}

export default function SettingsPage() {
  const { logout, user: authUser, refreshUsers } = useAuth();
  const { currency, setCurrency } = useCurrency();

  const [nickname, setNickname] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);

  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [securityMethods, setSecurityMethods] =
    useState<Record<SecurityMethod, boolean>>(DEFAULT_SECURITY_SETTINGS.methods);

  const [totpSecret, setTotpSecret] = useState("");
  const [totpQrCode, setTotpQrCode] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [totpProvisioned, setTotpProvisioned] = useState(false);
  const [isGeneratingTotp, setIsGeneratingTotp] = useState(false);
  const [isVerifyingTotp, setIsVerifyingTotp] = useState(false);

  const [passkeyProvisioned, setPasskeyProvisioned] = useState(false);
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);

  useEffect(() => {
    const current = getCurrentUser();
    const security = normalizeSecuritySettings(current?.securitySettings || authUser?.securitySettings);
    const hasPasskey = Boolean(
      (current?.webAuthnCredentials?.length || 0) > 0 ||
        authUser?.hasPasskey ||
        (authUser?.webAuthnCredentials?.length || 0) > 0,
    );
    const hasTotp = Boolean(
      current?.isTotpEnabled || authUser?.isTotpEnabled || current?.totpSecret || authUser?.totpSecret,
    );

    setNickname(current?.displayName || authUser?.nickname || "");
    setTwoFactorEnabled(Boolean(security.enabled));
    setSecurityMethods(security.methods);
    setTotpSecret(current?.totpSecret || authUser?.totpSecret || "");
    setTotpQrCode("");
    setTotpToken("");
    setTotpProvisioned(hasTotp);
    setPasskeyProvisioned(hasPasskey);
  }, [authUser]);

  const selectedMethodCount = useMemo(
    () => Object.values(securityMethods).filter(Boolean).length,
    [securityMethods],
  );

  const hasLoginEmail = Boolean(authUser?.email || getCurrentUser()?.email);

  async function persistSecurityPreferences(
    nextEnabled: boolean,
    nextMethods: Record<SecurityMethod, boolean>,
  ) {
    const current = getCurrentUser();
    if (!current) return;

    setSavingSecurity(true);
    setStatusMessage("");

    const nextSecuritySettings = normalizeSecuritySettings({
      enabled: nextEnabled,
      minMethods: 2,
      methods: nextMethods,
      updatedAt: Date.now(),
    });
    const nextTotpEnabled = Boolean(nextEnabled && nextMethods.totp && totpProvisioned);
    const nextUser = {
      ...current,
      securitySettings: nextSecuritySettings,
      isTotpEnabled: nextTotpEnabled,
      totpSecret: nextTotpEnabled ? totpSecret : undefined,
      webAuthnCredentials: current.webAuthnCredentials || [],
      lastLogin: Date.now(),
    };

    saveUser(nextUser);
    setCurrentUser(nextUser);

    try {
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: current.id,
          email: current.email,
          displayName: nextUser.displayName,
          isTotpEnabled: nextTotpEnabled,
          totpSecret: nextTotpEnabled ? totpSecret : "",
          webAuthnCredentials: nextUser.webAuthnCredentials,
          securitySettings: nextSecuritySettings,
          lastLogin: nextUser.lastLogin,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        setStatusMessage(json.error || "2FA設定の保存に失敗しました。");
        return;
      }

      await refreshUsers();
      if (nextEnabled && selectedMethodCount < 2) {
        setStatusMessage("2FAは有効です。認証方法は2つ以上あると安定します。");
      } else if (nextEnabled && nextMethods.totp && !totpProvisioned) {
        setStatusMessage("2FAは有効です。Google Authenticator はまだ未登録です。");
      } else {
        setStatusMessage("2FA設定を保存しました。");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "2FA設定の保存に失敗しました。");
    } finally {
      setSavingSecurity(false);
    }
  }

  async function toggleMethod(method: SecurityMethod) {
    const nextMethods = { ...securityMethods, [method]: !securityMethods[method] };
    setSecurityMethods(nextMethods);
    await persistSecurityPreferences(twoFactorEnabled, nextMethods);
  }

  async function toggleTwoFactor() {
    const nextEnabled = !twoFactorEnabled;
    setTwoFactorEnabled(nextEnabled);
    await persistSecurityPreferences(nextEnabled, securityMethods);
  }

  async function generateTotp() {
    const baseEmail = (authUser?.email || getCurrentUser()?.email || "").trim();
    if (!baseEmail) {
      setStatusMessage("ログイン用メールが見つかりません。");
      return;
    }

    setIsGeneratingTotp(true);
    setStatusMessage("");

    try {
      const response = await fetch("/api/settings/totp/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: baseEmail }),
      });
      const json = await response.json();

      if (!json.success) {
        setStatusMessage(json.error || "Google Authenticator のQR生成に失敗しました。");
        return;
      }

      setTotpSecret(json.secret || "");
      setTotpQrCode(json.qrCodeUrl || "");
      setTotpProvisioned(false);
      setTotpToken("");
      setStatusMessage("QRコードを生成しました。Google Authenticator で読み取り、確認コードを入力してください。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Google Authenticator のQR生成に失敗しました。");
    } finally {
      setIsGeneratingTotp(false);
    }
  }

  async function verifyTotp() {
    if (!totpSecret || !totpToken.trim()) {
      setStatusMessage("確認コードを入力してください。");
      return false;
    }

    setIsVerifyingTotp(true);
    setStatusMessage("");

    try {
      const response = await fetch("/api/settings/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: totpToken.trim(), secret: totpSecret }),
      });
      const json = await response.json();
      const ok = Boolean(json.success && json.isValid);
      setTotpProvisioned(ok);
      if (!ok) {
        setStatusMessage("Google Authenticator のコードが正しくありません。");
        return false;
      }

      await persistSecurityPreferences(twoFactorEnabled, securityMethods);
      setStatusMessage("Google Authenticator を登録しました。");
      return true;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "確認コードの検証に失敗しました。");
      return false;
    } finally {
      setIsVerifyingTotp(false);
    }
  }

  async function registerPasskey() {
    const current = getCurrentUser();
    if (!current) {
      setStatusMessage("いったんログインし直してからお試しください。");
      return;
    }

    setIsRegisteringPasskey(true);
    setStatusMessage("");

    try {
      const optionsRes = await fetch("/api/auth/webauthn/generate-registration-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: current.id,
          userName: current.email,
        }),
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok || options.error) {
        setStatusMessage(options.error || "パスキー登録の準備に失敗しました。");
        return;
      }

      const registrationResponse = await startRegistration(options);
      const verifyRes = await fetch("/api/auth/webauthn/verify-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationResponse }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok || !verifyJson.verified || !verifyJson.credential) {
        setStatusMessage(verifyJson.error || "パスキー登録に失敗しました。");
        return;
      }

      const latest = getCurrentUser() || current;
      const nextCredentials = [...(latest.webAuthnCredentials || current.webAuthnCredentials || []), verifyJson.credential];
      const nextUser = {
        ...latest,
        webAuthnCredentials: nextCredentials,
      };

      saveUser(nextUser);
      setCurrentUser(nextUser);
      setPasskeyProvisioned(true);
      await persistSecurityPreferences(twoFactorEnabled, securityMethods);
      setStatusMessage("パスキーを登録しました。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "パスキー登録に失敗しました。");
    } finally {
      setIsRegisteringPasskey(false);
    }
  }

  async function saveAccount() {
    const current = getCurrentUser();
    if (!current) return;

    setSavingAccount(true);
    setStatusMessage("");

    try {
      const nextSecuritySettings = normalizeSecuritySettings({
        enabled: twoFactorEnabled,
        minMethods: 2,
        methods: securityMethods,
        updatedAt: Date.now(),
      });
      const nextTotpEnabled = Boolean(twoFactorEnabled && securityMethods.totp && totpProvisioned);
      const nextPasskeys = current.webAuthnCredentials || [];

      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: current.id,
          email: current.email,
          displayName: nickname.trim() || current.displayName,
          isTotpEnabled: nextTotpEnabled,
          totpSecret: nextTotpEnabled ? totpSecret : "",
          webAuthnCredentials: nextPasskeys,
          securitySettings: nextSecuritySettings,
          lastLogin: Date.now(),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        setStatusMessage(json.error || "設定の保存に失敗しました。");
        return;
      }

      const nextUser = {
        ...current,
        ...json.user,
        displayName: nickname.trim() || current.displayName,
        securitySettings: nextSecuritySettings,
        isTotpEnabled: nextTotpEnabled,
        totpSecret: nextTotpEnabled ? totpSecret : undefined,
        webAuthnCredentials: nextPasskeys,
      };

      saveUser(nextUser);
      setCurrentUser(nextUser);
      await refreshUsers();
      setStatusMessage("設定を保存しました。");
    } finally {
      setSavingAccount(false);
    }
  }

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
      <div className="absolute inset-0 bg-[url('/backgrounds/login_bg.png')] bg-cover bg-center opacity-[0.22] mix-blend-screen" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.10),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.06),transparent_26%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,0.22),rgba(3,5,10,0.68))]" />

      <div className="relative z-10 space-y-3">
        <header className="rounded-[30px] border border-gold-400/18 bg-[linear-gradient(180deg,rgba(8,10,15,0.34),rgba(4,6,10,0.62))] p-4 backdrop-blur-[10px] md:p-5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-100/72">
            <Settings2 className="h-3.5 w-3.5" />
            Settings
          </div>
          <h1 className="mt-2 text-[2rem] font-black tracking-tight text-white md:text-[2.8rem]">設定</h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-white/82">
            表示名、表示通貨、2FA を自分用の運用環境に合わせて整えます。
          </p>
        </header>

        {statusMessage ? (
          <div className="rounded-[22px] border border-gold-400/18 bg-white/[0.03] px-4 py-3 text-sm text-white/88">
            {statusMessage}
          </div>
        ) : null}

        <section className="grid gap-3 xl:grid-cols-2">
          <Section title="アカウント" description="表示名と表示通貨を設定します。" icon={UserCircle2}>
            <div className="grid gap-3">
              <Field label="表示名">
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none placeholder:text-white/30"
                  placeholder="表示名"
                />
              </Field>

              <div className="flex items-center justify-between rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div>
                  <div className="text-sm font-bold text-white">表示通貨</div>
                  <div className="mt-1 text-[11px] text-white/70">ホームとダッシュボードの金額表示に使います。</div>
                </div>
                <div className="flex rounded-full border border-white/10 bg-black/20 p-1">
                  <button
                    type="button"
                    onClick={() => setCurrency("JPY")}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${currency === "JPY" ? "bg-gold-500 text-black" : "text-white/65"}`}
                  >
                    JPY
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrency("USD")}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${currency === "USD" ? "bg-gold-500 text-black" : "text-white/65"}`}
                  >
                    USD
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveAccount()}
                  disabled={savingAccount}
                  className="rounded-full border border-gold-400/24 bg-[linear-gradient(90deg,rgba(253,224,71,0.16),rgba(245,158,11,0.08))] px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingAccount ? "保存中..." : "保存する"}
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 transition"
                >
                  ログアウト
                </button>
              </div>
            </div>
          </Section>

          <Section
            title="2FA / セキュリティ"
            description="メール、パスキー、Google Authenticator を組み合わせて保存します。切替はその場で保存されます。"
            icon={ShieldCheck}
          >
            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div>
                  <div className="text-sm font-bold text-white">2FA を有効にする</div>
                  <div className="mt-1 text-[11px] text-white/70">切り替えた内容はその場で保存されます。</div>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleTwoFactor()}
                  disabled={savingSecurity}
                  className="rounded-full border border-gold-400/24 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                >
                  {twoFactorEnabled ? "ON" : "OFF"}
                </button>
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                <div className="text-sm font-bold text-white">認証方法の選択</div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <MethodCard
                    label="メールコード"
                    description="ログイン用メール宛に6桁コードを送ります。"
                    active={securityMethods.email}
                    provisioned={hasLoginEmail}
                    onToggle={() => void toggleMethod("email")}
                  />
                  <MethodCard
                    label="パスキー / Face ID"
                    description="端末認証、指紋認証、顔認証などを使います。"
                    active={securityMethods.passkey}
                    provisioned={passkeyProvisioned}
                    onToggle={() => void toggleMethod("passkey")}
                  />
                  <MethodCard
                    label="Google Authenticator"
                    description="6桁コードで認証します。"
                    active={securityMethods.totp}
                    provisioned={totpProvisioned}
                    onToggle={() => void toggleMethod("totp")}
                  />
                </div>
                <div className="mt-2 text-xs text-white/65">有効な認証方法: {selectedMethodCount} / 最低 2 つ</div>
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                <div className="text-sm font-bold text-white">Google Authenticator 登録</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void generateTotp()}
                    disabled={isGeneratingTotp}
                    className="rounded-full border border-gold-400/24 bg-gold-400/12 px-4 py-2 text-sm font-semibold text-white"
                  >
                    {isGeneratingTotp ? "生成中..." : "QRコードを生成"}
                  </button>
                </div>

                {totpQrCode ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-[160px_1fr]">
                    <div className="rounded-[22px] border border-gold-400/18 bg-white px-4 py-4">
                      <img src={totpQrCode} alt="TOTP QR Code" className="mx-auto h-32 w-32 object-contain" />
                    </div>
                    <div className="grid gap-3">
                      <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-white/75">
                        1. Google Authenticator でQRを読み取る
                        <br />
                        2. 表示された6桁コードを下に入力する
                        <br />
                        3. 確認して登録する
                      </div>
                      <Field label="6桁コード">
                        <div className="flex gap-2">
                          <input
                            value={totpToken}
                            onChange={(event) => setTotpToken(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                            className="w-full rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none placeholder:text-white/30"
                            placeholder="123456"
                          />
                          <button
                            type="button"
                            onClick={() => void verifyTotp()}
                            disabled={isVerifyingTotp}
                            className="rounded-[16px] border border-gold-400/24 bg-gold-400/12 px-4 py-3 text-sm font-semibold text-white"
                          >
                            {isVerifyingTotp ? "確認中..." : "確認"}
                          </button>
                        </div>
                      </Field>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                <div className="text-sm font-bold text-white">パスキー登録</div>
                <div className="mt-2 text-xs leading-6 text-white/70">
                  パスキー、指紋認証、顔認証などを登録します。登録後はログインと2FA補助の両方で使えます。
                </div>
                <div className="mt-2 rounded-[16px] border border-gold-400/18 bg-gold-400/8 px-3 py-2 text-[11px] leading-6 text-gold-100/85">
                  新ドメインへ切り替えたため、以前の Passkey は引き継がれません。ここで一度だけ再登録してください。
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void registerPasskey()}
                    disabled={isRegisteringPasskey}
                    className="rounded-full border border-gold-400/24 bg-gold-400/12 px-4 py-2 text-sm font-semibold text-white"
                  >
                    {isRegisteringPasskey ? "登録中..." : "端末認証を登録"}
                  </button>
                  <span className="rounded-full border border-white/10 px-3 py-2 text-xs text-white/65">
                    {passkeyProvisioned ? "登録済み" : "未登録"}
                  </span>
                </div>
              </div>
            </div>
          </Section>
        </section>

        <Section
          title="補足"
          description="設定画面の使い方です。"
          icon={HelpCircle}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-white/74">
              2FA の ON/OFF と認証方法の切替は、その場で保存されます。
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-white/74">
              10分ほど操作がない場合は、自動でログアウトする設定です。
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-white/74">
              メールアドレスは画面に表示しませんが、メールコード認証には内部で使います。
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-white/74">
              Google Authenticator とパスキーは、登録後に自動で設定へ反映されます。
            </div>
          </div>
        </Section>

        <div className="h-2" />
      </div>
    </main>
  );
}
