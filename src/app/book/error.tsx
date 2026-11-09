"use client";

import { Button } from "@/components/ui/button";

export default function BookingError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl px-5 py-16"><h1 className="ui-page-title">Appointments are unavailable</h1><p role="alert" className="ui-hint my-5">We couldn’t load the available times. Please try again.</p><Button onClick={reset}>Try again</Button></main>;
}
