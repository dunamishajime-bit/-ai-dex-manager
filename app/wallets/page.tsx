"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Loader2, Plus, QrCode, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";

function formatUsd(value?: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ja-JP");
}

function formatAmount(value?: string) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function statusText(status?: string) {
  switch (status) {
    case "running":
      return "稼働中";
    case "paused":
      return "停止中";
    case "awaiting_deposit":
      return "入金待ち";
    default:
      return "未設定";
  }
}

function statusTone(status?: string) {
  switch (status) {
    case "running":
      return "text-profit";
    case "paused":
      return "text-loss";
    case "awaiting_deposit":
      return "text-gold-50";
    default:
      return "text-white";
  }
}

function Panel({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[26px] border border-gold-400/16 bg-[linear-gradient(180deg,rgba(8,10,15,0.38),rgba(4,6,10,0.78))] p-4 shadow-[0_0_24px_rgba(253,224,71,0.05)] backdrop-blur-[10px] md:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-gold-400/18 bg-white/[0.04] p-3">
          <Icon className="h-5 w-5 text-gold-100" />
        </div>
        <div>
          <h2 className="text-base font-black text-white">{title}</h2>
          <p className="mt-1 text-[12px] leading-6 text-white/72">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold-100/72">{label}</span>
      {children}
      {note ? <span className="text-[11px] leading-5 text-white/58">{note}</span> : null}
    </label>
  );
}

function StatCard({
  title,
  value,
  note,
  tone = "default",
}: {
  title: string;
  value: string;
  note: string;
  tone?: "default" | "profit" | "loss";
}) {
  const toneClass = tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "text-white";
  return (
    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-100/66">{title}</div>
      <div className={`mt-2 text-[1.55rem] font-black ${toneClass}`}>{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/70">{note}</div>
    </div>
  );
}

export default function WalletsPage() {
  const { user } = useAuth();
  const { wallet, loading, refresh } = useOperationalWallet();

  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [walletLabel, setWalletLabel] = useState("運用ウォレット");
  const [walletNote, setWalletNote] = useState("");
  const [copyLabel, setCopyLabel] = useState("アドレスをコピー");
  const [qrDataUrl, setQrDataUrl] = useState("");

  const email = user?.email?.trim().toLowerCase() || "";
  const displayName = user?.nickname || user?.email || "オーナー";
  const canManageWallet = Boolean(email);

  const activeHoldings = useMemo(() => {
    const items = wallet?.trackedHoldings || [];
    return items
      .filter((item) => Number(item.amount) > 0)
      .sort((a, b) => Number(b.usdValue || 0) - Number(a.usdValue || 0));
  }, [wallet?.trackedHoldings]);

  const totalHoldingsUsd = Number(wallet?.lastPortfolioUsd || 0);
  const nativeBalance = wallet?.lastBalanceFormatted ? Number(wallet.lastBalanceFormatted) : 0;

  useEffect(() => {
    let mounted = true;

    if (!wallet?.address) {
      setQrDataUrl("");
      return () => {
        mounted = false;
      };
    }

    void import("qrcode").then(async ({ default: QRCode }) => {
      try {
        const dataUrl = await QRCode.toDataURL(wallet.address, {
          margin: 1,
          width: 220,
          color: {
            dark: "#fef3c7",
            light: "#00000000",
          },
        });
        if (mounted) setQrDataUrl(dataUrl);
      } catch {
        if (mounted) setQrDataUrl("");
      }
    });

    return () => {
      mounted = false;
    };
  }, [wallet?.address]);

  const mutateWallet = useCallback(
    async (payload: Record<string, unknown>, successMessage: string) => {
      if (!email) {
        setMessage("先にログインしてください。");
        return null;
      }

      const response = await fetch("/api/operational-wallets", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user?.id,
          email,
          displayName,
          ...payload,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; wallet?: unknown };
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "ウォレットの更新に失敗しました。");
      }

      await refresh();
      setMessage(successMessage);
      return data.wallet;
    },
    [displayName, email, refresh, user?.id],
  );

  const createWallet = async () => {
    if (!canManageWallet) {
      setMessage("先にログインしてください。");
      return;
    }

    setCreating(true);
    setMessage("");

    try {
      const response = await fetch("/api/operational-wallets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user?.id,
          email,
          displayName,
          label: walletLabel.trim() || "運用ウォレット",
          note: walletNote.trim(),
          chainId: 56,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; created?: boolean };
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "運用ウォレットの作成に失敗しました。");
      }

      await refresh();
      setMessage(data.created ? "運用ウォレットを作成しました。" : "既存の運用ウォレットを表示しています。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "運用ウォレットの作成に失敗しました。");
    } finally {
      setCreating(false);
    }
  };

  const handleBackupConfirm = async () => {
    try {
      await mutateWallet({ action: "backup-confirm" }, "バックアップ確認を保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "バックアップ確認の保存に失敗しました。");
    }
  };

  const handleOwnerReconnect = async () => {
    try {
      await mutateWallet({ action: "owner-reconnect" }, "Owner接続の確認を保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Owner接続の保存に失敗しました。");
    }
  };

  const handleNoteSave = async () => {
    try {
      await mutateWallet({ action: "set-note", note: walletNote.trim() }, "メモを保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "メモの保存に失敗しました。");
    }
  };

  const copyAddress = async () => {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopyLabel("コピーしました");
    window.setTimeout(() => setCopyLabel("アドレスをコピー"), 1200);
  };

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.04),transparent_24%),radial-gradient(circle_at_center,rgba(245,158,11,0.08),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,0.16),rgba(3,5,10,0.72))]" />

      <div className="relative z-10 space-y-4">
        <header className="rounded-[30px] border border-gold-400/18 bg-[linear-gradient(180deg,rgba(8,10,15,0.34),rgba(4,6,10,0.68))] p-4 backdrop-blur-[10px] md:p-5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-100/72">
            <Wallet className="h-3.5 w-3.5" />
            運用ウォレット
          </div>
          <h1 className="mt-2 text-[1.9rem] font-black tracking-tight text-white md:text-[2.6rem]">運用ウォレットを確認します。</h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-white/80">アドレス、入金、保有資産、状態をここでまとめて見ます。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-gold-400/20 bg-[linear-gradient(90deg,rgba(253,224,71,0.12),rgba(245,158,11,0.08))] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
              ウォレット管理
            </span>
            <span className="rounded-full border border-gold-400/20 bg-[linear-gradient(90deg,rgba(253,224,71,0.12),rgba(245,158,11,0.08))] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
              アドレスとQR表示
            </span>
            <span className="rounded-full border border-gold-400/20 bg-[linear-gradient(90deg,rgba(253,224,71,0.12),rgba(245,158,11,0.08))] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
              保有資産の確認
            </span>
          </div>
        </header>

        {message ? (
          <div className="rounded-[22px] border border-gold-400/18 bg-white/[0.04] px-4 py-3 text-sm text-white/90 backdrop-blur-[8px]">
            {message}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
          <Panel title="1. 作成" description="運用ウォレットを作成します。" icon={Wallet}>
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="表示名" note="画面用の名前です。">
                  <input
                    value={walletLabel}
                    onChange={(event) => setWalletLabel(event.target.value)}
                    className="rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30"
                    placeholder="運用ウォレット"
                  />
                </Field>
                <Field label="メモ" note="必要なら残します。">
                  <input
                    value={walletNote}
                    onChange={(event) => setWalletNote(event.target.value)}
                    className="rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30"
                    placeholder="例: BNB / ETH運用"
                  />
                </Field>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={createWallet}
                  disabled={creating || !canManageWallet}
                  className="rounded-full border border-gold-400/24 bg-[linear-gradient(90deg,rgba(253,224,71,0.18),rgba(245,158,11,0.10))] px-4 py-3 text-sm font-semibold text-white transition hover:border-gold-300/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-2">
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {creating ? "作成中..." : wallet ? "既存ウォレットを表示" : "運用ウォレットを作成"}
                  </span>
                </button>
                <button
                  onClick={() => void refresh()}
                  disabled={!canManageWallet}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:border-gold-300/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    最新状態を更新
                  </span>
                </button>
              </div>
            </div>
          </Panel>

          <Panel title="2. 現在のウォレット" description="アドレスと保有状況を確認します。" icon={ShieldCheck}>
            {wallet ? (
              <div className="space-y-3">
                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-white">{wallet.label}</div>
                      <div className="mt-1 text-[11px] text-white/64">{wallet.chainName}</div>
                    </div>
                    <span className={`rounded-full border border-gold-400/18 px-3 py-1 text-[11px] ${statusTone(wallet.status)}`}>
                      {statusText(wallet.status)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1.4fr_0.6fr]">
                    <div className="rounded-[16px] border border-gold-400/14 bg-black/20 p-3">
                      <div className="text-[11px] uppercase tracking-[0.24em] text-gold-100/60">ウォレットアドレス</div>
                      <div className="mt-2 break-all text-sm font-semibold text-white">{wallet.address}</div>
                    </div>
                    <button
                      onClick={copyAddress}
                      className="rounded-[16px] border border-gold-400/16 bg-white/[0.04] px-3 py-4 text-sm font-semibold text-white transition hover:border-gold-300/40"
                    >
                      <Copy className="mr-2 inline-block h-4 w-4 text-gold-100" />
                      {copyLabel}
                    </button>
                  </div>

                  {qrDataUrl ? (
                    <div className="mt-4 rounded-[16px] border border-white/10 bg-black/25 p-3">
                      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-gold-100/60">
                        <QrCode className="h-3.5 w-3.5" />
                        入金用QRコード
                      </div>
                      <div className="flex justify-center md:justify-start">
                        <img
                          src={qrDataUrl}
                          alt="ウォレットQR"
                          className="h-[160px] w-[160px] rounded-[10px] border border-gold-400/20 p-1"
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-2 text-[11px] text-white/72 md:grid-cols-2">
                    <div>総評価額 {formatUsd(totalHoldingsUsd)}</div>
                    <div>BNB残高 {wallet.lastBalanceFormatted ? `${wallet.lastBalanceFormatted} BNB` : "-"}</div>
                    <div>バックアップ確認 {wallet.backupConfirmed ? "済み" : "未確認"}</div>
                    <div>入金検知 {formatDate(wallet.depositDetectedAt)}</div>
                    <div>Owner接続 {formatDate(wallet.ownerReconnectedAt)}</div>
                    <div>保有資産数 {activeHoldings.length}</div>
                  </div>

                  <div className="mt-4 rounded-[16px] border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-gold-100/60">保有資産</div>
                    <div className="space-y-2">
                      {activeHoldings.length > 0 ? (
                        activeHoldings.map((holding) => (
                          <div
                            key={holding.symbol}
                            className="flex items-center justify-between gap-3 rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2"
                          >
                            <div>
                              <div className="text-sm font-semibold text-white">{holding.symbol}</div>
                              <div className="mt-1 text-[11px] text-white/64">{holding.name}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-white">{formatAmount(holding.amount)}</div>
                              <div className="mt-1 text-[11px] text-profit">{formatUsd(holding.usdValue)}</div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[14px] border border-dashed border-white/10 px-3 py-4 text-sm text-white/65">
                          まだ保有資産はありません。ウォレット作成後にここへ表示されます。
                        </div>
                      )}
                    </div>
                  </div>

                  {wallet.note ? (
                    <div className="mt-3 rounded-[16px] border border-white/10 bg-white/[0.03] p-3 text-sm leading-7 text-white/80">
                      {wallet.note}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleOwnerReconnect}
                    className="rounded-full border border-gold-400/24 bg-[linear-gradient(90deg,rgba(253,224,71,0.16),rgba(245,158,11,0.08))] px-4 py-2.5 text-sm font-semibold text-white transition hover:border-gold-300/50"
                  >
                    Owner接続を保存
                  </button>
                  <button
                    onClick={handleBackupConfirm}
                    className="rounded-full border border-gold-400/24 bg-[linear-gradient(90deg,rgba(253,224,71,0.16),rgba(245,158,11,0.08))] px-4 py-2.5 text-sm font-semibold text-white transition hover:border-gold-300/50"
                  >
                    バックアップ確認
                  </button>
                  <button
                    onClick={handleNoteSave}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:border-gold-300/40"
                  >
                    メモを保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-8 text-sm leading-7 text-white/70">
                まだ運用ウォレットはありません。上の作成ボタンから準備できます。
              </div>
            )}
          </Panel>
        </section>

        <section className="grid gap-4">
          <Panel title="3. 状態メモ" description="運用状況の目安です。" icon={ShieldCheck}>
            <div className="grid gap-3 md:grid-cols-2">
              <StatCard
                title="ウォレット状態"
                value={wallet ? statusText(wallet.status) : "未設定"}
                note={wallet?.backupConfirmed ? "バックアップ確認済み" : "バックアップ未確認"}
                tone={wallet?.status === "running" ? "profit" : wallet?.status === "paused" ? "loss" : "default"}
              />
              <StatCard
                title="総評価額"
                value={formatUsd(totalHoldingsUsd)}
                note={nativeBalance > 0 ? `BNB残高 ${nativeBalance.toFixed(6)}` : "BNB残高はまだありません"}
                tone={totalHoldingsUsd > 0 ? "profit" : "default"}
              />
              <StatCard
                title="入金検知"
                value={wallet?.depositDetectedAt ? "確認済み" : "未確認"}
                note={wallet?.depositDetectedAt ? formatDate(wallet.depositDetectedAt) : "入金後に日時が表示されます"}
                tone={wallet?.depositDetectedAt ? "profit" : "default"}
              />
              <StatCard
                title="Owner接続"
                value={wallet?.ownerReconnectedAt ? "確認済み" : "未確認"}
                note={wallet?.ownerReconnectedAt ? formatDate(wallet.ownerReconnectedAt) : "必要なときに記録できます"}
              />
            </div>

            <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] p-4 text-sm leading-7 text-white/78">
              入金確認、バックアップ確認、保有資産の3点を見れば、今の運用状況をひと通り把握できます。
            </div>
          </Panel>
        </section>

        {!canManageWallet ? (
          <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/72">
            先にログインしてください。
          </div>
        ) : null}

        {loading ? (
          <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border border-gold-400/25 bg-black/90 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_24px_rgba(253,224,71,0.12)]">
            読み込み中...
          </div>
        ) : null}
      </div>
    </main>
  );
}
