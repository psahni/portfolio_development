"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { CalendarDays, Clock3, MapPin, X } from "lucide-react";
import type { CalendarEvent } from "@/modules/scheduling/calendar-model";
import { Button } from "@/components/ui/button";
import { eventStyles } from "./time-grid";

function keepFocusInPanel(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

export function EventDetails({ event, timezone, onClose }: { event: CalendarEvent | null; timezone: string; onClose: () => void }) {
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (event && !panel.current?.open) panel.current?.showModal();
    if (!event && panel.current?.open) panel.current?.close();
  }, [event]);
  const format = (value: string, date = false) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...(date ? { weekday: "long", month: "long", day: "numeric", year: "numeric" } as const : { hour: "numeric", minute: "2-digit", timeZoneName: "short" } as const) }).format(new Date(value));
  return <dialog ref={panel} onClose={onClose} onKeyDown={keepFocusInPanel} aria-labelledby="event-detail-title" className="calendar-detail fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-sm border-0 border-l bg-card p-0 text-foreground shadow-[-8px_0_32px_#183b370a]">
    {event && <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b p-5"><span className="ui-eyebrow">Schedule details</span><Button type="button" size="sm" variant="outline" aria-label="Close details" onClick={() => panel.current?.close()}><X aria-hidden="true" /></Button></header>
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-6">
        <span className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium ${eventStyles[event.kind].classes}`}><span className={`size-1.5 rounded-full ${eventStyles[event.kind].dot}`} />{eventStyles[event.kind].label}</span>
        <div><h2 id="event-detail-title" className="text-2xl font-semibold tracking-tight">{event.kind === "appointment" ? "Booked appointment" : event.kind === "block" ? "One-off break" : "Available appointment"}</h2><p className="ui-hint mt-3">{event.kind === "appointment" ? "Reserved time includes preparation buffers." : event.kind === "block" ? "This time is blocked from patient booking." : "An open time in your clinic’s schedule. A booking is confirmed only after it is saved."}</p></div>
        <dl className="space-y-5 border-t pt-6"><div className="flex gap-3"><CalendarDays aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" /><div><dt className="ui-eyebrow">Date</dt><dd className="mt-1.5 text-sm">{format(event.startsAt, true)}{format(event.startsAt, true) !== format(event.endsAt, true) && <> – {format(event.endsAt, true)}</>}</dd></div></div><div className="flex gap-3"><Clock3 aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" /><div><dt className="ui-eyebrow">Time</dt><dd className="mt-1.5 text-sm tabular-nums">{format(event.startsAt)} – {format(event.endsAt)}</dd></div></div><div className="flex gap-3"><MapPin aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" /><div><dt className="ui-eyebrow">Clinic timezone</dt><dd className="mt-1.5 break-words text-sm">{timezone}</dd></div></div></dl>
        {event.note && <div className="rounded-lg border bg-background p-4"><p className="ui-eyebrow mb-2">Note</p><p className="break-words text-sm leading-relaxed">{event.note}</p></div>}
        {(event.continuesFromPreviousDay || event.continuesToNextDay) && <p className="ui-hint">This reservation continues across calendar dates.</p>}
      </div>
      <footer className="border-t p-5"><Button asChild variant="outline" className="w-full"><Link href="/admin/availability">Manage availability</Link></Button></footer>
    </div>}
  </dialog>;
}
