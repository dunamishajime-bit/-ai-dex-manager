"use client";

import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1">{children}</div>;
}
