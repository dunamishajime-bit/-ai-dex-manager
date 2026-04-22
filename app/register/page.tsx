import { redirect } from "next/navigation";

import RegisterPageContent from "@/components/features/RegisterPage";
import { PUBLIC_REGISTER_ENABLED } from "@/lib/site-access";

export default function RegisterPage() {
  if (!PUBLIC_REGISTER_ENABLED) {
    redirect("/login");
  }

  return <RegisterPageContent />;
}
