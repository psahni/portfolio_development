import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { Brand } from "@/components/layout/brand";
import { getHostedBookingService } from "@/modules/booking/hosted-server";
import { cancellationPolicy } from "@/modules/booking/cancellation-policy";
import { BookingForm } from "./booking-form";

export const dynamic = "force-dynamic";

export default async function BookAppointment() {
  const initial = await getHostedBookingService().view(await headers()).catch((error: unknown) => {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") redirect("/login?next=/book");
    throw new Error("Available appointments are temporarily unavailable.");
  });
  return <div className="min-h-screen"><header className="border-b bg-card"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8"><Brand /><Link href="/appointments" className="text-sm font-medium text-primary hover:underline">My appointments</Link></div></header>
    <main className="mx-auto max-w-6xl px-5 py-9 sm:px-8 sm:py-12"><p className="ui-eyebrow mb-3">Your next visit</p><h1 className="ui-page-title">Book an appointment</h1><p className="ui-hint mt-3 max-w-xl">Choose a time, add your details and review your visit before confirming.</p><p className="ui-hint mt-3 max-w-2xl">One appointment per patient per clinic day. To choose another time, cancel your existing appointment first, then book again.</p><section aria-labelledby="cancellation-policy-title" className="mt-5 max-w-2xl"><h2 id="cancellation-policy-title" className="text-sm font-semibold">Cancellation policy</h2><p className="ui-hint mt-2">{cancellationPolicy}</p></section><BookingForm initial={initial} /></main></div>;
}
