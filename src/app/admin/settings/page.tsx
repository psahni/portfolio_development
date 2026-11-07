import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { getClinicService } from "@/modules/clinic/server";
import { emptyConfiguration, timezoneOptions } from "@/modules/clinic/configuration";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function ClinicSettingsPage() {
  const saved = await getClinicService().get(await headers()).catch((error: unknown) => {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") redirect("/admin");
    if (isAPIError(error) && error.status === "FORBIDDEN") redirect("/admin/workspace");
    throw error;
  });
  return <main className="mx-auto min-h-screen max-w-3xl px-5 py-8 sm:px-8">
    <Link href="/admin/workspace" className="rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">← Back to workspace</Link>
    <header className="pt-8 pb-7"><p className="mb-3 text-xs font-semibold tracking-[0.16em] text-primary uppercase">Your clinic</p><h1 className="text-3xl font-medium tracking-tight">Clinic settings</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Set up your clinic and weekly hours before accepting appointments.</p></header>
    <SettingsForm initial={saved ?? emptyConfiguration()} timezones={timezoneOptions(saved?.timezone)} />
  </main>;
}
