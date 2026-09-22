import { notFound } from "next/navigation";

import { LivePerformanceDashboard } from "@/components/features/LivePerformanceDashboard";

const LOGICS = {
  v12: "V12",
  pengu: "PENGU",
  q102: "Q102",
  fet: "FET",
  v52: "V52",
} as const;

export default function LogicPerformancePage({ params }: { params: { logic: string } }) {
  const logic = LOGICS[params.logic as keyof typeof LOGICS];
  if (!logic) notFound();
  return <LivePerformanceDashboard logic={logic} title={`${logic} 実績集計`} />;
}
