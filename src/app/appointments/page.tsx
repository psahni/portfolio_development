import { headers } from "next/headers";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { CalendarDays, Clock3, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { getPatientAppointmentsService } from "@/modules/booking/patient-server";
import type { PatientAppointment } from "@/modules/booking/patient-appointments";
import { PatientActions } from "./patient-actions";
import { CancelAppointment } from "./cancel-appointment";

export const dynamic = "force-dynamic";
const statuses = {
  confirmed: { label: "Confirmed", classes: "bg-available text-available-foreground" },
  cancelled: { label: "Cancelled", classes: "bg-booked text-booked-foreground" },
  completed: { label: "Completed", classes: "bg-muted text-foreground" },
  no_show: { label: "Not attended", classes: "bg-break text-break-foreground" },
};
function AppointmentCard({ appointment, canCancel = false }: { appointment: PatientAppointment; canCancel?: boolean }) {
  const { timezone } = appointment, status = statuses[appointment.status];
  const date = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(appointment.startsAt));
  const time = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
  return <li className="ui-panel flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-base font-semibold"><time dateTime={appointment.startsAt}>{date}</time></h3><p className="mt-3 flex items-center gap-2 text-sm"><Clock3 aria-hidden="true" className="size-4 text-muted-foreground" />{time(appointment.startsAt)} – {time(appointment.endsAt)}</p><p className="mt-2 text-xs text-muted-foreground">Timezone: {timezone}</p></div><div className="flex flex-wrap items-center gap-3"><span className={`rounded-md px-2.5 py-1 text-xs font-medium ${status.classes}`}>{status.label}</span>{canCancel && <CancelAppointment id={appointment.id} date={date} time={`${time(appointment.startsAt)} – ${time(appointment.endsAt)}`} timezone={timezone} />}</div></li>;
}
export default async function MyAppointments() {
  const { total, upcoming, history } = await getPatientAppointmentsService().view(await headers()).catch((error: unknown) => {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") redirect("/login");
    throw new Error("Your appointments are temporarily unavailable.");
  });
  return <div className="min-h-screen"><header className="border-b bg-card"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-4 sm:px-8"><Brand /><PatientActions /></div></header>
    <main className="mx-auto max-w-5xl px-5 py-9 sm:px-8 sm:py-12"><p className="ui-eyebrow mb-3">Your patient account</p><h1 className="ui-page-title">My appointments</h1><p className="ui-hint mt-3 max-w-xl">Your appointment times and booking status, in one place. Each appointment shows its local time and timezone.</p>
      <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3.5" />A private view of your appointments.</p>
      <Button asChild className="mt-5"><Link href="/book">Book an appointment</Link></Button>
      {!total ? <section className="ui-panel mt-8 flex max-w-2xl gap-4 py-8"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-available text-primary"><CalendarDays aria-hidden="true" className="size-5" /></div><div><h2 className="text-lg font-semibold">No appointments yet</h2><p className="ui-hint mt-2">If you’re expecting an appointment here, please contact your clinic.</p></div></section>
        : <div className="mt-9 space-y-9"><section aria-labelledby="upcoming-title"><h2 id="upcoming-title" className="mb-4 text-base font-semibold">Upcoming appointments <span className="ml-1 text-sm font-normal text-muted-foreground">({upcoming.length})</span></h2>{upcoming.length ? <ul aria-label="Upcoming appointments" className="space-y-3">{upcoming.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} canCancel={appointment.canCancel} />)}</ul> : <p className="ui-panel ui-hint">You have no upcoming appointments.</p>}</section>{history.length > 0 && <section aria-labelledby="history-title"><h2 id="history-title" className="mb-4 text-base font-semibold">Appointment history</h2><ul aria-label="Appointment history" className="space-y-3">{history.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} />)}</ul></section>}</div>}
    </main></div>;
}
