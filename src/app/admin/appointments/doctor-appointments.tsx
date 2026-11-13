"use client";

import Link from "next/link";
import { useSyncExternalStore, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppointmentTab, DoctorAppointmentsView } from "@/modules/booking/doctor-models";
import { DoctorCancellation } from "./doctor-cancellation";

const subscribeToHydration = () => () => {};
const statuses = { confirmed: "Confirmed", cancelled: "Cancelled", completed: "Completed", no_show: "Not attended" };

export function DoctorAppointments({ initial, selectedTab }: { initial: DoctorAppointmentsView; selectedTab: AppointmentTab }) {
  // Date submission performs a document navigation; enable client-only actions
  // after their handlers hydrate, matching the cancellation dialog control.
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const router = useRouter(), [refreshing, startTransition] = useTransition();
  const time = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: initial.timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
  const date = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: initial.timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
  const tabs: { id: AppointmentTab; label: string }[] = [{ id: "confirmed", label: "Confirmed" }, { id: "cancelled", label: "Cancelled" }];
  if (selectedTab === "history" || initial.appointments.some((appointment) => ["completed", "no_show"].includes(appointment.status))) tabs.push({ id: "history", label: "Other history" });
  const matches = (status: string, tab: AppointmentTab) => tab === "history" ? status === "completed" || status === "no_show" : status === tab;
  const visible = initial.appointments.filter((appointment) => matches(appointment.status, selectedTab));
  function switchTab(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("[role=tab]"));
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + links.length) % links.length;
    links[next]?.focus(); links[next]?.click();
  }
  return <div className="max-w-5xl space-y-5">
    <div className="ui-panel flex flex-wrap items-end justify-between gap-4">
      <form method="get" className="flex flex-wrap items-end gap-3"><input type="hidden" name="status" value={selectedTab} /><label className="block text-sm font-medium">Appointment date<input name="date" aria-label="Appointment date" type="date" required defaultValue={initial.date} key={initial.date} min="0001-01-01" max="9999-12-31" className="ui-input mt-2 block" /></label><Button type="submit">Show appointments</Button></form>
      <Button type="button" variant="outline" onClick={() => startTransition(() => router.refresh())} disabled={!hydrated || refreshing}><RefreshCw aria-hidden="true" className="size-4" />{refreshing ? "Refreshing…" : "Refresh appointments"}</Button>
      <p className="w-full text-xs text-muted-foreground">Clinic timezone: {initial.timezone}. Cancelled visits appear in the Cancelled tab on their original appointment date.</p>
    </div>
    <nav role="tablist" aria-busy={!hydrated} aria-label="Appointment status" onKeyDown={switchTab} className="flex flex-wrap gap-1 border-b pb-1">
      {tabs.map((tab) => <Link key={tab.id} id={`appointments-${tab.id}`} role="tab" aria-selected={selectedTab === tab.id} aria-controls="appointment-status-panel" tabIndex={selectedTab === tab.id ? 0 : -1}
        href={`/admin/appointments?${new URLSearchParams({ date: initial.date, status: tab.id })}`} scroll={false}
        className={`rounded-t-lg px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary ${selectedTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
        {tab.label} ({initial.appointments.filter((appointment) => matches(appointment.status, tab.id)).length})
      </Link>)}
    </nav>
    <section id="appointment-status-panel" role="tabpanel" aria-labelledby={`appointments-${selectedTab}`}>
    {!visible.length ? <p className="ui-panel ui-hint">{!initial.appointments.length ? "No appointments for this date." : `No ${selectedTab === "history" ? "completed or unattended" : selectedTab} appointments for this date.`}</p> : <ul aria-label="Clinic appointments" className="space-y-3">{visible.map((appointment) => <li key={appointment.id} className="ui-panel space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{appointment.contact.name}</h2><p className="mt-2 text-sm tabular-nums">{time(appointment.startsAt)} – {time(appointment.endsAt)}</p><p className="mt-2 break-all text-sm text-muted-foreground">{appointment.contact.email}</p><p className="mt-1 text-sm text-muted-foreground">{appointment.contact.phone}</p></div><div className="flex flex-wrap items-center gap-3"><span className={`rounded-md px-2.5 py-1 text-xs font-medium ${appointment.status === "confirmed" ? "bg-available text-primary" : "bg-muted text-muted-foreground"}`}>{appointment.patientCancellationLate === true ? "Late cancellation" : statuses[appointment.status]}</span>{appointment.canCancel && <DoctorCancellation id={appointment.id} name={appointment.contact.name} date={date(appointment.startsAt)} time={`${time(appointment.startsAt)} – ${time(appointment.endsAt)}`} timezone={initial.timezone} canManageDetails={appointment.canManageCancellationDetails} />}</div></div>
      {appointment.cancellation && <div className="space-y-2 border-t pt-4 text-sm"><p className="break-words"><span className="font-medium">Cancellation reason:</span> {appointment.cancellation.reason}</p>{appointment.cancellation.rebookingInstruction && <p className="break-words"><span className="font-medium">Rebooking instruction:</span> {appointment.cancellation.rebookingInstruction}</p>}<p className="ui-hint">{appointment.cancellation.originalTimeBlocked ? "The original buffered time was blocked when cancelled." : "The original time was released when cancelled."} Automatic patient notices are not enabled.</p></div>}
    </li>)}</ul>}
    </section>
  </div>;
}
