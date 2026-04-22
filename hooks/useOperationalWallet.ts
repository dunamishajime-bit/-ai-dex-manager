"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { OperationalWalletRecord } from "@/lib/operational-wallet-types";

type ResponseShape = {
  ok?: boolean;
  wallet?: OperationalWalletRecord | null;
};

export function useOperationalWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<OperationalWalletRecord | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const email = user?.email?.trim().toLowerCase();
    if (!email) {
      setWallet(null);
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
        return null;
      }
      setWallet(data.wallet ?? null);
      return data.wallet ?? null;
    } finally {
      setLoading(false);
    }
  }, [user?.email, user?.id, user?.nickname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { wallet, loading, refresh };
}
