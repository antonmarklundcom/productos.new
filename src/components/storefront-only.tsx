"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Keep shopping navigation out of the admin workspace and login screen. */
export function StorefrontOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;
  return <>{children}</>;
}
