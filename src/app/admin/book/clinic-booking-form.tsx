"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { clinicBookingSchema, contactSchema, type BookingReceipt } from "@/modules/booking/models";
import type { AvailableTimes } from "@/modules/scheduling/slots";
import type { SlotChoice } from "@/modules/scheduling/engine";

type Submission = ReturnType<typeof clinicBookingSchema.parse>;

export function ClinicBookingForm({ initial }: { initial: AvailableTimes }) {
  const [view, setView] = useState(initial), [date, setDate] = useState(initial.noAvailableDates ? "" : initial.date);
  const [selected, setSelected] = useState<SlotChoice | null>(null);
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [phone, setPhone] = useState("");
  const [reviewing, setReviewing] = useState(false), [pending, setPending] = useState<"times" | "confirm" | null>(null);
  const [error, setError] = useState(""), [uncertain, setUncertain] = useState(false), [accessDenied, setAccessDenied] = useState(false);
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  const submission = useRef<Submission | null>(null), inFlight = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const locked = !!pending || uncertain || accessDenied;
  useEffect(() => { if (selected || receipt) heading.current?.focus(); }, [selected, reviewing, receipt]);
  const agenda = `/admin/appointments?date=${encodeURIComponent(view.date)}`;
  const dateLabel = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "full" }).format(new Date(`${value}T12:00:00Z`));
  const timeLabel = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: view.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value));

  async function loadTimes(chosenDate: string) {
    setPending("times"); setError(""); setSelected(null); setReviewing(false);
    try {
      const response = await fetch(`/api/admin/booking-availability?date=${encodeURIComponent(chosenDate)}`, { cache: "no-store", credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setAccessDenied(true);
        throw new Error(data.error);
      }
      setView(data); setDate(data.date);
    } catch (failure) { setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Unable to load times. Please try again."); }
    finally { setPending(null); }
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked || !selected) return;
    const result = contactSchema.safeParse({ name, email, phone });
    if (!result.success) { setError("Enter the patient’s name, a valid email and a phone number with 7–15 digits."); return; }
    setName(result.data.name); setEmail(result.data.email); setPhone(result.data.phone);
    setError(""); setReviewing(true);
  }
  async function confirm() {
    if (inFlight.current || !selected || receipt || accessDenied) return;
    inFlight.current = true; setPending("confirm"); setError("");
    // Keep the exact actor-scoped request after a lost response: the commit may
    // already have succeeded. Editing stays locked until retry resolves it.
    submission.current ??= { requestId: crypto.randomUUID(), startsAt: selected.startsAt, name, email, phone };
    try {
      const response = await fetch("/api/admin/bookings", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission.current) });
      const data = await response.json();
      if (response.ok && data.receipt) { setReceipt(data.receipt); setUncertain(false); return; }
      if (response.status >= 500) throw new Error("Unknown confirmation result");
      if (response.status === 401 || response.status === 403) {
        setAccessDenied(true); setError(data.error ?? "Sign in again to continue."); return;
      }
      if (uncertain) {
        // A later conflict cannot disprove an earlier successful commit (for
        // example after the receipt expires). Keep the original retry payload.
        setError(data.error ?? "Check the agenda before starting another booking."); return;
      }
      submission.current = null;
      if (response.status === 409) await loadTimes(view.date);
      setError(data.error ?? "Unable to confirm. Check the details and try again.");
    } catch { setUncertain(true); setError("Confirmation couldn’t be checked. Retry confirmation to check the same request, or check the agenda before starting another booking."); }
    finally { inFlight.current = false; setPending(null); }
  }

  if (receipt) return <section aria-label="Booking confirmation" className="ui-panel max-w-2xl">
    <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">Appointment confirmed</h2>
    <p role="status" className="ui-hint mt-3">The appointment is saved in the clinic agenda.</p>
    <dl className="mt-5 space-y-3 text-sm"><div><dt className="text-muted-foreground">Patient</dt><dd className="break-words font-medium">{name}</dd></div><div><dt className="text-muted-foreground">Date</dt><dd>{dateLabel(view.date)}</dd></div><div><dt className="text-muted-foreground">Time</dt><dd>{timeLabel(receipt.startsAt)} – {timeLabel(receipt.endsAt)} ({receipt.timezone})</dd></div></dl>
    <Button asChild className="mt-6"><Link href={agenda}>View daily agenda</Link></Button>
  </section>;

  return <div className="max-w-4xl space-y-5">
    <div className="flex flex-wrap justify-between gap-3 text-sm"><p>{view.clinicName} · {view.doctorName}</p><p className="text-muted-foreground">All times in {view.timezone}</p></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {accessDenied && <Link href="/admin" className="block text-primary underline">Sign in again</Link>}
    <section className="ui-panel" aria-labelledby="clinic-times-title" aria-busy={pending === "times"}>
      <h2 id="clinic-times-title" className="text-lg font-semibold">Choose a time</h2>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (!locked) void loadTimes(date); }}>
        <label className="min-w-0 text-sm font-medium">Appointment date<input type="date" required min={view.today} max={view.lastDate} value={date} disabled={locked} onChange={(event) => { setDate(event.target.value); setSelected(null); setReviewing(false); setError(""); }} className="ui-input block" /></label>
        <Button variant="outline" disabled={locked || !date}>{pending === "times" ? "Loading…" : "Show times"}</Button>
      </form>
      {view.noAvailableDates ? <p role="status" className="ui-hint mt-5">No appointments are available within the booking window. Choose a date to check again.</p> : date !== view.date ? <p className="ui-hint mt-5">Select Show times to load this date.</p> : <>
        <p className="mt-5 text-sm font-medium">{dateLabel(view.date)}</p>
        {!view.slots.some((slot) => slot.availability === "available") && <p role="status" className="ui-hint mt-3">{view.closed ? "The clinic is closed on this date." : "No free times on this date."} Choose another day.</p>}
        <div role="group" aria-label="Appointment times" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">{view.slots.map((slot) => <button type="button" key={slot.startsAt} disabled={locked || slot.availability !== "available"} aria-pressed={selected?.startsAt === slot.startsAt} onClick={() => { submission.current = null; setSelected(slot); setReviewing(false); setError(""); }} className="min-h-11 rounded-lg border px-3 py-3 text-sm enabled:hover:border-primary disabled:bg-muted disabled:text-muted-foreground aria-pressed:border-primary aria-pressed:bg-available">{slot.label}{slot.availability !== "available" && <span className="block text-xs">Unavailable</span>}</button>)}</div>
      </>}
    </section>
    {selected && <section className="ui-panel max-w-2xl" aria-busy={pending === "confirm"}>
      <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">{reviewing ? "Review appointment" : "Patient details"}</h2>
      <p className="ui-hint mt-3">{dateLabel(view.date)} · {selected.label} · {view.timezone}</p>
      {reviewing ? <>
        <dl className="mt-5 space-y-3 text-sm"><div><dt className="text-muted-foreground">Name</dt><dd className="break-words">{name}</dd></div><div><dt className="text-muted-foreground">Email</dt><dd className="break-all">{email}</dd></div><div><dt className="text-muted-foreground">Phone number</dt><dd>{phone}</dd></div></dl>
        <p className="ui-hint mt-5">The time is booked only after confirmation. Availability is checked again when you confirm.</p>
        <div className="mt-5 flex flex-wrap gap-3"><Button type="button" disabled={!!pending || accessDenied} onClick={() => void confirm()}>{pending === "confirm" ? "Confirming…" : uncertain ? "Retry confirmation" : "Confirm booking"}</Button><Button type="button" variant="outline" disabled={locked} onClick={() => { setReviewing(false); setError(""); }}>Edit details</Button></div>
        {uncertain && <Link href={agenda} className="mt-4 inline-block text-sm text-primary underline">Check daily agenda</Link>}
      </> : <form onSubmit={review} noValidate className="mt-5 space-y-4">
        <div><label htmlFor="clinic-patient-name" className="text-sm font-medium">Patient name</label><input id="clinic-patient-name" autoComplete="off" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={locked} className="ui-input" /></div>
        <div><label htmlFor="clinic-patient-email" className="text-sm font-medium">Patient email</label><input id="clinic-patient-email" type="email" autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={locked} className="ui-input" /></div>
        <div><label htmlFor="clinic-patient-phone" className="text-sm font-medium">Patient phone</label><input id="clinic-patient-phone" type="tel" autoComplete="off" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} disabled={locked} className="ui-input" /></div>
        <Button disabled={locked}>Review booking</Button>
      </form>}
      <Button type="button" variant="outline" className="mt-4" disabled={locked} onClick={() => { setSelected(null); setReviewing(false); setError(""); }}>Discard selection</Button>
    </section>}
  </div>;
}
