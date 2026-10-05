import type { NextRequest } from "next/server";

const FALLBACK_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://professional-dismanager.net";

export function getWebAuthnRequestContext(req: NextRequest) {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host") || new URL(FALLBACK_APP_URL).host;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const origin = `${proto}://${host}`;

  return {
    origin,
    rpID: host.split(":")[0],
  };
}
