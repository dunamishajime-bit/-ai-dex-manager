import { NextRequest, NextResponse } from "next/server";
import { findUserById, upsertUser } from "@/lib/server/user-db";
import { verifyRequestSession } from "@/lib/server/owner-session";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export async function POST(req: NextRequest) {
  try {
    requireSameOriginMutation(req);
    verifyRequestSession(req, ["ADMIN"]);
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ success: false, error: "User ID is required" }, { status: 400 });
    const user = await findUserById(String(userId));
    if (!user) return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    user.isApproved = true;
    await upsertUser(user);
    return NextResponse.json({ success: true, user: { id: user.id, isApproved: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json({ success: false, error: /MUTATION_|OWNER_SESSION_/.test(message) ? "Authentication required." : "Internal server error" }, { status: /MUTATION_|OWNER_SESSION_/.test(message) ? 403 : 500 });
  }
}
