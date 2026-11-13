import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { ClinicShell } from "@/components/layout/clinic-shell";
import { getIdentity } from "@/modules/identity/server";
import { getClinicBookingAvailability } from "@/modules/booking/clinic-booking-server";
import { SignOutButton } from "../sign-out-button";
import { ClinicBookingForm } from "./clinic-booking-form";

export const dynamic = "force-dynamic";

export default async function ClinicBookPage() {
  const requestHeaders = await headers();
  const { principal, initial } = await (async () => ({
    principal: await getIdentity().access.requireClinicAccess(requestHeaders),
    initial: await getClinicBookingAvailability().view(requestHeaders),
  }))().catch((error: unknown) => {
    if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN")) redirect("/admin");
    throw error;
  });
  return <ClinicShell active="booking" admin={principal.role === "admin"} title="Book an appointment" description="Choose a time and add the patient’s contact details. Review before confirming." actions={<SignOutButton />}>
    {initial.configured ? <ClinicBookingForm initial={initial} /> : <section className="ui-panel max-w-xl"><h2 className="text-lg font-semibold">Set up your clinic first</h2><p className="ui-hint mt-3">The doctor needs to save clinic settings and opening hours before booking.</p>{principal.role === "admin" && <Link href="/admin/settings" className="mt-4 inline-block text-primary underline">Clinic settings</Link>}</section>}
  </ClinicShell>;
}
