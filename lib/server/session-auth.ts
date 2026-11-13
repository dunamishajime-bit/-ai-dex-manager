import type { NextRequest } from "next/server";
import { verifyRequestSession } from "@/lib/server/owner-session";

export function requestHasSignedOwnerSession(request: NextRequest) {
  try {
    verifyRequestSession(request, ["USER", "ADMIN"]);
    return true;
  } catch {
    return false;
  }
}
