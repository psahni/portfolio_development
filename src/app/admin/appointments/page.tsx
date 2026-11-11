import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { ClinicShell } from "@/components/layout/clinic-shell";
import { getDoctorAppointmentsService } from "@/modules/booking/doctor-server";
import { doctorDateSchema } from "@/modules/booking/doctor-models";
import { SchedulingError } from "@/modules/scheduling/models";
import { SignOutButton } from "../sign-out-button";
import { DoctorAppointments } from "./doctor-appointments";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const query = doctorDateSchema.safeParse((await searchParams).date);
  const requestHeaders = await headers(), service = getDoctorAppointmentsService();
  const { initial, dateError } = await service.view(requestHeaders, query.success ? query.data : undefined)
    .then((initial) => ({ initial, dateError: query.success ? "" : "Choose a valid calendar date. Showing today’s appointments." }))
    .catch(async (error: unknown) => {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") redirect("/admin");
    if (isAPIError(error) && error.status === "FORBIDDEN") redirect("/admin/workspace");
    if (error instanceof SchedulingError && error.statusCode === 400) {
      return { initial: await service.view(requestHeaders), dateError: `${error.message} Showing today’s appointments.` };
    }
    throw error;
  });
  return <ClinicShell active="appointments" title="Appointments" description="Review your clinic day and manage upcoming visits." actions={<SignOutButton />}>
    {dateError && <p role="alert" className="mb-4 text-sm text-red-800">{dateError}</p>}
    {initial.configured ? <DoctorAppointments initial={initial} /> : <section className="ui-panel"><h2 className="text-lg font-semibold">Set up your clinic first</h2><p className="ui-hint mt-2 mb-4">Choose a clinic timezone and weekly hours before reviewing appointments.</p><Link href="/admin/settings" className="font-medium text-primary underline">Clinic settings</Link></section>}
  </ClinicShell>;
}
