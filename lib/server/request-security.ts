export function validateMutationRequestHeaders(headers: Headers, expectedHost: string) {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== "same-origin") return false;
  const origin = headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim()
      || headers.get("host")?.split(",")[0]?.trim();
    if (parsed.protocol !== "https:") return false;
    if (forwardedProto && forwardedProto !== "https") return false;
    if (parsed.host !== expectedHost || host !== expectedHost) return false;
    return true;
  } catch {
    return false;
  }
}
