"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Lock, Mail, UserPlus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.trim() || !password || !nickname.trim()) {
      setError("メールアドレス、表示名、パスワードを入力してください。");
      return;
    }
    if (password !== confirmPassword) {
      setError("パスワードが一致していません。");
      return;
    }

    setSubmitting(true);
    try {
      const result = await register(email.trim(), password, nickname.trim());
      if (!result.success) {
        setError(result.error || "登録に失敗しました。");
        return;
      }

      if (result.code) {
        setMessage("登録を受け付けました。確認コードをメールで確認してからログイン画面へ進みます。");
        setTimeout(() => {
          router.push(`/login?registered=1&email=${encodeURIComponent(email.trim())}`);
        }, 1200);
        return;
      }

      router.push("/");
    } catch (err: any) {
      setError(err?.message || "登録に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0a] p-4">
      <div className="absolute inset-0 z-0">
        <img
          src="/backgrounds/login_bg.png"
          alt="register background"
          className="h-full w-full object-cover opacity-50"
          style={{ filter: "brightness(0.4) contrast(1.1)" }}
          onError={(event) => {
            (event.target as HTMLImageElement).style.opacity = "0";
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black" />
      </div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-gold-400/15 bg-black/42 p-8 shadow-2xl backdrop-blur-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-gold-400/20 bg-gold-500/10">
            <UserPlus className="h-7 w-7 text-gold-500" />
          </div>
          <h1 className="mb-2 text-4xl font-black tracking-tighter text-gold-500 italic">個人アカウント登録</h1>
          <p className="text-sm leading-6 text-white/72">
            このサイトを使うための自分用アカウントを登録します。登録後はログインして、必要な認証を順番に進めてください。
          </p>
        </div>

        {message ? (
          <div className="mb-4 rounded-xl border border-green-400/20 bg-green-500/10 px-4 py-3 text-sm text-green-100">
            <CheckCircle2 className="mr-2 inline-block h-4 w-4 align-text-bottom" />
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        ) : null}

        <form onSubmit={handleRegister} className="space-y-5">
          <label className="grid gap-2">
            <span className="text-sm text-white/72">メールアドレス</span>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gold-100/70" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-white outline-none transition-all focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/50"
                placeholder="name@example.com"
                required
              />
            </div>
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-white/72">表示名</span>
            <input
              type="text"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-all placeholder:text-white/30 focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/50"
              placeholder="画面に表示する名前"
              required
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-white/72">パスワード</span>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gold-100/70" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-white outline-none transition-all placeholder:text-white/30 focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/50"
                placeholder="8文字以上で設定"
                required
              />
            </div>
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-white/72">パスワード確認</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-all placeholder:text-white/30 focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/50"
              placeholder="もう一度入力"
              required
            />
          </label>

          <div className="rounded-xl border border-gold-400/20 bg-gold-500/10 px-4 py-3 text-sm leading-6 text-gold-100">
            登録後にログインすると、運用ウォレットや自動売買の状況をこの画面から確認できます。
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 py-4 font-bold text-black shadow-lg shadow-gold-500/20 transition-all duration-300 active:scale-95 hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <UserPlus className="h-5 w-5" />
            {submitting ? "登録中..." : "登録する"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm">
          <p className="text-white/70">
            すでにアカウントを使っている場合は{" "}
            <Link href="/login" className="text-gold-400 hover:text-gold-300 hover:underline">
              ログイン画面
            </Link>
            へ進んでください。
          </p>
          <Link href="/admin" className="inline-flex items-center gap-1 text-[10px] text-white/35 transition-colors hover:text-gold-400">
            管理ページ
          </Link>
        </div>
      </div>
    </div>
  );
}
