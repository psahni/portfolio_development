"use client";

import { CalendarCheck2, Coffee } from "lucide-react";
import type { CalendarEvent, CalendarView } from "@/modules/scheduling/calendar-model";
import { HOUR_HEIGHT, availablePositions, calendarDayBounds, calendarScale, clockOffset, eventPosition, gridTimeLabel, openingPositions } from "./calendar-layout";

export const eventStyles = {
  available: { label: "Available", classes: "border-primary/15 bg-available/55 text-available-foreground", dot: "bg-primary" },
  appointment: { label: "Booked", classes: "border-booked-foreground/55 bg-booked text-booked-foreground", dot: "bg-booked-foreground" },
  block: { label: "Break", classes: "border-break-foreground/50 bg-break text-break-foreground", dot: "bg-break-foreground" },
};
export function displayDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00Z`));
}

export function TimeGrid({ calendar, pending, onDay, onSelect }: {
  calendar: CalendarView; pending: boolean; onDay: (date: string) => void; onSelect: (event: CalendarEvent) => void;
}) {
  const scale = calendarScale(calendar.days, calendar.timezone);
  const pixels = (minute: number) => (minute - scale.start) * HOUR_HEIGHT / 60;
  const columns = `${scale.hasClockChange ? 0 : 56}px repeat(${calendar.days.length}, minmax(0, 1fr))`;
  return <div>
    {scale.hasClockChange && <p className="mb-3 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">Clock-change week: each day shows its own local time labels. Repeated hours include their UTC offset.</p>}
    <div role="region" aria-label={calendar.mode === "week" ? "Week calendar" : "Day calendar"} tabIndex={0} className="max-h-[68vh] overflow-auto rounded-xl border bg-card focus-visible:outline-2 focus-visible:outline-ring">
      <div className={calendar.mode === "week" ? scale.hasClockChange ? "min-w-[1400px]" : "min-w-[840px]" : "min-w-0"}>
        <div className="sticky top-0 z-40 grid border-b bg-card" style={{ gridTemplateColumns: columns }}>
          <div className="sticky left-0 z-50 flex items-end justify-center overflow-hidden border-r bg-card pb-3 text-[9px] text-muted-foreground">{!scale.hasClockChange && "TIME"}</div>
          {calendar.days.map((day) => <div key={day.date} className={`min-w-0 border-r px-2 py-3 text-center last:border-r-0 ${day.date === calendar.today ? "bg-primary/[0.035]" : ""}`}>
            <button type="button" disabled={pending} aria-label={`Open ${displayDate(day.date, { dateStyle: "full" })}`} onClick={() => onDay(day.date)} className="inline-flex items-center justify-center gap-2 rounded-md text-xs">
              <span className="font-medium text-muted-foreground">{displayDate(day.date, { weekday: "short" })}</span><span className={`inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold ${day.date === calendar.today ? "bg-primary text-white" : "text-foreground"}`}>{displayDate(day.date, { day: "numeric" })}</span>
            </button>
            <p className="mt-1 text-[10px] text-muted-foreground">{day.hours.length ? `${day.events.filter((event) => event.kind === "available").length} available` : "Closed"}</p>
          </div>)}
        </div>
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div aria-hidden="true" className="sticky left-0 z-20 border-r bg-card" style={{ height: scale.height }}>
            {!scale.hasClockChange && scale.ticks.map((minute) => <span key={minute} className="absolute right-2 -translate-y-1/2 whitespace-nowrap bg-card text-[10px] text-muted-foreground" style={{ top: Math.min(scale.height - 8, Math.max(8, pixels(minute))) }}>{gridTimeLabel(calendar.days[0].date, calendar.timezone, minute)}</span>)}
          </div>
          {calendar.days.map((day) => {
            const bounds = calendarDayBounds(day.date, calendar.timezone);
            return <section key={day.date} aria-label={displayDate(day.date, { dateStyle: "full" })} className="calendar-closed relative min-w-0 border-r last:border-r-0" style={{ height: scale.height }}>
              {openingPositions(day, calendar.timezone).map((window, index) => <div key={index} aria-hidden="true" className="absolute inset-x-0 bg-white" style={{ top: pixels(window.start), height: (window.end - window.start) * HOUR_HEIGHT / 60 }} />)}
              {availablePositions(day, calendar.timezone).map((window, index) => <div key={index} aria-hidden="true" className="absolute inset-x-1 rounded-md border-l-2 border-primary/20 bg-available/50 sm:inset-x-1.5" style={{ left: scale.hasClockChange ? 68 : undefined, top: pixels(window.start), height: (window.end - window.start) * HOUR_HEIGHT / 60 }} />)}
              <div aria-hidden="true" className="calendar-hour-lines pointer-events-none absolute inset-0" />
              {scale.hasClockChange && scale.ticks.filter((minute) => minute < bounds.minutes).map((minute) => <span key={minute} aria-hidden="true" className="pointer-events-none absolute left-1 z-10 bg-card/90 text-[9px] text-muted-foreground" style={{ top: Math.max(0, pixels(minute)) }}>{gridTimeLabel(day.date, calendar.timezone, minute, bounds.minutes !== 1440)}</span>)}
              <ul aria-label={`Slots for ${day.date}`} className="absolute inset-0 list-none" style={{ left: scale.hasClockChange ? 64 : 0 }}>
                {day.events.map((event) => {
                  const position = eventPosition(event, day.date, calendar.timezone);
                  if (!position) return null;
                  const style = eventStyles[event.kind];
                  const offset = bounds.minutes !== 1440 ? ` (${clockOffset(event.startsAt, calendar.timezone)})` : "";
                  return <li key={event.id} data-kind={event.kind} className={`calendar-event ${style.classes} ${event.kind === "available" ? "!rounded-none !border-l-0 !bg-transparent hover:!bg-available/70" : ""}`} style={{ top: pixels(position.start), height: (position.end - position.start) * HOUR_HEIGHT / 60 }}>
                    <button type="button" disabled={pending} aria-label={`${style.label}: ${event.label}${offset}`} title={`${style.label}: ${event.label}${offset}`} onClick={() => onSelect(event)} className="flex h-full w-full min-w-0 items-center gap-1.5 overflow-hidden px-1.5 text-left focus-visible:outline-offset-[-2px] sm:px-2">
                      <span className="sr-only">{style.label}</span>{event.kind === "available" && <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-primary/40" />}{event.kind === "appointment" && <CalendarCheck2 aria-hidden="true" className="size-3 shrink-0" />}{event.kind === "block" && <Coffee aria-hidden="true" className="size-3 shrink-0" />}<time dateTime={event.startsAt} className={`truncate ${event.kind === "available" ? "text-[10px] text-muted-foreground" : "font-medium"}`}>{event.kind === "available" ? event.label.split(" – ")[0] : event.label}</time>{event.note && <span className="sr-only">{event.note}</span>}
                    </button>
                  </li>;
                })}
              </ul>
              {!day.events.length && <p className="absolute inset-x-2 top-5 rounded-md border border-border/70 bg-card/95 p-2 text-center text-[11px] leading-relaxed text-muted-foreground">{!day.hours.length ? "Clinic closed." : day.outsideWindow ? "Outside booking window" : "No available or occupied slots."}</p>}
            </section>;
          })}
        </div>
      </div>
    </div>
    <p className="mt-3 text-[11px] text-muted-foreground">All times in {calendar.timezone}. Booked times include preparation buffers. Viewing does not reserve a slot.</p>
  </div>;
}
