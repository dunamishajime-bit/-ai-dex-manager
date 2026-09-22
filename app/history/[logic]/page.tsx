import { notFound } from "next/navigation";

import { LivePerformanceDashboard } from "@/components/features/LivePerformanceDashboard";

const LOGICS = {
  v12: "V12",
  pengu: "PENGU",
  q102: "Q102",
  fet: "FET",
  v52: "V52",
} as const;

export default async function LogicPerformancePage({
  params,
}: {
  params: Promise<{ logic: string }>;
}) {
  const { logic: logicParam } = await params;
  const logic = LOGICS[logicParam as keyof typeof LOGICS];
  if (!logic) notFound();
  return <LivePerformanceDashboard logic={logic} title={`${logic} 実績集計`} />;
}
