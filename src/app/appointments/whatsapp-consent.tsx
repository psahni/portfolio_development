"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function WhatsAppConsent({ appointmentId }: { appointmentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false), [withdrawn, setWithdrawn] = useState(false), [error, setError] = useState("");
  async function withdraw() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/patient/whatsapp/withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appointmentId }) });
      if (!response.ok) throw new Error();
      setWithdrawn(true); router.refresh();
    } catch { setError("Could not withdraw consent. Please retry."); }
    finally { setPending(false); }
  }
  return <div className="w-full border-t pt-3 text-xs"><p className="ui-hint">{withdrawn ? "WhatsApp consent withdrawn." : "WhatsApp notifications are optional. Withdrawing stops pending notifications; a message already being sent cannot be recalled."}</p>{!withdrawn && <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void withdraw()} className="mt-2">{pending ? "Withdrawing…" : "Withdraw WhatsApp consent"}</Button>}{error && <p role="alert" className="mt-2 text-red-800">{error}</p>}</div>;
}
