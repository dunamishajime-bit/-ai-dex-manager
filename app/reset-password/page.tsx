import { redirect } from "next/navigation";

import ResetPasswordPageContent from "@/components/features/ResetPasswordPage";
import { PUBLIC_RESET_PASSWORD_ENABLED } from "@/lib/site-access";

export default function ResetPasswordPage() {
  if (!PUBLIC_RESET_PASSWORD_ENABLED) {
    redirect("/login");
  }

  return <ResetPasswordPageContent />;
}
