import { redirect } from "next/navigation";

export default function RemovedDecisionLogicRedirect() {
  redirect("/decision-status");
}
