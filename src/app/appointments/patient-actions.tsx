"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestPatientAuth } from "@/modules/identity/client";

export function PatientActions() {
  const router = useRouter();
  const [pending, setPending] = useState(false), [error, setError] = useState(false);
  async function signOut() {
    if (pending) return;
    setPending(true); setError(false);
    try { await requestPatientAuth("sign-out", {}); router.replace("/login"); router.refresh(); }
    catch { setError(true); setPending(false); }
  }
  return <div className="space-y-2"><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" aria-label="Refresh appointments" onClick={() => router.refresh()} disabled={pending}><RefreshCw aria-hidden="true" className="size-3.5" /><span className="hidden sm:inline">Refresh</span></Button><Button type="button" variant="outline" size="sm" onClick={() => void signOut()} disabled={pending}>{pending ? "Signing out…" : "Sign out"}</Button></div>{error && <p role="alert" className="text-xs text-red-800">Unable to sign out. Please try again.</p>}</div>;
}
