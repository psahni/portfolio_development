"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

import { cancellationPolicy, rebookingPolicy } from "@/modules/booking/cancellation-policy";

type Props = { id: string; date: string; time: string; timezone: string };

function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
  const index = controls.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
  else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0]?.focus(); }
}

export function CancelAppointment({ id, date, time, timezone }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [signInRequired, setSignInRequired] = useState(false), [done, setDone] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const panel = useRef<HTMLDialogElement>(null), title = useRef<HTMLHeadingElement>(null), inFlight = useRef(false);
  useEffect(() => {
    const dialog = panel.current;
    if (!open || !dialog) return;
    const overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden"; title.current?.focus();
    return () => { dialog.close(); document.body.style.overflow = overflow; };
  }, [open]);
  function close() { if (!inFlight.current) { setOpen(false); setError(""); if (uncertain) router.refresh(); } }
  async function cancel() {
    if (inFlight.current || done) return;
    inFlight.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/patient/appointments/cancel", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appointmentId: id }) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) setSignInRequired(true);
        if (response.status >= 500) setUncertain(true);
        setError(data.error ?? "Unable to cancel. Please try again."); return;
      }
      if (data.appointment?.id !== id || data.appointment?.status !== "cancelled") throw new Error();
      setDone(true); setOpen(false); router.refresh();
    } catch { setUncertain(true); setError("Cancellation couldn’t be checked. Retry cancellation or refresh My appointments."); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <>
    {done ? <p role="status" className="text-sm font-medium text-primary">Appointment cancelled</p> : <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Cancel appointment</Button>}
    <dialog ref={panel} aria-labelledby={`cancel-title-${id}`} aria-describedby={`cancel-help-${id}`} onKeyDown={containFocus} onCancel={(event) => { event.preventDefault(); close(); }}
      className="booking-review fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border bg-card p-5 text-foreground shadow-xl sm:p-6">
      <div className="flex items-start justify-between gap-4"><h2 ref={title} tabIndex={-1} id={`cancel-title-${id}`} className="text-xl font-semibold tracking-tight">Cancel this appointment?</h2><Button type="button" variant="outline" size="sm" aria-label="Close cancellation" disabled={pending} onClick={close}><X aria-hidden="true" /></Button></div>
      <div className="my-5 rounded-lg bg-muted p-4 text-sm"><p className="font-medium">{date}</p><p className="mt-2">{time}</p><p className="mt-1 text-xs text-muted-foreground">{timezone}</p></div>
      <p id={`cancel-help-${id}`} className="ui-hint">This will cancel your visit and release its reserved time. The cancelled appointment will stay in your history.</p>
      <p className="ui-hint mt-3">{cancellationPolicy}</p>
      <p className="ui-hint mt-3">{rebookingPolicy}</p>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {signInRequired && <Link href="/login" className="mt-4 block text-sm text-primary underline">Sign in again</Link>}
      <div className="mt-6 flex flex-wrap gap-3" aria-busy={pending}>
        <Button type="button" variant="outline" disabled={pending} onClick={close}>{uncertain ? "Close" : "Keep appointment"}</Button>
        <Button type="button" disabled={pending || signInRequired} onClick={() => void cancel()} className="border-red-700 bg-red-700 text-white hover:bg-red-800">{pending ? "Cancelling…" : error ? "Retry cancellation" : "Cancel appointment"}</Button>
      </div>
    </dialog>
  </>;
}
