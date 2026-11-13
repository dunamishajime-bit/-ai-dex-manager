import { NextRequest, NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE } from "@/lib/server/owner-session";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginMutation(request);
  } catch {
    return NextResponse.json({ success: false, error: "origin mismatch" }, { status: 403 });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.delete(OWNER_SESSION_COOKIE);
  response.cookies.delete("disdex_admin_otp_challenge");
  response.cookies.delete("disdex_admin_deploy_otp_challenge");
  response.cookies.delete("disdex_production_otp_challenge");
  return response;
}
