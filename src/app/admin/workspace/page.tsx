import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { getIdentity } from "@/modules/identity/server";
import { SignOutButton } from "../sign-out-button";

export const dynamic = "force-dynamic";

export default async function Workspace() {
  const principal = await getIdentity().access.requireClinicAccess(await headers()).catch((error: unknown) => {
    if (isAPIError(error) && (error.status === "UNAUTHORIZED" || error.status === "FORBIDDEN")) redirect("/admin");
    throw error;
  });
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-8 md:px-12">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <span className="font-semibold tracking-tight">nuvortiq <span className="ml-2 text-xs font-normal text-muted-foreground">SMART BOOKING</span></span>
        <SignOutButton />
      </header>
      <section className="py-16">
        <p className="mb-4 text-sm font-medium text-primary">{principal.role === "admin" ? "Doctor / Admin" : "Staff"}</p>
        <h1 className="text-3xl font-medium tracking-tight md:text-4xl">Clinic workspace</h1>
        <p className="mt-5 max-w-xl leading-relaxed text-muted-foreground">You’re signed in. Appointment and staff management will be added in the next tasks.</p>
      </section>
    </main>
  );
}
