"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { AvailabilityView } from "@/modules/scheduling/service";
import { breakSchema, clockLabel, overrideSchema, type ConflictTime, type TimeInterval } from "@/modules/scheduling/models";

const inputClass = "ui-input";
const cardClass = "ui-panel";
function seedIntervals(view: AvailabilityView): TimeInterval[] {
  const source = view.override?.mode === "custom" ? view.override.intervals : view.weeklyHours;
  return source.length ? source.map((entry) => ({ ...entry })) : [{ start: "09:00", end: "17:00" }];
}

function sameIntervals(current: TimeInterval[], saved: TimeInterval[]) {
  return current.length === saved.length && current.every((entry, index) => entry.start === saved[index].start && entry.end === saved[index].end);
}

export function AvailabilityEditor({ initial }: { initial: AvailabilityView }) {
  const router = useRouter();
  const [view, setView] = useState(initial), [date, setDate] = useState(initial.date);
  const [mode, setMode] = useState<"weekly" | "closed" | "custom">(initial.override?.mode ?? "weekly");
  const [intervals, setIntervals] = useState(seedIntervals(initial));
  const [reason, setReason] = useState(initial.override?.reason ?? "");
  const [breakStart, setBreakStart] = useState("12:00"), [breakEnd, setBreakEnd] = useState("13:00"), [breakReason, setBreakReason] = useState("");
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [conflicts, setConflicts] = useState<ConflictTime[]>([]);
  const mustLoad = date !== view.date;
  const savedMode = view.override?.mode ?? "weekly";
  const hasScheduleChanges = mode !== savedMode
    || (mode !== "weekly" && reason.trim() !== (view.override?.reason ?? ""))
    || (mode === "custom" && !sameIntervals(intervals, view.override?.intervals ?? []));
  const breakMessage = mustLoad ? "Choose Show day before managing breaks for this date."
    : hasScheduleChanges ? "Apply your schedule changes before managing one-off breaks."
    : !view.effectiveHours.length ? "The clinic is closed on this date, so one-off breaks do not apply. Saved breaks are kept and will return when the day reopens."
    : null;
  const title = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${view.date}T12:00Z`));

  async function request(method: string, body?: object, targetDate = view.date) {
    const response = await fetch(`/api/admin/availability?date=${encodeURIComponent(targetDate)}`, {
      method, credentials: "same-origin", cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      setConflicts(result?.conflicts ?? []);
      throw new Error(result?.error ?? "Availability is temporarily unavailable. Please try again.");
    }
    return result;
  }

  async function refresh(targetDate: string) {
    const result = await request("GET", undefined, targetDate);
    if (!result.availability) throw new Error("Availability is temporarily unavailable. Please try again.");
    const next = result.availability as AvailabilityView;
    setView(next); setDate(next.date); setMode(next.override?.mode ?? "weekly"); setReason(next.override?.reason ?? ""); setIntervals(seedIntervals(next));
    router.replace(`/admin/availability?date=${next.date}`, { scroll: false });
  }

  async function perform(action: () => Promise<void>, message: string) {
    if (pending) return;
    setPending(true); setError(""); setNotice(""); setConflicts([]);
    try { await action(); setNotice(message); }
    catch (failure) { setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Unable to connect. Please try again."); }
    finally { setPending(false); }
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || mustLoad || !hasScheduleChanges) return;
    setConflicts([]); setNotice("");
    const parsed = overrideSchema.safeParse({ date: view.date, mode, intervals: mode === "custom" ? intervals : [], reason });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    void perform(async () => { await request("PUT", parsed.data); await refresh(view.date); }, mode === "weekly" ? "Weekly hours restored. Existing breaks remain blocked." : "Day schedule saved.");
  }

  function addBreak(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || breakMessage) return;
    setConflicts([]); setNotice("");
    const parsed = breakSchema.safeParse({ date: view.date, start: breakStart, end: breakEnd, reason: breakReason });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    void perform(async () => { await request("POST", parsed.data); await refresh(view.date); setBreakReason(""); }, "Break added.");
  }

  return <div className="space-y-6" aria-busy={pending}>
    <form onSubmit={(event) => { event.preventDefault(); void perform(() => refresh(date), "Day loaded."); }} className={cardClass}>
      <fieldset disabled={pending} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1"><label htmlFor="availability-date" className="text-sm font-medium">Choose date</label><input id="availability-date" type="date" value={date} min={view.today} max={view.maxOverrideDate} required onChange={(event) => { setDate(event.target.value); setNotice(""); setError(""); setConflicts([]); }} className={inputClass} /></div>
        <Button type="submit">Show day</Button>
      </fieldset>
      <p className="mt-3 break-words text-sm text-muted-foreground">Clinic timezone: {view.timezone}. Holidays and special hours affect only the selected date.</p>
    </form>
    {mustLoad && <p className="rounded-lg border bg-muted p-3 text-sm">Choose Show day before changing this date’s schedule.</p>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{error}</p>{conflicts.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{conflicts.map((item) => <li key={item.startsAt}>{item.kind === "appointment" ? "Booked appointment" : "Blocked time"}: {new Intl.DateTimeFormat("en-US", { timeZone: view.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(item.startsAt))} – {new Intl.DateTimeFormat("en-US", { timeZone: view.timezone, timeStyle: "short" }).format(new Date(item.endsAt))}</li>)}</ul>}</div>}
    {notice && <p role="status" className="rounded-lg border bg-muted p-3 text-sm text-primary">{notice}</p>}
    <section className={cardClass} aria-labelledby="current-day">
      <h2 id="current-day" className="text-sm font-semibold">{title}</h2>
      <p className="mt-2 font-medium text-primary">{view.override?.mode === "closed" ? "Holiday / Closed" : view.override?.mode === "custom" ? "Special hours" : "Regular weekly hours"}</p>
      <p className="mt-2 text-sm text-muted-foreground">{view.effectiveHours.length ? view.effectiveHours.map((entry) => `${clockLabel(entry.start)} – ${clockLabel(entry.end)}`).join(" · ") : "Clinic closed for this date."}</p>
      {view.override?.reason && <p className="mt-2 break-words text-sm text-muted-foreground">Note: {view.override.reason}</p>}
    </section>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <form onSubmit={apply} className={cardClass} noValidate>
        <h2 className="text-sm font-semibold">Day override</h2><p className="mt-2 mb-5 text-sm text-muted-foreground">Replace this day’s weekly hours, or restore the normal schedule.</p>
        <fieldset disabled={pending || mustLoad} className="space-y-4">
          <div><label htmlFor="day-mode" className="text-sm font-medium">Schedule for this day</label><select id="day-mode" value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setNotice(""); setError(""); }} className={inputClass}><option value="weekly">Use weekly hours</option><option value="closed">Holiday / Closed</option><option value="custom">Special hours</option></select></div>
          {mode === "custom" && <div className="space-y-4">{intervals.map((entry, index) => <div key={index} className="grid grid-cols-2 gap-3">
            {(["start", "end"] as const).map((key) => <div key={key}><label htmlFor={`special-${key}-${index}`} className="text-sm">{key === "start" ? "Opens" : "Closes"}</label><input id={`special-${key}-${index}`} aria-label={`Special ${key === "start" ? "opening" : "closing"} time ${index + 1}`} type="time" value={entry[key]} onChange={(event) => setIntervals(intervals.map((value, i) => i === index ? { ...value, [key]: event.target.value } : value))} className={inputClass} /></div>)}
            <Button type="button" size="sm" variant="outline" className="col-span-2 w-fit" aria-label={`Remove special interval ${index + 1}`} onClick={() => setIntervals(intervals.filter((_, i) => i !== index))}>Remove</Button>
          </div>)}<Button type="button" variant="outline" size="sm" disabled={intervals.length >= 8} onClick={() => setIntervals([...intervals, { start: "09:00", end: "17:00" }])}>Add special hours</Button></div>}
          {mode !== "weekly" && <div><label htmlFor="override-note" className="text-sm font-medium">Schedule note (optional)</label><input id="override-note" value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} className={inputClass} /></div>}
          <Button type="submit" disabled={!hasScheduleChanges}>Apply schedule</Button>
        </fieldset>
      </form>
      <section className={cardClass} aria-labelledby="one-off-breaks">
        <h2 id="one-off-breaks" className="text-sm font-semibold">One-off breaks</h2>
        {breakMessage ? <p className="mt-3 text-sm text-muted-foreground">{breakMessage}</p> : <>
        <p className="mt-2 mb-5 text-sm text-muted-foreground">Add each break using Add break, then repeat for more breaks on this day. Each stays blocked until removed, even after restoring weekly hours.</p>
        <form onSubmit={addBreak} noValidate><fieldset disabled={pending || mustLoad} className="space-y-4">
          <div className="grid grid-cols-2 gap-3"><div><label htmlFor="break-start" className="text-sm font-medium">Break starts</label><input id="break-start" type="time" value={breakStart} onChange={(event) => setBreakStart(event.target.value)} className={inputClass} /></div><div><label htmlFor="break-end" className="text-sm font-medium">Break ends</label><input id="break-end" type="time" value={breakEnd} onChange={(event) => setBreakEnd(event.target.value)} className={inputClass} /></div></div>
          <div><label htmlFor="break-note" className="text-sm font-medium">Break note (optional)</label><input id="break-note" maxLength={160} value={breakReason} onChange={(event) => setBreakReason(event.target.value)} className={inputClass} /></div><Button type="submit" variant="outline">Add break</Button>
        </fieldset></form>
        <ul aria-label="Saved breaks" className="mt-5 space-y-3">{view.blocks.map((block) => <li key={block.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{block.label}</p>{block.reason && <p className="mt-1 break-words text-sm text-muted-foreground">{block.reason}</p>}<Button className="mt-3" type="button" size="sm" variant="outline" disabled={pending || mustLoad} aria-label={`Remove break ${block.label}`} onClick={() => void perform(async () => { await request("DELETE", { date: view.date, id: block.id }); await refresh(view.date); }, "Break removed.")}>Remove break</Button></li>)}</ul>
        </>}
      </section>
    </div>
    <section className={cardClass} aria-labelledby="available-slots">
      <h2 id="available-slots" className="text-sm font-semibold">Available slots</h2><p className="mt-2 mb-4 text-sm text-muted-foreground">{view.slots.length} available times. Viewing times does not reserve an appointment.</p>
      {!view.slots.length && <p className="rounded-lg bg-muted p-4 text-sm">{view.outsideWindow ? "This date is outside the current booking window." : !view.effectiveHours.length ? "The clinic is closed on this date." : "No slots meet the opening hours, notice, buffers and blocked-time rules."}</p>}
      <ul aria-label="Available appointment slots" className="grid max-h-96 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">{view.slots.map((slot) => <li key={slot.startsAt} className="rounded-lg border px-3 py-3 text-center text-sm"><time dateTime={slot.startsAt}>{slot.label}</time></li>)}</ul>
    </section>
  </div>;
}
