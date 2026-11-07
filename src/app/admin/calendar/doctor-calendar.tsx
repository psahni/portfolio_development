"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { CalendarEvent, CalendarMode, CalendarView } from "@/modules/scheduling/calendar-model";
import { clockLabel } from "@/modules/scheduling/models";

const eventStyles = {
  available: { label: "Available", classes: "border-emerald-200 bg-emerald-50 text-emerald-950", dot: "bg-emerald-600" },
  appointment: { label: "Booked", classes: "border-rose-200 bg-rose-50 text-rose-950", dot: "bg-rose-600" },
  block: { label: "Break", classes: "border-amber-200 bg-amber-50 text-amber-950", dot: "bg-amber-600" },
};

function dateLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00Z`));
}
function moveDate(date: string, days: number) {
  const next = new Date(`${date}T12:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().split("T")[0];
}
function CalendarCard({ event }: { event: CalendarEvent }) {
  const style = eventStyles[event.kind];
  return <li data-kind={event.kind} className={`min-w-0 rounded-lg border border-l-4 p-3 ${style.classes}`}>
    <p className="text-xs font-semibold">{style.label}</p>
    <p className="mt-1 break-words text-sm font-medium"><time dateTime={event.startsAt}>{event.label}</time></p>
    {event.note && <p className="mt-2 break-words text-xs">{event.note}</p>}
    {event.continuesFromPreviousDay && <p className="mt-2 text-xs">Continues from previous day</p>}
    {event.continuesToNextDay && <p className="mt-2 text-xs">Continues into next day</p>}
  </li>;
}

export function DoctorCalendar({ initial }: { initial: CalendarView }) {
  const router = useRouter();
  const [calendar, setCalendar] = useState(initial);
  const [date, setDate] = useState(initial.date);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const allEvents = calendar.days.flatMap((day) => day.events);
  const counts = (kind: CalendarEvent["kind"]) => new Set(allEvents.filter((event) => event.kind === kind).map((event) => event.id)).size;
  const period = calendar.mode === "day"
    ? dateLabel(calendar.date, { dateStyle: "full" })
    : `${dateLabel(calendar.startDate, { month: "short", day: "numeric", year: "numeric" })} – ${dateLabel(calendar.endDate, { month: "short", day: "numeric", year: "numeric" })}`;

  async function load(selected: string | undefined, mode: CalendarMode) {
    if (pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      const params = new URLSearchParams({ view: mode });
      if (selected) params.set("date", selected);
      const response = await fetch(`/api/admin/calendar?${params}`, { credentials: "same-origin", cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.calendar) throw new Error(result?.error ?? "Calendar is temporarily unavailable. Please try again.");
      const next = result.calendar as CalendarView;
      setCalendar(next); setDate(next.date); setNotice("Calendar updated.");
      router.replace(`/admin/calendar?date=${next.date}&view=${next.mode}`, { scroll: false });
    } catch (failure) {
      setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Unable to connect. Please try again.");
    } finally { setPending(false); }
  }
  function showDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); void load(date, calendar.mode);
  }

  return <div className="space-y-5" aria-busy={pending}>
    <form onSubmit={showDate} className="rounded-2xl border bg-card p-5">
      <fieldset disabled={pending} className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 flex-none sm:w-auto sm:max-w-64 sm:flex-1"><label htmlFor="calendar-date" className="text-sm font-medium">Calendar date</label><input id="calendar-date" type="date" value={date} min="0001-01-01" max="9999-12-31" required onChange={(event) => setDate(event.target.value)} className="mt-2 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base focus-visible:ring-2 focus-visible:ring-ring" /></div>
        <Button type="submit">Show date</Button>
        <Button type="button" variant="outline" onClick={() => void load(undefined, calendar.mode)}>Today</Button>
        <Button type="button" variant="outline" onClick={() => void load(calendar.date, calendar.mode)}>Refresh</Button>
      </fieldset>
    </form>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="sr-only">{notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0"><h2 className="break-words text-xl font-semibold">{period}</h2><p className="mt-2 break-words text-sm text-muted-foreground">Clinic timezone: {calendar.timezone}</p></div>
      <fieldset disabled={pending} className="flex flex-wrap gap-2" aria-label="Calendar navigation">
        <Button type="button" size="sm" variant="outline" aria-label={`Previous ${calendar.mode}`} onClick={() => void load(moveDate(calendar.date, calendar.mode === "week" ? -7 : -1), calendar.mode)}>← Previous</Button>
        <Button type="button" size="sm" variant="outline" aria-label={`Next ${calendar.mode}`} onClick={() => void load(moveDate(calendar.date, calendar.mode === "week" ? 7 : 1), calendar.mode)}>Next →</Button>
        {(["day", "week"] as const).map((mode) => <Button key={mode} type="button" size="sm" variant={calendar.mode === mode ? "default" : "outline"} aria-pressed={calendar.mode === mode} onClick={() => void load(calendar.date, mode)}>{mode === "day" ? "Day" : "Week"}</Button>)}
      </fieldset>
    </div>
    <ul aria-label="Calendar legend" className="flex flex-wrap gap-4 text-sm">
      {(Object.keys(eventStyles) as CalendarEvent["kind"][]).map((kind) => <li key={kind} className="flex items-center gap-2"><span aria-hidden="true" className={`h-3 w-3 rounded-full ${eventStyles[kind].dot}`} />{eventStyles[kind].label} <span className="font-medium">{counts(kind)}</span></li>)}
    </ul>
    <p className="text-sm text-muted-foreground">Available slots follow booking limits. Booked times include preparation buffers. Viewing the calendar does not reserve a slot.</p>
    {!calendar.configured ? <p className="rounded-lg border p-4">Clinic settings are unavailable. <a href="/admin/settings" className="text-primary underline">Open clinic settings</a>.</p> : <div role="region" aria-label={calendar.mode === "week" ? "Week calendar" : "Day calendar"} tabIndex={0} className="max-h-[70vh] overflow-auto rounded-2xl border bg-card focus-visible:outline-2 focus-visible:outline-ring">
      <div className={`grid items-start ${calendar.mode === "week" ? "min-w-[70rem] grid-cols-7 divide-x" : "grid-cols-1"}`}>
        {calendar.days.map((day) => {
          const fullDate = dateLabel(day.date, { dateStyle: "full" });
          return <section key={day.date} aria-label={fullDate} className="min-w-0 self-stretch">
            <header className="sticky top-0 z-10 border-b bg-card p-3">
              <button type="button" disabled={pending} aria-label={`Open ${fullDate}`} onClick={() => void load(day.date, "day")} className="rounded text-left text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-ring"><span className="block">{dateLabel(day.date, { weekday: "long" })}</span><span className="mt-1 block">{dateLabel(day.date, { month: "short", day: "numeric" })}{day.date === calendar.today ? " · Today" : ""}</span></button>
              <p className="mt-2 text-xs text-muted-foreground">{day.hours.length ? day.hours.map((hours) => `${clockLabel(hours.start)} – ${clockLabel(hours.end)}`).join(" · ") : "Closed"}</p>
            </header>
            <ul aria-label={`Slots for ${day.date}`} className={`space-y-2 p-2 ${calendar.mode === "day" ? "mx-auto max-w-2xl" : ""}`}>
              {day.events.map((event) => <CalendarCard key={event.id} event={event} />)}
            </ul>
            {!day.events.length && <p className="px-3 pb-5 text-sm text-muted-foreground">{!day.hours.length ? "Clinic closed." : day.outsideWindow ? "No booked times. Outside the booking window." : "No available or occupied slots."}</p>}
          </section>;
        })}
      </div>
    </div>}
  </div>;
}
