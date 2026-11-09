import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { getClinicService } from "@/modules/clinic/server";
import { emptyConfiguration, timezoneOptions } from "@/modules/clinic/configuration";
import { SignOutButton } from "../sign-out-button";
import { ClinicShell } from "@/components/layout/clinic-shell";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function ClinicSettingsPage() {
  const saved = await getClinicService().get(await headers()).catch((error: unknown) => {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") redirect("/admin");
    if (isAPIError(error) && error.status === "FORBIDDEN") redirect("/admin/workspace");
    throw error;
  });
  return <ClinicShell actions={<SignOutButton />} active="settings" title="Clinic settings" description="Your clinic, your way. Set the details and rhythm of your working week.">
    <SettingsForm initial={saved ?? emptyConfiguration()} timezones={timezoneOptions(saved?.timezone)} />
  </ClinicShell>;
}
