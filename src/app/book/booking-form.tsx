"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Check, Clock3, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { patientBookingSchema, type BookingReceipt } from "@/modules/booking/models";
import type { AvailableTimes } from "@/modules/scheduling/slots";
import { BookingReview } from "./booking-review";

type View = { email: string; availability: AvailableTimes };
type Slot = AvailableTimes["slots"][number];
type Submission = { requestId: string; startsAt: string; name: string; phone: string };
function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
}
function visitLabel(visit: { startsAt: string; endsAt: string }, timezone: string) {
  const date = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(visit.startsAt));
  const time = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
  return { date, time: `${time(visit.startsAt)} – ${time(visit.endsAt)}` };
}

export function BookingForm({ initial }: { initial: View }) {
  const [view, setView] = useState(initial), [date, setDate] = useState(initial.availability.date);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const [step, setStep] = useState<"choose" | "details" | "review">("choose");
  const [pending, setPending] = useState<"times" | "confirm" | null>(null);
  const [error, setError] = useState(""), [timesError, setTimesError] = useState("");
  const [signInRequired, setSignInRequired] = useState(false), [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  const submission = useRef<Submission | null>(null), inFlight = useRef(false);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (selected || receipt) stageHeading.current?.focus(); }, [selected, receipt]);
  const { availability, email } = view;
  const locked = !!pending || uncertain;

  async function loadTimes(selectedDate: string) {
    setPending("times"); setTimesError("");
    try {
      const response = await fetch(`/api/patient/availability?date=${encodeURIComponent(selectedDate)}`, { cache: "no-store", credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) { if (response.status === 401) setSignInRequired(true); throw new Error(data.error); }
      setView(data); setDate(data.availability.date);
    } catch (failure) { setTimesError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Unable to load times. Please try again."); }
    finally { setPending(null); }
  }
  function choose(slot: Slot) {
    if (locked) return;
    submission.current = null; setSelected(slot); setStep("details"); setError("");
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked || !selected) return;
    const contact = patientBookingSchema.pick({ name: true, phone: true }).safeParse({ name, phone });
    if (!contact.success) { setError("Enter your name and a phone number with 7–15 digits."); return; }
    setName(contact.data.name); setPhone(contact.data.phone); setError(""); setStep("review");
  }
  async function confirm() {
    if (inFlight.current || !selected || receipt) return;
    inFlight.current = true; setPending("confirm"); setError("");
    // A missing response may mean COMMIT succeeded. Keep the exact payload and UUID
    // until a definite result; retry must not silently become another booking.
    submission.current ??= { requestId: crypto.randomUUID(), startsAt: selected.startsAt, name, phone };
    try {
      const response = await fetch("/api/patient/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(submission.current) });
      const data = await response.json();
      if (response.ok && data.receipt) { setReceipt(data.receipt); setUncertain(false); return; }
      if (response.status >= 500 && (data.code !== "BOOKING_NOT_READY" || uncertain)) throw new Error("Confirmation couldn’t be checked. Retry confirmation to check the same request, or view My appointments.");
      setUncertain(false); submission.current = null;
      if (response.status === 401) setSignInRequired(true);
      setError(data.error ?? "Unable to confirm. Please try again.");
      if (response.status === 409) {
        setSelected(null); setStep("choose");
        await loadTimes(availability.date);
        errorMessage.current?.focus();
      }
    } catch {
      setUncertain(true); setError("Confirmation couldn’t be checked. Retry confirmation to check the same request, or view My appointments.");
    } finally { inFlight.current = false; setPending(null); }
  }

  if (receipt) {
    const visit = visitLabel(receipt, receipt.timezone);
    return <section aria-label="Booking confirmation" className="ui-panel mt-8 max-w-2xl"><div className="mb-5 flex size-12 items-center justify-center rounded-full bg-available text-primary"><Check aria-hidden="true" className="size-6" /></div><h2 ref={stageHeading} tabIndex={-1} className="text-2xl font-semibold tracking-tight">Appointment confirmed</h2><p role="status" className="ui-hint mt-3">Your appointment is booked. You can find it in My appointments.</p><dl className="mt-6 space-y-4 text-sm"><div><dt className="text-muted-foreground">Date</dt><dd className="mt-1 font-medium">{visit.date}</dd></div><div><dt className="text-muted-foreground">Time</dt><dd className="mt-1 font-medium">{visit.time}</dd></div><div><dt className="text-muted-foreground">Timezone</dt><dd className="mt-1">{receipt.timezone}</dd></div></dl><Button asChild className="mt-7"><Link href="/appointments">View My appointments</Link></Button></section>;
  }
  if (!availability.configured) return <section className="ui-panel mt-8 max-w-xl"><h2 className="font-semibold">Online booking is not available yet</h2><p className="ui-hint mt-3">Please contact the clinic to arrange an appointment.</p></section>;
  const visit = selected ? visitLabel(selected, availability.timezone) : null;
  return <div className="mt-8 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4 border-y py-5"><div><p className="font-semibold">{availability.clinicName}</p><p className="ui-hint mt-1">{availability.doctorName}</p></div><p className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 aria-hidden="true" className="size-4" />All times in {availability.timezone}</p></div>
    <ol aria-label="Booking steps" className="flex flex-wrap gap-x-6 gap-y-2 text-xs">{["Choose a time", "Your details", "Review & confirm"].map((label, index) => <li key={label} aria-current={index === ["choose", "details", "review"].indexOf(step) ? "step" : undefined} className="flex items-center gap-2 text-muted-foreground aria-[current=step]:font-semibold aria-[current=step]:text-primary"><span className="flex size-6 items-center justify-center rounded-full border">{index + 1}</span>{label}</li>)}</ol>
    {error && step !== "review" && <p ref={errorMessage} tabIndex={-1} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {signInRequired && step !== "review" && <p className="text-sm"><Link href="/login?next=/book" className="font-medium text-primary underline">Sign in again to book</Link></p>}
    <section className="ui-panel" aria-labelledby="times-title" aria-busy={pending === "times"}>
      <h2 id="times-title" className="flex items-center gap-2 text-lg font-semibold"><CalendarDays aria-hidden="true" className="size-5 text-primary" />Choose a time</h2>
      <form className="mt-5 flex max-w-md flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (!locked) { setSelected(null); setStep("choose"); setError(""); void loadTimes(date); } }}>
        <div className="min-w-0 flex-1"><label htmlFor="booking-date" className="text-sm font-medium">Appointment date</label><input id="booking-date" type="date" required min={availability.today} max={availability.lastDate} value={date} onChange={(event) => { setDate(event.target.value); setSelected(null); setStep("choose"); setError(""); }} disabled={locked} className="ui-input" /></div>
        <Button variant="outline" disabled={locked || !date}>{pending === "times" ? "Loading…" : "Show times"}</Button>
      </form>
      {timesError && <p role="alert" className="mt-4 text-sm text-red-800">{timesError}</p>}
      {date !== availability.date ? <p className="ui-hint mt-5">Select Show times to load this date.</p> : <>
        <h3 className="mt-6 text-sm font-medium">{dateLabel(availability.date)}</h3>
        {availability.slots.length ? <div aria-label="Available times" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {availability.slots.map((slot) => <button key={slot.startsAt} type="button" disabled={locked} aria-pressed={selected?.startsAt === slot.startsAt} onClick={() => choose(slot)} className="min-h-11 rounded-lg border bg-card px-3 py-3 text-sm transition-colors hover:border-primary hover:bg-available focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-available aria-pressed:text-primary">{slot.label}</button>)}
        </div> : <p role="status" className="ui-hint mt-4 rounded-lg bg-muted p-4">{availability.closed ? "The clinic is closed on this date. Please choose another day." : "No times available for this date. Please choose another day."}</p>}
      </>}
    </section>
    {selected && visit && <section className="ui-panel max-w-2xl" aria-labelledby="booking-details-title">
      <h2 id="booking-details-title" ref={stageHeading} tabIndex={-1} className="text-lg font-semibold">Your details</h2>
      <div className="my-5 rounded-lg bg-muted p-4 text-sm"><p className="font-medium">{visit.date}</p><p className="mt-2">{visit.time}</p><p className="mt-1 text-xs text-muted-foreground">{availability.timezone}</p></div>
      <form onSubmit={review} noValidate className="space-y-5">
        <div><label htmlFor="booking-name" className="text-sm font-medium">Full name</label><input id="booking-name" name="name" autoComplete="name" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={locked} className="ui-input" /></div>
        <div><label htmlFor="booking-email" className="text-sm font-medium">Verified email</label><input id="booking-email" type="email" value={email} readOnly className="ui-input bg-muted" /><p className="ui-hint mt-2 text-xs">This is the email you signed in with.</p></div>
        <div><label htmlFor="booking-phone" className="text-sm font-medium">Phone number</label><input id="booking-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} disabled={locked} className="ui-input" /></div>
        <Button type="submit" disabled={locked} className="w-full">Review booking</Button>
      </form>
      <p className="mt-6 flex items-start gap-2 border-t pt-5 text-xs leading-relaxed text-muted-foreground"><ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />Your details are used for this appointment. Choosing a time does not reserve it.</p>
    </section>}
    <BookingReview open={step === "review" && !!selected} locked={locked} pending={pending === "confirm"} uncertain={uncertain} signInRequired={signInRequired}
      visit={visit} timezone={availability.timezone} name={name} email={email} phone={phone} error={error}
      onEdit={() => { if (!locked) { setStep("details"); setError(""); } }} onConfirm={() => void confirm()} />
  </div>;
}
