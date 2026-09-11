import { disabledTradingRouteResponse } from "@/lib/server/disabled-trading-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return disabledTradingRouteResponse();
}

export async function GET() {
  return disabledTradingRouteResponse();
}

export async function PATCH() {
  return disabledTradingRouteResponse();
}
