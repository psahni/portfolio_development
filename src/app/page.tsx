import { ArrowUpRight, CalendarDays, Heart, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 md:px-12">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b py-5">
        <Brand />
        <Button asChild variant="outline" size="sm"><Link href="/admin">Clinic sign in <ArrowUpRight aria-hidden="true" /></Link></Button>
      </header>
      <section className="max-w-4xl py-20 md:py-28">
        <p className="ui-eyebrow mb-6 !text-primary">A little less waiting. A little more care.</p>
        <h1 className="text-4xl leading-[1.08] font-semibold tracking-[-0.055em] sm:text-6xl md:text-7xl">Care starts with<br /><span className="text-primary">a simpler appointment.</span></h1>
        <p className="mt-7 max-w-xl text-base leading-8 text-muted-foreground">We’re preparing a simpler way to connect with your clinic. Online booking is coming soon. Clinic staff can sign in to their workspace.</p>
        <Button asChild className="mt-8"><a href="#what-to-expect">What to expect <ArrowUpRight aria-hidden="true" /></a></Button>
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
