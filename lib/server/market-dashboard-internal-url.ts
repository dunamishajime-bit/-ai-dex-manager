/**
 * Resolve the in-process refresh endpoint without trusting a publicly supplied
 * app URL. Production's standalone HP server listens on PORT=3001; the
 * historical hard-coded localhost:3000 address is not a running service.
 *
 * This is display-data bootstrap only, never a trading/deployment endpoint.
 */
export function marketDashboardInternalRefreshUrl(port: string | undefined = process.env.PORT): string {
  const raw = (port ?? "3000").trim();
  if (!/^[0-9]{1,5}$/.test(raw)) throw new Error("MARKET_DASHBOARD_INVALID_LISTEN_PORT");
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("MARKET_DASHBOARD_INVALID_LISTEN_PORT");
  }
  return `http://127.0.0.1:${value}/api/agents/refresh-universe`;
}
