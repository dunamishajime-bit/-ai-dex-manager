import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getDeploymentApprovalInbox,
  type DeploymentApprovalSummary,
} from "@/lib/server/deploy-approval-store";
import { DEPLOY_APPROVAL_OPERATION_POLICY, STABLE4_H48_TIME_ONLY_APPROVAL, type DeploymentApprovalOperation } from "@/lib/deploy-approval-token";
import { ALL_RUNNERS_LIVE_TASK } from "@/lib/deploy-all-runners-task";
import { loadOwnerSessionKey, OWNER_SESSION_COOKIE, verifyOwnerSession } from "@/lib/server/owner-session";

export const dynamic = "force-dynamic";


type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatDateTime(value?: string | number) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ja-JP");
}

function approvalOperation(record: DeploymentApprovalSummary) {
  return record.operation ?? (record.scope === "V12_V4" ? "V12_V4_LIVE" : null);
}

export default async function ProductionApprovalPage(props: { searchParams?: SearchParams }) {
  const store = await cookies();
  const headerStore = await headers();
  const token = store.get(OWNER_SESSION_COOKIE)?.value || "";
  const audience = headerStore.get("x-forwarded-host") || headerStore.get("host") || "";
  let authenticated = false;
  if (token && audience) {
    for (const purpose of ["USER", "ADMIN"] as const) {
      try {
        verifyOwnerSession(token, { key: loadOwnerSessionKey(), purpose, audience });
        authenticated = true;
        break;
      } catch {
        // Try the other signed-session purpose.
      }
    }
  }
  if (!authenticated) redirect("/login?next=/production-approval");

  const searchParams = (await props.searchParams) || {};
  const message = firstValue(searchParams.message);
  const error = firstValue(searchParams.error);
  const view = firstValue(searchParams.view) === "history" ? "history" : "pending";
  const inbox = await getDeploymentApprovalInbox();
  const deployApproval = inbox.pending[0] ?? null;
  const operation = deployApproval ? approvalOperation(deployApproval) : null;
  const operationPolicy =
    operation && operation in DEPLOY_APPROVAL_OPERATION_POLICY
      ? DEPLOY_APPROVAL_OPERATION_POLICY[operation as DeploymentApprovalOperation]
      : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <section className="rounded-[28px] border border-gold-400/18 bg-[linear-gradient(180deg,rgba(12,14,20,0.96),rgba(5,7,12,0.98))] p-5 shadow-[0_0_30px_rgba(253,224,71,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/70">
              Production Approval
            </div>
            <h1 className="mt-2 text-3xl font-black text-white">Production操作承認</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-white/70">
              現在のログインに加え、登録メールへ送る6桁コードで対象のProduction操作だけを本人承認します。
            </p>
          </div>
          <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
            メールOTP必須
          </span>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <nav className="mt-5 grid grid-cols-2 gap-2" aria-label="Production承認表示">
          <a
            href="/production-approval?view=pending"
            aria-current={view === "pending" ? "page" : undefined}
            className={`rounded-xl border px-3 py-3 text-center text-sm font-bold transition ${
              view === "pending"
                ? "border-amber-300/45 bg-amber-300/15 text-amber-50"
                : "border-white/10 bg-white/[0.03] text-white/55"
            }`}
          >
            承認待ち ({inbox.pending.length})
          </a>
          <a
            href="/production-approval?view=history"
            aria-current={view === "history" ? "page" : undefined}
            className={`rounded-xl border px-3 py-3 text-center text-sm font-bold transition ${
              view === "history"
                ? "border-sky-300/45 bg-sky-300/15 text-sky-50"
                : "border-white/10 bg-white/[0.03] text-white/55"
            }`}
          >
            履歴 ({inbox.history.length})
          </a>
        </nav>

        {view === "history" ? (
          <div className="mt-5 space-y-3">
            {inbox.history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/60">
                履歴はありません。
              </div>
            ) : (
              inbox.history.map((record) => {
                const recordOperation = approvalOperation(record);
                return (
                  <article key={record.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/80">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-white/15 px-2 py-1">Operation: {recordOperation || "UNKNOWN"}</span>
                      <span className="rounded-full border border-white/15 px-2 py-1">Scope: {record.scope}</span>
                      <span className="rounded-full border border-white/15 px-2 py-1">Orders: {(record.ordersEnabled ?? true) ? "ENABLED" : "DISABLED"}</span>
                      <span className="rounded-full border border-white/15 px-2 py-1">Status: {record.status}</span>
                    </div>
                    <div className="mt-4 text-xs text-white/50">Target SHA</div>
                    <div className="mt-1 break-all font-mono text-xs text-white">{record.targetSha}</div>
                    <div className="mt-4 text-xs text-white/50">Plan / Context SHA-256</div>
                    <div className="mt-1 break-all font-mono text-xs text-white">{record.planSha256}</div>
                    <div className="mt-4 grid gap-2 text-xs text-white/55 md:grid-cols-2">
                      <div>要求者: {record.requestActor}</div>
                      <div>作成: {formatDateTime(record.createdAt)}</div>
                      <div>要求期限: {formatDateTime(record.requestExpiresAt)}</div>
                      <div>承認日時: {formatDateTime(record.approvedAt)}</div>
                      <div>Redeem日時: {formatDateTime(record.redeemedAt)}</div>
                      <div>完了日時: {formatDateTime(record.completedAt)}</div>
                      <div>承認ID: <span className="font-mono">{record.id}</span></div>
                    </div>
                    {record.lastError ? (
                      <div className="mt-3 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                        {record.lastError}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        ) : !deployApproval ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/60">
            現在、承認待ちのProduction操作はありません。履歴タブで期限切れ・承認済みの要求を確認できます。
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/80">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-white/15 px-2 py-1">Operation: {operation || "UNKNOWN"}</span>
                <span className="rounded-full border border-white/15 px-2 py-1">Scope: {deployApproval.scope}</span>
                <span className="rounded-full border border-white/15 px-2 py-1">Orders: {(deployApproval.ordersEnabled ?? true) ? "ENABLED" : "DISABLED"}</span>
                <span className="rounded-full border border-white/15 px-2 py-1">Status: {deployApproval.status}</span>
              </div>
              {operation === "HYPE_STABLE4_H48_TIME_ONLY_LIVE" ? (
                <div className="mt-4 rounded-xl border border-amber-300/35 bg-amber-300/[0.07] p-3 text-xs leading-6 text-amber-100">
                  <div className="font-bold">STABLE4 H48_TIME_ONLY：時間決済ポリシーの正式承認</div>
                  <div>対象：HYPEUSDT LONG、6時間間隔の入口、48時間の時間決済。</div>
                  <div>このポリシーでは常駐STOP注文・常駐TP注文を要求しません。通常のSTOP保護方式と異なるリスクがあります。</div>
                  <div>対象Gross：Crypto 3.0x / Stock 4.0x / Total 4.25x / HYPE 1.0x。</div>
                  <div>対象SHA・Planが下記の固定値と一致する場合に限り、メールOTPで承認してください。</div>
                  {deployApproval.targetSha !== STABLE4_H48_TIME_ONLY_APPROVAL.targetSha ||
                   deployApproval.planSha256 !== STABLE4_H48_TIME_ONLY_APPROVAL.planSha256 ? (
                    <div className="font-bold text-rose-200">SHAまたはPlanが一致しません。承認しないでください。</div>
                  ) : null}
                  <div>承認してもGLOBAL HOLD、共有リスク、Root証明書、切替前の保護検証は免除されません。</div>
                </div>
              ) : null}
              <div className="mt-4 text-xs text-white/50">Target SHA</div>
              <div className="mt-1 break-all font-mono text-xs text-white">{deployApproval.targetSha}</div>
              <div className="mt-4 text-xs text-white/50">Plan / Context SHA-256</div>
              <div className="mt-1 break-all font-mono text-xs text-white">{deployApproval.planSha256}</div>
              <div className="mt-4 grid gap-2 text-xs text-white/55 md:grid-cols-2">
                <div>要求者: {deployApproval.requestActor}</div>
                <div>作成: {formatDateTime(deployApproval.createdAt)}</div>
                <div>要求期限: {formatDateTime(deployApproval.requestExpiresAt)}</div>
                <div>承認ID: <span className="font-mono">{deployApproval.id}</span></div>
              </div>
              {operation === "ALL_RUNNERS_LIVE_RESTORE" && deployApproval.approvedAt ? (
                <div className="mt-4 rounded-xl border border-white/10 p-3 text-xs leading-6 text-white/80">
                  <div className="font-semibold text-white">全Runner LIVE復旧 — 依頼全体の承認</div>
                  <div>承認日時: {formatDateTime(deployApproval.approvedAt)}</div>
                  <div>承認範囲の有効期限: {formatDateTime(deployApproval.taskApprovedExpiresAt)}</div>
                  <div>工程実行回数: {deployApproval.taskClaimCount ?? 0} / {ALL_RUNNERS_LIVE_TASK.maxClaims}</div>
                  <div>実行中の工程: {deployApproval.taskActiveClaim?.step ?? "なし"}</div>
                  <div>V52・IDLE・V4・HYPE・Q102・PENGU・FET・共通リスク管理を、同じ作業依頼の配下で処理します。同じ工程の失敗・修正後の再実行では追加のメール認証は不要です。</div>
                  <div>別の作業への流用、実注文のテスト、保護STOPの無断変更、安全条件の省略は許可されません。</div>
                </div>
              ) : null}

              {deployApproval.lastError ? (
                <div className="mt-3 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {deployApproval.lastError}
                </div>
              ) : null}
            </div>

            {deployApproval.status === "PENDING" ? (
              <form method="post" action="/api/production-approval">
                <input type="hidden" name="intent" value="request-otp" />
                <input type="hidden" name="requestId" value={deployApproval.id} />
                <button className="w-full rounded-2xl border border-amber-300/35 bg-amber-300/15 px-4 py-4 text-sm font-black text-amber-50">
                  メール認証して{operationPolicy?.label || "Production操作"}を承認
                </button>
              </form>
            ) : null}

            {deployApproval.status === "OTP_SENT" ? (
              <form method="post" action="/api/production-approval" className="space-y-3">
                <input type="hidden" name="intent" value="verify-otp" />
                <input type="hidden" name="requestId" value={deployApproval.id} />
                <div className="text-xs leading-6 text-white/70">
                  登録メールへ送信した6桁コードを入力してください。5分で失効し、5回失敗すると無効になります。
                </div>
                <input
                  type="text"
                  name="approvalCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  className="w-full rounded-2xl border border-amber-300/25 bg-[#0b1018] px-4 py-4 text-center font-mono text-xl tracking-[0.35em] text-white outline-none"
                  placeholder="000000"
                />
                <button className="w-full rounded-2xl border border-emerald-300/35 bg-emerald-400/15 px-4 py-4 text-sm font-black text-emerald-50">
                  正式承認して署名済み承認証明を発行
                </button>
              </form>
            ) : null}

            {deployApproval.status === "APPROVED" ? (
              <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-4 text-sm text-emerald-100">
                本人認証済みです。表示中のoperation / scope / exact SHA / plan-context hash / 注文権限だけに有効な署名済み承認証明を発行済みです。
              </div>
            ) : null}

            {deployApproval.status === "DISPATCHED" ? (
              <div className="rounded-2xl border border-sky-300/25 bg-sky-400/10 px-4 py-4 text-sm text-sky-100">
                正式GitHub Actionへ引き渡し済みです。
              </div>
            ) : null}

            {deployApproval.status === "COMPLETED" ? (
              <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-4 text-sm text-emerald-100">
                承認対象の復旧工程が完了として記録されました。
              </div>
            ) : null}

            {deployApproval.status === "REDEEMED" ? (
              <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/10 px-4 py-4 text-sm text-emerald-100">
                GitHub Actionが承認証明を取得済みです。作業全体を承認した場合、対象工程の再試行は承認期間内で管理します。
              </div>
            ) : null}

            <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.06] px-4 py-3 text-xs leading-6 text-rose-100/85">
              承認は依頼全体の目的・許可工程・SHA・plan/context hash・注文権限・有効期限に固定されます。同じ依頼の工程や再試行は追加のメール認証を求めません。別の依頼・計画変更には再承認が必要です。Kill Switch、STOP、venue evidence、peer healthは承認では上書きされません。
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
