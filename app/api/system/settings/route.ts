import { NextRequest, NextResponse } from "next/server";
import { loadSystemSettings, saveSystemSettings } from "@/lib/server/system-settings-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await loadSystemSettings();
  return NextResponse.json({ success: true, settings });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      registrationEnabled?: boolean;
      adminTwoFactorEnabled?: boolean;
    };
    const settings = await saveSystemSettings({
      registrationEnabled: body.registrationEnabled,
      adminTwoFactorEnabled: body.adminTwoFactorEnabled,
    });
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error("System settings patch failed:", error);
    return NextResponse.json({ success: false, error: "システム設定更新に失敗しました。" }, { status: 500 });
  }
}
