"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarEvent, CalendarMode, CalendarView } from "@/modules/scheduling/calendar-model";
import { displayDate, eventStyles, TimeGrid } from "./time-grid";
import { EventDetails } from "./event-details";

function moveDate(date: string, days: number) {
  const next = new Date(`${date}T12:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().split("T")[0];
}

export function DoctorCalendar({ initial }: { initial: CalendarView }) {
  const router = useRouter();
  const [calendar, setCalendar] = useState(initial);
  const [date, setDate] = useState(initial.date);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const allEvents = calendar.days.flatMap((day) => day.events);
  const count = (kind: CalendarEvent["kind"]) => new Set(allEvents.filter((event) => event.kind === kind).map((event) => event.id)).size;
  const period = calendar.mode === "day" ? displayDate(calendar.date, { dateStyle: "full" })
    : `${displayDate(calendar.startDate, { month: "short", day: "numeric" })} – ${displayDate(calendar.endDate, { month: "short", day: "numeric", year: "numeric" })}`;

  async function load(value: string | undefined, mode: CalendarMode) {
    if (pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      const params = new URLSearchParams({ view: mode });
      if (value) params.set("date", value);
      const response = await fetch(`/api/admin/calendar?${params}`, { credentials: "same-origin", cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.calendar) throw new Error(result?.error ?? "Calendar is temporarily unavailable. Please try again.");
      const next = result.calendar as CalendarView;
      setCalendar(next); setDate(next.date); setSelected(null); setNotice("Calendar updated.");
      router.replace(`/admin/calendar?date=${next.date}&view=${next.mode}`, { scroll: false });
    } catch (failure) {
      setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Unable to connect. Please try again.");
    } finally { setPending(false); }
  }
  function showDate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(date, calendar.mode); }

  return <div className="space-y-4" aria-busy={pending}>
    <div className="overflow-hidden rounded-xl border bg-card">
      <form onSubmit={showDate} className="border-b p-3 sm:p-4">
        <fieldset disabled={pending} aria-label="Calendar navigation" className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border"><Button type="button" size="sm" variant="outline" className="border-0 !bg-transparent px-2 shadow-none" aria-label={`Previous ${calendar.mode}`} onClick={() => void load(moveDate(calendar.date, calendar.mode === "week" ? -7 : -1), calendar.mode)}><ChevronLeft aria-hidden="true" /></Button><Button type="button" size="sm" variant="outline" className="border-0 !bg-transparent px-2 shadow-none" aria-label={`Next ${calendar.mode}`} onClick={() => void load(moveDate(calendar.date, calendar.mode === "week" ? 7 : 1), calendar.mode)}><ChevronRight aria-hidden="true" /></Button></div>
          <Button type="button" size="sm" variant="outline" onClick={() => void load(undefined, calendar.mode)}>Today</Button>
          <h2 className="order-first w-full min-w-0 px-1 text-sm font-semibold sm:order-none sm:w-auto sm:min-w-52 sm:flex-1">{period}</h2>
          <div className="order-3 flex w-full min-w-0 items-center gap-2 sm:order-none sm:max-w-72 sm:flex-1"><label htmlFor="calendar-date" className="sr-only">Calendar date</label><input id="calendar-date" type="date" value={date} min="0001-01-01" max="9999-12-31" required onChange={(event) => setDate(event.target.value)} className="ui-input !mt-0 !h-8 flex-1 !text-xs" /><Button type="submit" size="sm" variant="outline">Show date</Button></div>
          <div className="ml-auto inline-flex gap-1 rounded-lg bg-muted p-1">{(["day", "week"] as const).map((mode) => <button key={mode} type="button" aria-pressed={calendar.mode === mode} onClick={() => void load(calendar.date, mode)} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${calendar.mode === mode ? "bg-card text-foreground shadow-[0_1px_3px_#183b3710]" : "text-muted-foreground hover:text-foreground"}`}>{mode === "day" ? "Day" : "Week"}</button>)}</div>
          <Button type="button" size="sm" variant="outline" className="px-2" aria-label="Refresh" onClick={() => void load(calendar.date, calendar.mode)}><RefreshCw aria-hidden="true" className={pending ? "opacity-40" : ""} /></Button>
        </fieldset>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><ul aria-label="Calendar legend" className="flex flex-wrap items-center gap-4 text-xs">{(Object.keys(eventStyles) as CalendarEvent["kind"][]).map((kind) => <li key={kind} className="flex items-center gap-1.5"><span aria-hidden="true" className={`size-1.5 rounded-full ${eventStyles[kind].dot}`} /><span className="text-muted-foreground">{eventStyles[kind].label}</span> <span className="font-semibold tabular-nums">{count(kind)}</span></li>)}<li className="flex items-center gap-1.5 text-muted-foreground"><span aria-hidden="true" className="calendar-closed size-2.5 rounded-sm border" />Outside hours</li></ul><span className="text-[10px] text-muted-foreground">Clinic timezone: {calendar.timezone}</span></div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="sr-only">{notice}</p>}
    {calendar.mode === "week" && <p className="text-[11px] text-muted-foreground md:hidden">Swipe the grid to see every day, or switch to Day for a closer look.</p>}
    {!calendar.configured ? <p className="ui-panel">Clinic settings are unavailable. <a href="/admin/settings" className="text-primary underline">Open clinic settings</a>.</p> : <TimeGrid calendar={calendar} pending={pending} onDay={(day) => void load(day, "day")} onSelect={setSelected} />}
    <EventDetails event={selected} timezone={calendar.timezone} onClose={() => setSelected(null)} />
  </div>;
}
