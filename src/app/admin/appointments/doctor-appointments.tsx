"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DoctorAppointmentsView } from "@/modules/booking/doctor-models";
import { DoctorCancellation } from "./doctor-cancellation";

const statuses = { confirmed: "Confirmed", cancelled: "Cancelled", completed: "Completed", no_show: "Not attended" };

export function DoctorAppointments({ initial }: { initial: DoctorAppointmentsView }) {
  const router = useRouter(), [refreshing, startTransition] = useTransition();
  const time = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: initial.timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
  const date = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: initial.timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
  return <div className="max-w-5xl space-y-5">
    <div className="ui-panel flex flex-wrap items-end justify-between gap-4">
      <form method="get" className="flex flex-wrap items-end gap-3"><label className="block text-sm font-medium">Appointment date<input name="date" aria-label="Appointment date" type="date" required defaultValue={initial.date} key={initial.date} min="0001-01-01" max="9999-12-31" className="ui-input mt-2 block" /></label><Button type="submit">Show appointments</Button></form>
      <Button type="button" variant="outline" onClick={() => startTransition(() => router.refresh())} disabled={refreshing}><RefreshCw aria-hidden="true" className="size-4" />{refreshing ? "Refreshing…" : "Refresh appointments"}</Button>
      <p className="w-full text-xs text-muted-foreground">Clinic timezone: {initial.timezone}. Cancelled visits stay in this list on their original appointment date.</p>
    </div>
    {!initial.appointments.length ? <p className="ui-panel ui-hint">No appointments for this date.</p> : <ul aria-label="Clinic appointments" className="space-y-3">{initial.appointments.map((appointment) => <li key={appointment.id} className="ui-panel space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{appointment.contact.name}</h2><p className="mt-2 text-sm tabular-nums">{time(appointment.startsAt)} – {time(appointment.endsAt)}</p><p className="mt-2 break-all text-sm text-muted-foreground">{appointment.contact.email}</p><p className="mt-1 text-sm text-muted-foreground">{appointment.contact.phone}</p></div><div className="flex flex-wrap items-center gap-3"><span className={`rounded-md px-2.5 py-1 text-xs font-medium ${appointment.status === "confirmed" ? "bg-available text-primary" : "bg-muted text-muted-foreground"}`}>{appointment.patientCancellationLate === true ? "Late cancellation" : statuses[appointment.status]}</span>{appointment.canCancel && <DoctorCancellation id={appointment.id} name={appointment.contact.name} date={date(appointment.startsAt)} time={`${time(appointment.startsAt)} – ${time(appointment.endsAt)}`} timezone={initial.timezone} />}</div></div>
      {appointment.cancellation && <div className="space-y-2 border-t pt-4 text-sm"><p className="break-words"><span className="font-medium">Cancellation reason:</span> {appointment.cancellation.reason}</p>{appointment.cancellation.rebookingInstruction && <p className="break-words"><span className="font-medium">Rebooking instruction:</span> {appointment.cancellation.rebookingInstruction}</p>}<p className="ui-hint">{appointment.cancellation.originalTimeBlocked ? "The original buffered time was blocked when cancelled." : "The original time was released when cancelled."} Automatic patient notices are not enabled.</p></div>}
    </li>)}</ul>}
  </div>;
}
