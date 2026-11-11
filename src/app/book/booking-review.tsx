"use client";

import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

import { cancellationPolicy, rebookingPolicy } from "@/modules/booking/cancellation-policy";

type Props = {
  open: boolean; locked: boolean; pending: boolean; uncertain: boolean; signInRequired: boolean;
  visit: { date: string; time: string } | null; timezone: string;
  name: string; email: string; phone: string; error: string;
  onClose: () => void; onEdit: () => void; onConfirm: () => void;
};

function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
  const index = controls.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
  else if (!event.shiftKey && (index === controls.length - 1 || index === -1)) { event.preventDefault(); controls[0]?.focus(); }
}

export function BookingReview(props: Props) {
  const { open, locked, pending, uncertain, signInRequired, visit, timezone, name, email, phone, error, onClose, onEdit, onConfirm } = props;
  const panel = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = panel.current;
    if (!open || !dialog) return;
    const overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden"; heading.current?.focus();
    return () => { dialog.close(); document.body.style.overflow = overflow; };
  }, [open]);
  return <dialog ref={panel} aria-labelledby="booking-review-title" aria-describedby="booking-review-help" onKeyDown={keepFocus}
    onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}
    className="booking-review fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border bg-card p-5 text-foreground shadow-xl sm:p-6">
    <div className="flex items-start justify-between gap-4"><h2 id="booking-review-title" ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight">Review your appointment</h2><Button type="button" variant="outline" size="sm" aria-label="Close review" disabled={locked} onClick={onClose}><X aria-hidden="true" /></Button></div>
    {visit && <div className="my-5 rounded-lg bg-muted p-4 text-sm"><p className="font-medium">{visit.date}</p><p className="mt-2">{visit.time}</p><p className="mt-1 text-xs text-muted-foreground">{timezone}</p></div>}
    <dl className="space-y-4 text-sm"><div><dt className="text-muted-foreground">Name</dt><dd className="mt-1 break-words font-medium">{name}</dd></div><div><dt className="text-muted-foreground">Verified email</dt><dd className="mt-1 break-all">{email}</dd></div><div><dt className="text-muted-foreground">Phone number</dt><dd className="mt-1">{phone}</dd></div></dl>
    <p id="booking-review-help" className="ui-hint mt-5 text-xs">Your time is booked only after confirmation. Availability is checked again when you confirm.</p>
    <section aria-labelledby="review-cancellation-policy" className="mt-4"><h3 id="review-cancellation-policy" className="text-sm font-semibold">Cancellation policy</h3><p className="ui-hint mt-2 text-xs">{cancellationPolicy} {rebookingPolicy}</p></section>
    {open && error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {signInRequired && <Link href="/login?next=/book" className="mt-4 block text-sm font-medium text-primary underline">Sign in again to book</Link>}
    <div aria-busy={pending} className="mt-5 space-y-3"><Button type="button" onClick={onConfirm} disabled={pending || signInRequired} className="w-full">{pending ? "Confirming…" : uncertain ? "Retry confirmation" : "Confirm booking"}</Button><Button type="button" variant="outline" className="w-full" disabled={locked} onClick={onEdit}>Edit details</Button></div>
    {uncertain && <Link href="/appointments" className="mt-4 block text-center text-sm text-primary underline">Check My appointments</Link>}
  </dialog>;
}
