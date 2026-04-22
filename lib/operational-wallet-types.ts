export type OperationalWalletStatus = "created" | "awaiting_deposit" | "running" | "paused";

export type OperationalWhitelistEntry = {
  id: string;
  label: string;
  address: string;
  createdAt: string;
};

export type OperationalWalletHolding = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  balanceWei: string;
  amount: string;
  usdPrice: number;
  usdValue: number;
  isNative?: boolean;
};

export type OperationalWalletRecord = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  label: string;
  address: string;
  encryptedPrivateKey: string;
  chainId: number;
  chainName: string;
  createdAt: string;
  updatedAt: string;
  status: OperationalWalletStatus;
  backupConfirmed: boolean;
  note?: string;
  ownerReconnectedAt?: string;
  depositDetectedAt?: string;
  lastBalanceWei?: string;
  lastBalanceFormatted?: string;
  lastPortfolioUsd?: number;
  trackedHoldings?: OperationalWalletHolding[];
  deletedAt?: string;
  whitelist: OperationalWhitelistEntry[];
};
