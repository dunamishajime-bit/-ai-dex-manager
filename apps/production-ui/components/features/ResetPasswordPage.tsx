"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle, KeyRound, Lock, LogIn, Mail } from "lucide-react";
import { updateLocalPassword } from "@/lib/user-store";

type Mode = "request" | "confirm";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const mode: Mode = useMemo(() => (token ? "confirm" : "request"), [token]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  useEffect(() => {
    setError(null);
    setNotice(null);
    setStatus("idle");
  }, [mode]);

  const handleRequestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim()) {
      setError("メールアドレスを入力してください。");
      return;
    }

    setStatus("loading");
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "再設定メールの送信に失敗しました。");
        setStatus("error");
        return;
      }

      setNotice("再設定メールを送信しました。受信したメールの案内に沿って進めてください。");
      setStatus("success");
    } catch {
      setError("再設定メール送信中に通信エラーが発生しました。");
      setStatus("error");
    }
  };

  const handleConfirmReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!token) {
      setError("再設定用トークンが見つかりません。メールのリンクから開き直してください。");
      setStatus("error");
      return;
    }

    if (password !== confirmPassword) {
      setError("新しいパスワードが一致していません。");
      return;
    }

    if (password.length < 6) {
      setError("パスワードは6文字以上で入力してください。");
      return;
    }

    setStatus("loading");
    try {
      const response = await fetch("/api/auth/reset-password/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "パスワード更新に失敗しました。");
        setStatus("error");
        return;
      }

      if (data.email) {
        updateLocalPassword(data.email, password);
      }
      setNotice("パスワードを更新しました。ログイン画面へ戻ります。");
      setStatus("success");
    } catch {
      setError("パスワード更新中に通信エラーが発生しました。");
      setStatus("error");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cyber-black p-4">
      <div className="pointer-events-none absolute inset-0 bg-grid-gold opacity-[0.05]" />

      <div className="relative w-full max-w-md rounded-xl border border-gold-500/30 glass-panel p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 shadow-[0_0_20px_rgba(255,215,0,0.2)]">
            {mode === "request" ? <Mail className="h-8 w-8 text-gold-500" /> : <Lock className="h-8 w-8 text-gold-500" />}
          </div>
          <h1 className="text-2xl font-bold tracking-wider text-white">
            {mode === "request" ? "パスワード再設定メール" : "パスワード再設定"}
          </h1>
          <p className="mt-2 text-xs font-mono uppercase tracking-widest text-gray-500">
            {mode === "request" ? "REQUEST RESET LINK" : "UPDATE ACCESS PASSWORD"}
          </p>
        </div>

        {notice ? (
          <div className="mb-5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
            <div className="flex items-start gap-2">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{notice}</span>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mb-5 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        ) : null}

        {mode === "request" ? (
          <form onSubmit={handleRequestReset} className="space-y-6">
            <div>
              <label className="mb-2 block text-xs font-mono uppercase tracking-wider text-gold-500">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500/50" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded border border-gold-500/20 bg-black/50 px-10 py-3 text-sm text-white transition-all focus:border-gold-500 focus:outline-none"
                  placeholder="name@example.com"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={status === "loading"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 py-4 font-bold text-black transition-all hover:bg-gold-400 disabled:opacity-50"
            >
              {status === "loading" ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
              ) : (
                <>
                  <KeyRound className="h-5 w-5" />
                  再設定メールを送信
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirmReset} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-mono uppercase tracking-wider text-gold-500">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500/50" />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded border border-gold-500/20 bg-black/50 px-10 py-3 text-sm text-white transition-all focus:border-gold-500 focus:outline-none"
                    placeholder="********"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-mono uppercase tracking-wider text-gold-500">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-500/50" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="w-full rounded border border-gold-500/20 bg-black/50 px-10 py-3 text-sm text-white transition-all focus:border-gold-500 focus:outline-none"
                    placeholder="********"
                    required
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={status === "loading"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 py-4 font-bold text-black transition-all hover:bg-gold-400 disabled:opacity-50"
            >
              {status === "loading" ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
              ) : (
                <>
                  パスワードを更新
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => router.push("/login")}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-gold-500/20 bg-transparent py-3 text-sm font-medium text-white transition-all hover:bg-white/5"
        >
          <LogIn className="h-4 w-4" />
          ログイン画面へ戻る
        </button>
      </div>
    </div>
  );
}

function ResetPasswordFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cyber-black p-4">
      <div className="w-full max-w-md rounded-xl border border-gold-500/30 glass-panel p-8 text-center">
        <div className="text-lg font-semibold text-white">読み込み中...</div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
