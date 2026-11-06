"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requestStaffAuth } from "@/modules/identity/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    setPending(true); setError(false);
    try { await requestStaffAuth("sign-out", {}); router.replace("/admin"); router.refresh(); }
    catch { setError(true); setPending(false); }
  }
  return <div className="space-y-2"><Button variant="outline" onClick={() => void signOut()} disabled={pending}>{pending ? "Signing out…" : "Sign out"}</Button>{error && <p role="alert" className="text-sm text-red-800">Unable to sign out. Please try again.</p>}</div>;
}
