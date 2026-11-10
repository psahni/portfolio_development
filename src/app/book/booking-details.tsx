"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean; focusReview: boolean; locked: boolean; visit: { date: string; time: string }; timezone: string; email: string; name: string; phone: string; error: string;
  onNameChange: (value: string) => void; onPhoneChange: (value: string) => void; onReview: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void;
};

export function BookingDetails({ open, focusReview, locked, visit, timezone, email, name, phone, error, onNameChange, onPhoneChange, onReview, onClose }: Props) {
  const panel = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), reviewButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = panel.current;
    if (!open || !dialog) return;
    const overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden"; (focusReview ? reviewButton.current : heading.current)?.focus();
    return () => { dialog.close(); document.body.style.overflow = overflow; };
  }, [open, focusReview]);
  return <dialog ref={panel} aria-labelledby="booking-details-title" onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}
    className="booking-dialog fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl border bg-card p-5 text-foreground shadow-xl sm:p-6">
    <div className="flex items-start justify-between gap-4"><h2 id="booking-details-title" ref={heading} tabIndex={-1} className="text-lg font-semibold">Your details</h2><Button type="button" variant="outline" size="sm" aria-label="Close details" disabled={locked} onClick={onClose}><X aria-hidden="true" /></Button></div>
    <div className="my-5 rounded-lg bg-muted p-4 text-sm"><p className="font-medium">{visit.date}</p><p className="mt-2">{visit.time}</p><p className="mt-1 text-xs text-muted-foreground">{timezone}</p></div>
    <form onSubmit={onReview} noValidate className="space-y-5">
      <div><label htmlFor="booking-name" className="text-sm font-medium">Full name</label><input id="booking-name" name="name" autoComplete="name" maxLength={100} value={name} onChange={(event) => onNameChange(event.target.value)} disabled={locked} className="ui-input" /></div>
      <div><label htmlFor="booking-email" className="text-sm font-medium">Verified email</label><input id="booking-email" type="email" value={email} readOnly className="ui-input bg-muted" /><p className="ui-hint mt-2 text-xs">This is the email you signed in with.</p></div>
      <div><label htmlFor="booking-phone" className="text-sm font-medium">Phone number</label><input id="booking-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(event) => onPhoneChange(event.target.value)} disabled={locked} className="ui-input" /></div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      <Button ref={reviewButton} type="submit" disabled={locked} className="w-full">Review booking</Button>
    </form>
    <p className="mt-6 flex items-start gap-2 border-t pt-5 text-xs leading-relaxed text-muted-foreground"><ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />Your details are used for this appointment. Choosing a time does not reserve it.</p>
  </dialog>;
}
