import { createV12V4HpStatusGet } from "@/lib/server/v12-v4-hp-status-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = createV12V4HpStatusGet();
