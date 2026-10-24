import { REALTIME_ROUTE } from "@/components/layout/navigation-contract";

export const BOTTOM_NAV_ROUTES = [
  { label: "ホーム", href: "/" },
  { label: "ダッシュ", href: "/positions" },
  REALTIME_ROUTE,
  { label: "判定状況", href: "/decision-status" },
  { label: "ウォレット", href: "/wallets" },
  { label: "損益", href: "/performance" },
  { label: "履歴", href: "/history" },
  { label: "設定", href: "/settings" },
] as const;

export const BOTTOM_NAV_LAYOUT = {
  overflowClass: "overflow-x-auto",
  stripClass: "min-w-max",
  itemMinWidthClass: "min-w-[58px]",
} as const;
