// Next.js route entries may export HTTP methods and route configuration only.
// Testable implementation lives in lib/server/decision-status-route-handler.ts.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export { GET } from "@/lib/server/decision-status-route-handler";
