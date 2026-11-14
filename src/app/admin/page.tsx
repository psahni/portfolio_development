import Link from "next/link";
import { ArrowLeft, CalendarDays, Clock3, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { LoginForm } from "./login-form";

export default function AdminLogin() {
  return <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8">
    <header className="flex items-center justify-between gap-4"><Brand /><Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"><ArrowLeft aria-hidden="true" className="size-3.5" />Back to home</Link></header>
    <div className="grid flex-1 items-center gap-7 py-6 md:grid-cols-[1.1fr_1fr] md:gap-20 md:py-16">
      <section className="signin-info-panel relative rounded-xl p-5 sm:p-10 md:py-16">
        <div className="mb-8 hidden size-11 items-center justify-center rounded-xl border border-primary/10 bg-white text-primary md:flex"><CalendarDays aria-hidden="true" className="size-5" /></div>
        <p className="ui-eyebrow mb-4 hidden !text-primary md:block">Made for the way you care</p>
        <h1 className="text-3xl leading-[1.12] font-semibold tracking-[-0.055em] md:text-5xl">Your clinic.<br />A calmer day.</h1>
        <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground md:mt-5 md:leading-7">One thoughtful workspace for your clinic’s schedule.<span className="hidden md:inline"> More clarity for your team. More space for care.</span></p>
        <div className="mt-10 hidden space-y-4 border-t border-primary/10 pt-6 md:block">{[{ icon: Clock3, text: "A schedule that works around you" }, { icon: ShieldCheck, text: "A private workspace for your clinic" }].map(({ icon: Icon, text }) => <p key={text} className="flex items-center gap-3 text-xs text-primary"><Icon aria-hidden="true" className="size-4" />{text}</p>)}</div>
      </section>
      <section aria-labelledby="sign-in-heading" className="mx-auto w-full max-w-sm py-3">
        <p className="ui-eyebrow mb-3 hidden md:block">Welcome back</p><h2 id="sign-in-heading" className="text-[28px] font-semibold tracking-[-0.04em]">Clinic sign in</h2>
        <p className="mt-3 mb-7 text-sm leading-relaxed text-muted-foreground">Your clinic’s day, all in one place.</p>
        <LoginForm />
        <p className="mt-7 border-t pt-5 text-xs leading-relaxed text-muted-foreground">Access is limited to your doctor and approved clinic staff.</p>
      </section>
    </div>
    <footer className="border-t py-5 text-[11px] text-muted-foreground">Nuvortiq Smart Booking <span className="mx-2 text-border">/</span> Thoughtfully built for your clinic.</footer>
  </main>;
}
