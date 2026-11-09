"use client";

import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";

export default function AppointmentsError({ reset }: { reset: () => void }) {
  return <main className="mx-auto min-h-screen max-w-3xl px-5 py-7"><Brand /><section className="ui-panel mt-12"><h1 className="ui-page-title">Unable to load your appointments</h1><p role="alert" className="ui-hint mt-3">Please try again. If your session has ended, sign in again.</p><div className="mt-6 flex flex-wrap gap-3"><Button onClick={reset}>Try again</Button><Button asChild variant="outline"><Link href="/login">Patient sign in</Link></Button></div></section></main>;
}
