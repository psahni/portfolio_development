"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = { id: string; name: string; date: string; time: string; timezone: string; canManageDetails: boolean };
const subscribeToHydration = () => () => {};

function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]"));
  const index = controls.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
  else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0]?.focus(); }
}

export function DoctorCancellation({ id, name, date, time, timezone, canManageDetails }: Props) {
  // The date filter performs a document navigation. Keep its server-rendered
  // cancellation control disabled until the dialog's client handlers are ready.
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const router = useRouter(), panel = useRef<HTMLDialogElement>(null), title = useRef<HTMLHeadingElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false), payload = useRef<string | null>(null);
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [done, setDone] = useState(false);
  const [reason, setReason] = useState(""), [instruction, setInstruction] = useState(""), [block, setBlock] = useState(false);
  const [error, setError] = useState(""), [uncertain, setUncertain] = useState(false), [accessDenied, setAccessDenied] = useState(false);
  useEffect(() => {
    const dialog = panel.current;
    if (!open || !dialog) return;
    const overflow = document.body.style.overflow, opener = trigger.current;
    dialog.showModal(); document.body.style.overflow = "hidden"; title.current?.focus();
    return () => { dialog.close(); document.body.style.overflow = overflow; opener?.focus(); };
  }, [open]);
  function close() {
    if (inFlight.current) return;
    setOpen(false);
    if (uncertain) router.refresh();
  }
  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || done || accessDenied) return;
    inFlight.current = true; setPending(true); setError("");
    // Freeze the exact request after an uncertain response. A retry must not
    // silently change whether the original time is blocked or why it was cancelled.
    const body = payload.current ?? JSON.stringify({ appointmentId: id, reason, rebookingInstruction: canManageDetails ? instruction : "", blockOriginalTime: canManageDetails && block });
    payload.current = body;
    try {
      const response = await fetch("/api/admin/appointments", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setAccessDenied(true);
        if (response.status >= 500) setUncertain(true);
        else if (!uncertain) payload.current = null;
        setError(data.error ?? "Cancellation could not be checked. Please retry or refresh appointments.");
        return;
      }
      if (data.appointment?.id !== id || data.appointment?.status !== "cancelled") throw new Error();
      setDone(true); setOpen(false); router.refresh();
    } catch { setUncertain(true); setError("Cancellation could not be checked. Retry the same cancellation or close to refresh appointments."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const frozen = pending || uncertain;
  return <>
    {done ? <p role="status" className="text-sm text-primary">Appointment cancelled</p> : <Button ref={trigger} type="button" variant="outline" size="sm" disabled={!hydrated} onClick={() => setOpen(true)}>Cancel appointment</Button>}
    <dialog ref={panel} aria-labelledby={`doctor-cancel-${id}`} aria-describedby={`doctor-cancel-help-${id}`} onKeyDown={containFocus} onCancel={(event) => { event.preventDefault(); close(); }}
      className="booking-review fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border bg-card p-5 text-foreground shadow-xl sm:p-6">
      <div className="flex items-start justify-between gap-4"><h2 ref={title} tabIndex={-1} id={`doctor-cancel-${id}`} className="text-xl font-semibold tracking-tight">Cancel this appointment?</h2><Button type="button" variant="outline" size="sm" aria-label="Close cancellation" disabled={pending} onClick={close}><X aria-hidden="true" /></Button></div>
      <div className="my-5 rounded-lg bg-muted p-4 text-sm"><p className="break-words font-medium">{name}</p><p className="mt-2">{date}</p><p className="mt-2">{time}</p><p className="mt-1 text-xs text-muted-foreground">{timezone}</p></div>
      <form onSubmit={(event) => void cancel(event)} className="space-y-4" aria-busy={pending}>
        <label className="block text-sm font-medium">Cancellation reason<input className="ui-input mt-2 block w-full" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={160} disabled={frozen} /></label>
        <p className="ui-hint">Use a short nonclinical reason. Do not enter medical details.</p>
        {canManageDetails && <><label className="block text-sm font-medium">Rebooking instruction (optional)<input className="ui-input mt-2 block w-full" value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={300} disabled={frozen} /></label>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={block} onChange={(event) => setBlock(event.target.checked)} disabled={frozen} /><span>Block the original time, including its booked preparation buffers</span></label></>}
        <p id={`doctor-cancel-help-${id}`} className="ui-hint">The cancelled visit will stay in the Cancelled tab. {canManageDetails ? "Rebooking instructions do not reserve a time." : "The appointment time will be released."} Automatic patient notices are not enabled; contact the patient to explain the change.</p>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {accessDenied && <Link href="/admin" className="block text-sm text-primary underline">Sign in again</Link>}
        <div className="flex flex-wrap gap-3 pt-2"><Button type="button" variant="outline" disabled={pending} onClick={close}>{uncertain ? "Close and refresh" : "Keep appointment"}</Button><Button type="submit" disabled={pending || accessDenied} className="border-red-700 bg-red-700 text-white hover:bg-red-800">{pending ? "Cancelling…" : error ? "Retry cancellation" : "Cancel appointment"}</Button></div>
      </form>
    </dialog>
  </>;
}
