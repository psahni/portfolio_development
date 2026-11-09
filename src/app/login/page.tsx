import Link from "next/link";
import { ArrowLeft, CalendarDays, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { PatientLoginForm } from "./patient-login-form";

export default function PatientLogin() {
  return <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8">
    <header className="flex items-center justify-between gap-4"><Brand /><Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden="true" className="size-3.5" />Back to home</Link></header>
    <div className="grid flex-1 items-center gap-7 py-6 md:grid-cols-[1.1fr_1fr] md:gap-20 md:py-16">
      <section className="rounded-xl bg-[#eef5f2] p-5 sm:p-10 md:py-16">
        <div className="mb-8 hidden size-11 items-center justify-center rounded-xl border border-primary/10 bg-white text-primary md:flex"><CalendarDays aria-hidden="true" className="size-5" /></div>
        <p className="ui-eyebrow mb-4 hidden !text-primary md:block">Your care, a little simpler</p>
        <h1 className="text-3xl leading-[1.12] font-semibold tracking-[-0.055em] md:text-5xl">Your appointments.<br />In one place.</h1>
        <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground md:mt-5 md:leading-7">Sign in to see your appointment times and booking status.</p>
        <p className="mt-10 hidden items-center gap-3 border-t border-primary/10 pt-6 text-xs text-primary md:flex"><ShieldCheck aria-hidden="true" className="size-4" />Only your appointments, in your private account.</p>
      </section>
      <section aria-labelledby="patient-sign-in-heading" className="mx-auto w-full max-w-sm py-3">
        <p className="ui-eyebrow mb-3 hidden md:block">Welcome</p><h2 id="patient-sign-in-heading" className="text-[28px] font-semibold tracking-[-0.04em]">Patient sign in</h2>
        <p className="mt-3 mb-7 text-sm leading-relaxed text-muted-foreground">Use your email and a one-time code. No password to remember.</p>
        <PatientLoginForm />
        <p className="mt-7 border-t pt-5 text-xs leading-relaxed text-muted-foreground">Doctor or clinic staff? <Link href="/admin" className="font-medium text-primary underline-offset-4 hover:underline">Clinic sign in</Link></p>
      </section>
    </div>
    <footer className="border-t py-5 text-[11px] text-muted-foreground">Nuvortiq Smart Booking <span className="mx-2 text-border">/</span> Thoughtfully built for your care.</footer>
  </main>;
}
