import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { maskEmail } from "@/lib/security-utils";
import { loadUsers } from "@/lib/server/user-db";
import { loadSystemSettings } from "@/lib/server/system-settings-db";
import { PUBLIC_ADMIN_ENABLED } from "@/lib/site-access";

export const dynamic = "force-dynamic";

const ADMIN_COOKIE = "disdex_admin_session";
const ADMIN_2FA_HASH_COOKIE = "disdex_admin_2fa_hash";
const ADMIN_2FA_EMAIL_COOKIE = "disdex_admin_2fa_email";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDateTime(value?: string | number) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ja-JP");
}

function card(children: React.ReactNode) {
  return <section className="rounded-[20px] border border-gold-400/18 bg-[#060910] p-4 md:p-5">{children}</section>;
}

export default async function AdminPage(props: { searchParams?: SearchParams }) {
  if (!PUBLIC_ADMIN_ENABLED) {
    redirect("/login");
  }

  const searchParams = (await props.searchParams) || {};
  const store = await cookies();
  const unlocked = store.get(ADMIN_COOKIE)?.value === "active";
  const pendingCode = Boolean(store.get(ADMIN_2FA_HASH_COOKIE)?.value);
  const pendingEmail = store.get(ADMIN_2FA_EMAIL_COOKIE)?.value || "";
  const message = firstValue(searchParams.message);
  const error = firstValue(searchParams.error);
  const step = firstValue(searchParams.step);

  if (!unlocked) {
    const showCodeInput = pendingCode || step === "code";

    return (
      <main className="mx-auto flex min-h-[calc(100dvh-1rem)] max-w-xl flex-col justify-center px-3 py-4 md:px-4">
        {card(
          <>
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/70">Admin Access</div>
            <h1 className="mt-2 text-4xl font-black text-white">
              <span className="hidden md:inline">DisDexDeployer</span>
              <span className="md:hidden">TripleD</span>
            </h1>

            {!showCodeInput ? (
              <form method="post" action="/api/admin" className="mt-4 space-y-3">
                <input type="hidden" name="intent" value="login" />
                <input
                  type="password"
                  name="admin_password"
                  autoComplete="off"
                  className="w-full rounded-2xl border border-gold-400/18 bg-[#0b1018] px-4 py-3 text-base text-white outline-none placeholder:text-white/35"
                  placeholder="管理者パスワードを入力"
                />
                <button
                  type="submit"
                  className="rounded-full border border-gold-400/24 bg-gold-400/12 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  ログイン
                </button>
              </form>
            ) : (
              <form method="post" action="/api/admin" className="mt-4 space-y-3">
                <input type="hidden" name="intent" value="verify" />
                <div className="text-sm text-white/80">認証コード送信先: {maskEmail(pendingEmail)}</div>
                <input
                  type="text"
                  name="admin_code"
                  inputMode="numeric"
                  maxLength={6}
                  className="w-full rounded-2xl border border-gold-400/18 bg-[#0b1018] px-4 py-3 text-base text-white outline-none placeholder:text-white/35"
                  placeholder="6桁の認証コード"
                />
                <button
                  type="submit"
                  className="rounded-full border border-gold-400/24 bg-gold-400/12 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  認証して開く
                </button>
              </form>
            )}

            {message ? <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{message}</div> : null}
            {error ? <div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}
          </>,
        )}
      </main>
    );
  }

  const users = await loadUsers();
  const settings = await loadSystemSettings();

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-1rem)] max-w-6xl flex-col gap-4 px-2 py-2 md:px-4 md:py-4">
      {card(
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/70">Control Desk</div>
            <h1 className="mt-1 text-4xl font-black text-white">
              <span className="hidden md:inline">DisDexDeployer</span>
              <span className="md:hidden">TripleD</span>
            </h1>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/70">
              <span className="rounded-full border border-gold-400/20 px-3 py-1">アカウント {users.length}</span>
            </div>
          </div>
          <form method="post" action="/api/admin">
            <input type="hidden" name="intent" value="logout" />
            <button
              type="submit"
              className="rounded-full border border-rose-400/35 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-100"
            >
              ログアウト
            </button>
          </form>
        </div>,
      )}

      {message ? <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{message}</div> : null}
      {error ? <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}

      <section className="grid gap-4 xl:grid-cols-2">
        {card(
          <>
            <h2 className="text-base font-bold text-white">アカウント管理</h2>
            <div className="mt-3 space-y-3">
              {users.length ? (
                users.map((user) => (
                  <div key={user.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/80">
                    <div className="font-semibold text-white">{user.displayName || "アカウント"}</div>
                    <div className="mt-1">{maskEmail(user.email)}</div>
                    <div className="mt-1 text-xs text-white/60">
                      登録: {formatDateTime(user.createdAt)} / 最終ログイン: {formatDateTime(user.lastLogin)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-gold-400/24 bg-white/[0.04] px-2 py-1">
                        {user.isApproved ? "承認済み" : "未承認"}
                      </span>
                      <span className="rounded-full border border-gold-400/24 bg-white/[0.04] px-2 py-1">
                        {user.isTotpEnabled ? "2FA設定済み" : "2FA未設定"}
                      </span>
                      <form method="post" action="/api/admin">
                        <input type="hidden" name="intent" value="remove-user" />
                        <input type="hidden" name="userId" value={user.id} />
                        <button className="rounded-full border border-rose-400/35 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100">
                          削除
                        </button>
                      </form>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/12 px-3 py-6 text-center text-xs text-white/70">
                  登録アカウントはまだありません。
                </div>
              )}
            </div>
          </>,
        )}

        {card(
          <>
            <h2 className="text-base font-bold text-white">運用設定</h2>
            <form method="post" action="/api/admin" className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <input type="hidden" name="intent" value="registration-setting" />
              <label className="flex items-center justify-between gap-3 text-sm text-white">
                <span>新規登録を有効にする</span>
                <input type="checkbox" name="registrationEnabled" defaultChecked={settings.registrationEnabled} />
              </label>
              <button className="mt-3 rounded-full border border-gold-400/24 bg-gold-400/12 px-4 py-2 text-xs font-semibold text-white">
                保存
              </button>
            </form>

            <form method="post" action="/api/admin" className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <input type="hidden" name="intent" value="admin-2fa-setting" />
              <label className="flex items-center justify-between gap-3 text-sm text-white">
                <span>管理者ログインで2FAを必須にする</span>
                <input type="checkbox" name="adminTwoFactorEnabled" defaultChecked={settings.adminTwoFactorEnabled} />
              </label>
              <button className="mt-3 rounded-full border border-gold-400/24 bg-gold-400/12 px-4 py-2 text-xs font-semibold text-white">
                保存
              </button>
            </form>

            <div className="mt-4">
              <h3 className="text-sm font-bold text-white">登録メール変更（管理者）</h3>
              <form method="post" action="/api/admin" className="mt-3 space-y-3">
                <input type="hidden" name="intent" value="update-user-email" />
                <input
                  type="text"
                  name="targetEmail"
                  placeholder="変更前メール または アカウントID"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                />
                <input
                  type="email"
                  name="nextEmail"
                  placeholder="変更後メール"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                />
                <button className="rounded-full border border-gold-400/24 bg-gold-400/12 px-4 py-2 text-xs font-semibold text-white">
                  変更を保存
                </button>
              </form>
            </div>
          </>,
        )}
      </section>
    </main>
  );
}
