import { NextResponse } from "next/server";

const MESSAGE =
  "DISTerminal is read-only. Trading is owned exclusively by the approved VPS systemd runners.";

export function disabledTradingRouteResponse() {
  return NextResponse.json(
    {
      ok: false,
      readOnly: true,
      ordersSent: false,
      error: MESSAGE,
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
