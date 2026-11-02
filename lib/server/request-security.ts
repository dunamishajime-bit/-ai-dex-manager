import type { NextRequest } from "next/server";

export function requireSameOriginMutation(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== "same-origin") throw new Error("MUTATION_FETCH_SITE_REJECTED");
  const origin = request.headers.get("origin");
  if (!origin) throw new Error("MUTATION_ORIGIN_REQUIRED");
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new Error("MUTATION_ORIGIN_INVALID"); }
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  if (parsed.host !== host || parsed.protocol !== proto + ":") throw new Error("MUTATION_ORIGIN_MISMATCH");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") throw new Error("MUTATION_HTTPS_REQUIRED");
}
