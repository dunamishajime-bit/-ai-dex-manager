"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Fingerprint,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  PUBLIC_REGISTER_ENABLED,
  PUBLIC_RESET_PASSWORD_ENABLED,
  SITE_BRAND_NAME,
} from "@/lib/site-access";

type LoginStep = "login" | "second-factor";

function LoginContent() {
  const {
    login,
    loginWithPasskey,
    verify2FA,
    verifyTOTP,
    verifyPasskeySecondFactor,
    resendEmailCode,
    resetSecondFactorFlow,
    isAuthenticated,
    pending2FAEmail,
    pendingSecondFactors,
    completedSecondFactors,
  } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [step, setStep] = useState<LoginStep>("login");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasskeySubmitting, setIsPasskeySubmitting] = useState(false);
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);
  const [isResendingEmail, setIsResendingEmail] = useState(false);
  const [isTotpSubmitting, setIsTotpSubmitting] = useState(false);
  const [isSecondPasskeySubmitting, setIsSecondPasskeySubmitting] = useState(false);

  const nextPath = useMemo(() => {
    const raw = searchParams.get("next");
    if (!raw || !raw.startsWith("/")) return "/";
    if (raw.startsWith("/login")) return "/";
    return raw;
  }, [searchParams]);

  const remainingFactors = useMemo(
    () => pendingSecondFactors.filter((method) => !completedSecondFactors.includes(method)),
    [completedSecondFactors, pendingSecondFactors],
  );

  useEffect(() => {
    const registered = searchParams.get("registered");
    const registeredEmail = searchParams.get("email");
    if (registered === "1") {
      setNotice("登録が完了しました。メールアドレスとパスワードでログインしてください。");
      if (registeredEmail) setEmail(registeredEmail);
    }
  }, [searchParams]);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace(nextPath);
    }
  }, [isAuthenticated, nextPath, router]);

  useEffect(() => {
    if (pendingSecondFactors.length > 0) {
      setStep("second-factor");
    }
  }, [pendingSecondFactors]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const result = await login(email.trim(), password);
      if (!result.success) {
        setError(result.error || "ログインに失敗しました。");
        return;
      }

      if (result.requiresSecondFactor) {
        setStep("second-factor");
        setNotice("有効な認証方法をすべて完了してください。");
        return;
      }

      router.replace(nextPath);
    } catch (err: any) {
      setError(err?.message || "ログイン中にエラーが発生しました。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailCodeVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsEmailSubmitting(true);

    try {
      const result = await verify2FA(emailCode.trim());
      if (!result.success) {
        setError(result.error || "メール認証コードが正しくありません。");
        return;
      }
      setEmailCode("");
      const nextRemaining = result.remainingFactors || [];
      if (nextRemaining.length > 0) {
        setNotice("メール認証は完了しました。残りの認証を続けてください。");
        return;
      }
      router.replace(nextPath);
    } catch (err: any) {
      setError(err?.message || "メール認証に失敗しました。");
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const handleTotpVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsTotpSubmitting(true);

    try {
      const result = await verifyTOTP(totpCode.trim());
      if (!result.success) {
        setError(result.error || "Google Authenticator のコードが正しくありません。");
        return;
      }
      setTotpCode("");
      const nextRemaining = result.remainingFactors || [];
      if (nextRemaining.length > 0) {
        setNotice("Google Authenticator は完了しました。残りの認証を続けてください。");
        return;
      }
      router.replace(nextPath);
    } catch (err: any) {
      setError(err?.message || "Google Authenticator の確認に失敗しました。");
    } finally {
      setIsTotpSubmitting(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!email.trim()) {
      setError("先にメールアドレスを入力してください。");
      return;
    }

    setError(null);
    setNotice(null);
    setIsPasskeySubmitting(true);

    try {
      const result = await loginWithPasskey(email.trim());
      if (!result.success) {
        setError(result.error || "パスキー認証に失敗しました。");
        return;
      }
      router.replace(nextPath);
    } catch (err: any) {
      setError(err?.message || "パスキー認証に失敗しました。");
    } finally {
      setIsPasskeySubmitting(false);
    }
  };

  const handleSecondPasskeyVerify = async () => {
    setError(null);
    setIsSecondPasskeySubmitting(true);

    try {
      const result = await verifyPasskeySecondFactor();
      if (!result.success) {
        setError(result.error || "端末認証に失敗しました。");
        return;
      }
      const nextRemaining = result.remainingFactors || [];
      if (nextRemaining.length > 0) {
        setNotice("端末認証は完了しました。残りの認証を続けてください。");
        return;
      }
      router.replace(nextPath);
    } catch (err: any) {
      setError(err?.message || "端末認証に失敗しました。");
    } finally {
      setIsSecondPasskeySubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050608] px-4 py-10">
      <div className="absolute inset-0">
        <img
          src="/backgrounds/login_bg.png"
          alt="login background"
          className="h-full w-full object-cover opacity-40"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.16),transparent_35%),linear-gradient(180deg,rgba(0,0,0,0.56),rgba(0,0,0,0.88))]" />
      </div>

      <div className="relative z-10 w-full max-w-md rounded-[28px] border border-gold-400/20 bg-black/55 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="mb-7">
          <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-gold-100/70">Private Access</div>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-gold-300">{SITE_BRAND_NAME}</h1>
          <p className="mt-3 text-sm leading-7 text-white/72">
            自分用の運用画面です。ログイン後に必要な認証を順番に完了してください。
          </p>
        </div>

        {notice ? (
          <div className="mb-4 rounded-2xl border border-gold-400/20 bg-gold-500/10 px-4 py-3 text-sm text-gold-100">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {step === "login" ? (
          <form onSubmit={handleLogin} className="space-y-5">
            <label className="grid gap-2">
              <span className="text-sm text-white/76">メールアドレス</span>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-100/70" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/12 bg-white/5 py-3 pl-10 pr-4 text-white outline-none transition focus:border-gold-400/40 focus:bg-white/7"
                  placeholder="name@example.com"
                />
              </div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm text-white/76">パスワード</span>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-100/70" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/12 bg-white/5 py-3 pl-10 pr-4 text-white outline-none transition focus:border-gold-400/40 focus:bg-white/7"
                  placeholder="ログイン用パスワード"
                />
              </div>
            </label>

            <div className="flex justify-end">
            {PUBLIC_RESET_PASSWORD_ENABLED ? (
              <Link href="/reset-password" className="text-xs text-gold-100/75 hover:text-gold-300 hover:underline">
                パスワードを忘れた場合
              </Link>
            ) : (
              <span className="text-xs text-white/45">パスワード再設定は現在公開していません</span>
            )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#f6d878,#d6a63a)] px-4 py-3.5 font-bold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              {isSubmitting ? "ログイン中..." : "ログイン"}
              <ArrowRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={isPasskeySubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-gold-400/20 bg-white/5 px-4 py-3 font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Fingerprint className="h-4 w-4" />
              {isPasskeySubmitting ? "パスキー認証中..." : "パスキーでログイン"}
            </button>

            <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-gold-300" />
                認証方法
              </div>
              <div className="mt-3 grid gap-2 text-xs leading-6 text-white/68">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-gold-200" />
                  メール認証コード
                </div>
                <div className="flex items-center gap-2">
                  <Smartphone className="h-3.5 w-3.5 text-gold-200" />
                  Google Authenticator
                </div>
                <div className="flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 text-gold-200" />
                  パスキー / 端末認証
                </div>
              </div>
            </div>

            {PUBLIC_REGISTER_ENABLED ? (
              <Link
                href="/register"
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-transparent px-4 py-3 font-medium text-white transition hover:border-gold-400/30 hover:bg-white/5"
              >
                新規登録
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </form>
        ) : null}

        {step === "second-factor" ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-gold-400/16 bg-gold-500/10 p-4 text-sm leading-7 text-gold-100">
              有効な認証方法をすべて完了してください。完了済み:{" "}
              {completedSecondFactors.length ? completedSecondFactors.join(" / ") : "まだありません"}
            </div>

            {remainingFactors.includes("email") ? (
              <form onSubmit={handleEmailCodeVerify} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-sm font-semibold text-white">メール認証</div>
                <div className="text-xs leading-6 text-white/70">
                  {pending2FAEmail ? `${pending2FAEmail} に送信した6桁コードを入力してください。` : "メール認証コードを入力してください。"}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={emailCode}
                    onChange={(event) => setEmailCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    required
                    className="w-full rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-gold-400/40"
                    placeholder="123456"
                  />
                  <button
                    type="button"
                    disabled={isResendingEmail}
                    onClick={async () => {
                      setError(null);
                      setNotice(null);
                      setIsResendingEmail(true);
                      try {
                        const result = await resendEmailCode();
                        if (result.success) {
                          const stamp = new Date().toLocaleTimeString("ja-JP", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          });
                          setNotice(`メール認証コードを再送しました。 ${stamp}`);
                        } else {
                          setError(result.error || "コード再送に失敗しました。");
                        }
                      } finally {
                        setIsResendingEmail(false);
                      }
                    }}
                    className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResendingEmail ? "再送中..." : "再送"}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={isEmailSubmitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#f6d878,#d6a63a)] px-4 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isEmailSubmitting ? "確認中..." : "メール認証を完了"}
                </button>
              </form>
            ) : null}

            {remainingFactors.includes("totp") ? (
              <form onSubmit={handleTotpVerify} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-sm font-semibold text-white">Google Authenticator</div>
                <div className="text-xs leading-6 text-white/70">
                  Google Authenticator に表示される6桁コードを入力してください。
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  required
                  className="w-full rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-gold-400/40"
                  placeholder="123456"
                />
                <button
                  type="submit"
                  disabled={isTotpSubmitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#f6d878,#d6a63a)] px-4 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isTotpSubmitting ? "確認中..." : "Authenticator を完了"}
                </button>
              </form>
            ) : null}

            {remainingFactors.includes("passkey") ? (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-sm font-semibold text-white">端末認証 / パスキー</div>
                <div className="text-xs leading-6 text-white/70">
                  Windows Hello、Face ID、指紋認証など、この端末で登録済みの認証を完了してください。
                </div>
                <button
                  type="button"
                  onClick={handleSecondPasskeyVerify}
                  disabled={isSecondPasskeySubmitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#f6d878,#d6a63a)] px-4 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Fingerprint className="h-4 w-4" />
                  {isSecondPasskeySubmitting ? "端末認証中..." : "端末認証を完了"}
                </button>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                resetSecondFactorFlow();
                setStep("login");
                setEmailCode("");
                setTotpCode("");
                setNotice(null);
              }}
              className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/80 transition hover:bg-white/5"
            >
              戻る
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050608]" />}>
      <LoginContent />
    </Suspense>
  );
}

export default LoginPage;
