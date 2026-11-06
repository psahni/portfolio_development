import { ArrowUpRight, CalendarDays, Heart, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 md:px-12">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b py-7">
        <Link href="/" aria-label="Nuvortiq Smart Booking home" className="flex items-center gap-3">
          <span className="rounded-xl bg-primary p-2.5 text-primary-foreground"><Heart aria-hidden="true" className="size-5" /></span>
          <span className="font-semibold tracking-tight">nuvortiq<span className="ml-2 hidden text-xs font-normal tracking-wide text-muted-foreground sm:inline">SMART BOOKING</span></span>
        </Link>
        <Button asChild variant="outline" size="sm"><Link href="/admin">Clinic sign in <ArrowUpRight aria-hidden="true" /></Link></Button>
      </header>
      <section className="max-w-3xl py-20 md:py-28">
        <p className="mb-5 text-xs font-semibold tracking-[0.18em] text-primary uppercase">A little less waiting. A little more care.</p>
        <h1 className="text-4xl leading-[1.12] font-medium tracking-tight sm:text-5xl md:text-7xl">Care starts with<br /><span className="text-primary">a simpler appointment.</span></h1>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">We’re preparing a simpler way to connect with your clinic. Online booking is coming soon. Clinic staff can sign in to their workspace.</p>
        <Button asChild variant="outline" className="mt-8"><a href="#what-to-expect">What to expect <ArrowUpRight aria-hidden="true" /></a></Button>
      </section>
      <section id="what-to-expect" aria-label="What to expect" className="mb-16 grid gap-4 scroll-mt-8 md:grid-cols-3">
        {[
          { icon: CalendarDays, title: "A time that works for you", text: "Browse the clinic’s available appointments and choose your preferred time." },
          { icon: ShieldCheck, title: "Your details, kept private", text: "A personal sign-in keeps your bookings separate from the clinic’s staff workspace." },
          { icon: Heart, title: "Stay connected to your care", text: "Receive appointment updates and guidance if your doctor needs to change plans." },
        ].map(({ icon: Icon, title, text }) => (
          <Card key={title}><CardHeader><Icon aria-hidden="true" className="mb-4 size-6 text-primary" /><CardTitle>{title}</CardTitle><CardDescription>{text}</CardDescription></CardHeader></Card>
        ))}
      </section>
      <footer className="mt-auto flex flex-wrap justify-between gap-3 border-t py-6 text-xs text-muted-foreground"><span>Nuvortiq Smart Booking</span><span>Thoughtfully built for your clinic.</span></footer>
    </main>
  );
}
