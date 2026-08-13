Exit code: 0
Wall time: 1 seconds
Output:
"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { OperationalWalletRecord } from "@/lib/operational-wallet-types";
import type { AsterReadonlySnapshot } from "@/lib/server/aster-readonly";

type ResponseShape = {
  ok?: boolean;
  wallet?: OperationalWalletRecord | null;
  asterAccount?: AsterReadonlySnapshot;
};

export function useOperationalWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<OperationalWalletRecord | null>(null);
  const [asterAccount, setAsterAccount] = useState<AsterReadonlySnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const email = user?.email?.trim().toLowerCase();
    if (!email) {
      setWallet(null);
      setAsterAccount(null);
      return null;
    }

    const params = new URLSearchParams({
      email,
      displayName: user?.nickname || user?.email || "ユーザー",
    });
    if (user?.id) {
      params.set("userId", user.id);
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/operational-wallets?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as ResponseShape;
      if (!response.ok || !data?.ok) {
        setWallet(null);
        setAsterAccount(null);
        return null;
      }
      setWallet(data.wallet ?? null);
      setAsterAccount(data.asterAccount ?? null);
      return data.wallet ?? null;
    } finally {
      setLoading(false);
    }
  }, [user?.email, user?.id, user?.nickname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { wallet, asterAccount, loading, refresh };
}

