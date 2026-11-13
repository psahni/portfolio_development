import Image from "next/image";
import { Activity, ArrowUpRight, CalendarDays, Check, Clock3, Heart, HeartPulse, ShieldCheck, Sparkles, Stethoscope } from "lucide-react";
import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
import { getUiTheme } from "@/platform/ui-theme";

function ExistingHome() {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 md:px-12">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b py-5">
        <Brand />
        <div className="flex items-center gap-2"><Button asChild variant="outline" size="sm"><Link href="/login">Patient sign in</Link></Button><Button asChild variant="outline" size="sm"><Link href="/admin">Clinic sign in <ArrowUpRight aria-hidden="true" /></Link></Button></div>
      </header>
      <section className="max-w-4xl py-20 md:py-28">
        <p className="ui-eyebrow mb-6 !text-primary">A little less waiting. A little more care.</p>
        <h1 className="text-4xl leading-[1.08] font-semibold tracking-[-0.055em] sm:text-6xl md:text-7xl">Care starts with<br /><span className="text-primary">a simpler appointment.</span></h1>
        <p className="mt-7 max-w-xl text-base leading-8 text-muted-foreground">Choose an available time, review your details and confirm your appointment. Sign in to keep track of your visits in one place.</p>
        <div className="mt-8 flex flex-wrap items-center gap-3"><Button asChild><Link href="/book">Book appointment <ArrowUpRight aria-hidden="true" /></Link></Button><Button asChild variant="outline"><Link href="/appointments">My appointments</Link></Button></div>
      </section>
      <section id="what-to-expect" aria-label="What to expect" className="mb-16 grid gap-4 scroll-mt-8 md:grid-cols-3">
        {[
          { icon: CalendarDays, title: "A time that works for you", text: "Browse the clinic’s available appointments and choose your preferred time." },
          { icon: ShieldCheck, title: "Your details, kept private", text: "A personal sign-in keeps your bookings separate from the clinic’s staff workspace." },
          { icon: Heart, title: "Your visits, in one place", text: "See your confirmed appointment times and booking status in My appointments." },
        ].map(({ icon: Icon, title, text }) => (
          <Card key={title}><CardHeader><Icon aria-hidden="true" className="mb-4 size-6 text-primary" /><CardTitle>{title}</CardTitle><CardDescription>{text}</CardDescription></CardHeader></Card>
        ))}
      </section>
      <footer className="mt-auto flex flex-wrap justify-between gap-3 border-t py-6 text-xs text-muted-foreground"><span>Nuvortiq Smart Booking</span><span>Thoughtfully built for your clinic.</span></footer>
    </main>
  );
}

function PlayfulCareHome() {
  return (
    <main className="playful-home min-h-screen overflow-hidden">
      <header className="playful-nav mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8 lg:px-12">
        <Brand />
        <nav aria-label="Main navigation" className="flex items-center gap-2 sm:gap-3">
          <Link href="#care" className="hidden rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex">Why Nuvortiq</Link>
          <Button asChild variant="outline" size="sm"><Link href="/login">Sign in</Link></Button>
        </nav>
      </header>

      <section className="playful-hero mx-auto grid max-w-7xl items-center gap-10 px-5 pb-16 pt-8 sm:px-8 sm:pb-20 md:pt-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8 lg:px-12 lg:pb-28">
        <div className="relative z-10 max-w-2xl">
          <p className="playful-kicker mb-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold tracking-wide"><Sparkles aria-hidden="true" className="size-4" />A little more care, a little less waiting</p>
          <h1 className="playful-heading max-w-2xl text-[clamp(3rem,7.2vw,6.4rem)] leading-[0.96] tracking-[-0.06em]">Good care<br />starts with a<br /><span>good feeling.</span></h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">Make time for your health without the extra steps. Find a visit that fits your day, then book it in just a few taps.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild className="playful-cta h-12 rounded-full px-6 text-sm"><Link href="/book">Book an appointment <ArrowUpRight aria-hidden="true" /></Link></Button>
            <Link href="/appointments" className="inline-flex h-12 items-center rounded-full px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card">My appointments</Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-primary" />Private, personal booking</span>
            <span className="inline-flex items-center gap-2"><CalendarDays aria-hidden="true" className="size-4 text-primary" />Choose a time that works</span>
          </div>
        </div>

        <div className="playful-portrait-stage relative mx-auto w-full max-w-[570px]" role="group" aria-label="Meet your clinician">
          <span aria-hidden="true" className="playful-orbit playful-orbit-one" />
          <span aria-hidden="true" className="playful-orbit playful-orbit-two" />
          <div className="playful-portrait-card relative z-10 mx-auto w-[78%] max-w-[390px] rotate-[2deg] overflow-hidden rounded-[2rem] border-[7px] border-white">
            <Image src="/images/playful-care-doctor.png" alt="Doctor in a white coat smiling in a bright clinic" width={1124} height={1408} priority className="aspect-[4/5] w-full object-cover object-center" />
            <div className="playful-profile-caption absolute inset-x-3 bottom-3 rounded-2xl px-4 py-3 sm:inset-x-4 sm:bottom-4 sm:px-5 sm:py-4">
              <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Your care, with a human touch</p>
              <p className="mt-1 text-lg font-semibold tracking-tight text-foreground sm:text-xl">Here when you need us.</p>
            </div>
          </div>
          <div className="playful-floating-note absolute left-0 top-[18%] z-20 flex items-center gap-3 rounded-2xl px-4 py-3 sm:-left-1">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-primary"><Stethoscope aria-hidden="true" className="size-5" /></span>
            <span><span className="block text-xs font-semibold text-foreground">Thoughtful care</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Every step feels simple</span></span>
          </div>
          <div className="playful-floating-note playful-availability absolute bottom-[13%] right-0 z-20 flex items-center gap-2 rounded-2xl px-4 py-3 sm:-right-1">
            <span className="size-2 rounded-full bg-primary" /><span className="text-xs font-semibold text-foreground">Your next visit, made easy</span>
          </div>
          <span aria-hidden="true" className="playful-spark absolute right-[8%] top-[7%]">✳</span>
        </div>
      </section>

      <section id="care" className="playful-care-section mx-auto max-w-7xl px-5 pb-16 sm:px-8 sm:pb-20 lg:px-12">
        <div className="playful-care-panel grid gap-8 rounded-[2rem] p-6 sm:p-9 md:grid-cols-[0.85fr_1.15fr] md:items-center md:p-12">
          <div>
            <p className="ui-eyebrow mb-3 !text-primary">Care that fits your life</p>
            <h2 className="playful-section-heading max-w-sm text-3xl leading-tight tracking-[-0.04em] sm:text-4xl">A smoother way to look after you.</h2>
            <p className="ui-hint mt-4 max-w-sm">From finding a time to checking your visit details, we keep the little things simple so you can focus on feeling well.</p>
            <Link href="/book" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary transition-all hover:gap-3">Find a visit <ArrowUpRight aria-hidden="true" className="size-4" /></Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="playful-benefit rounded-2xl p-5 sm:translate-y-5"><span className="flex size-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-primary"><CalendarDays aria-hidden="true" className="size-5" /></span><h3 className="mt-5 text-base font-semibold">Pick your moment</h3><p className="ui-hint mt-2">See available appointment times and choose the one that works for you.</p></article>
            <article className="playful-benefit rounded-2xl p-5"><span className="flex size-11 items-center justify-center rounded-2xl bg-available text-available-foreground"><Heart aria-hidden="true" className="size-5" /></span><h3 className="mt-5 text-base font-semibold">Feel looked after</h3><p className="ui-hint mt-2">Review your visit before confirming, with your details kept private.</p></article>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 border-t border-[var(--border)] px-5 py-6 text-xs text-muted-foreground sm:px-8 lg:px-12"><span>Nuvortiq Smart Booking</span><span>Thoughtfully built for your clinic.</span></footer>
    </main>
  );
}

function HoneyCocoaHome() {
  return (
    <main className="honey-home min-h-screen overflow-hidden">
      <header className="honey-nav mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8 lg:px-12">
        <Brand />
        <nav aria-label="Main navigation" className="flex items-center gap-2 sm:gap-3">
          <Link href="#how-it-works" className="hidden px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex">How it works</Link>
          <Button asChild variant="outline" size="sm"><Link href="/appointments">My visits</Link></Button>
          <Link href="/admin" className="hidden px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex">Clinic sign in</Link>
          <Button asChild size="sm"><Link href="/login">Sign in</Link></Button>
        </nav>
      </header>

      <section className="honey-hero mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pb-20 sm:pt-14 lg:px-12">
        <div className="honey-hero-copy mx-auto max-w-4xl text-center">
          <p className="honey-eyebrow mx-auto mb-5 inline-flex items-center gap-2"><span aria-hidden="true" className="honey-sun-dot" />A more considered way to book care</p>
          <h1 className="honey-heading text-[clamp(3.25rem,8.5vw,7.8rem)] leading-[0.9] tracking-[-0.065em]">Make room<br />for feeling <em>better.</em></h1>
          <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">Finding time for your health can feel simple. Choose a visit that suits your day, and take the next step with confidence.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild className="honey-main-cta h-12 px-6"><Link href="/book">Find an appointment <ArrowUpRight aria-hidden="true" /></Link></Button>
            <Link href="/appointments" className="honey-secondary-link inline-flex h-12 items-center gap-2 px-4 text-sm font-semibold">View my appointments <ArrowUpRight aria-hidden="true" className="size-4" /></Link>
          </div>
        </div>

        <div className="honey-hero-art relative mx-auto mt-12 max-w-6xl sm:mt-16">
          <div aria-hidden="true" className="honey-art-backdrop" />
          <div className="honey-photo-frame relative z-10 overflow-hidden">
            <Image src="/images/honey-cocoa-consultation.png" alt="Doctor listening to a patient during a clinic visit" width={1450} height={1080} priority className="honey-hero-photo aspect-[1.5/1] w-full object-cover sm:aspect-[2.05/1]" />
            <div className="honey-photo-caption absolute bottom-4 left-4 flex max-w-[17rem] items-center gap-3 p-3 sm:bottom-7 sm:left-7 sm:max-w-sm sm:gap-4 sm:p-4">
              <span className="honey-caption-icon flex size-11 shrink-0 items-center justify-center"><CalendarDays aria-hidden="true" className="size-5" /></span>
              <span><span className="block text-[10px] font-semibold tracking-[0.14em] uppercase">Your next step</span><span className="mt-1 block text-sm font-semibold sm:text-base">A visit that fits your day</span></span>
            </div>
          </div>
          <div className="honey-hero-stamp absolute right-2 top-[-1.5rem] z-20 flex size-[5.5rem] rotate-[8deg] flex-col items-center justify-center text-center sm:right-8 sm:top-[-2rem] sm:size-28"><span className="text-[9px] font-bold tracking-[0.16em] uppercase sm:text-[10px]">Made for</span><span className="mt-1 font-serif text-sm font-bold sm:text-lg">your day</span><span aria-hidden="true" className="mt-0.5 text-base leading-none">✳</span></div>
        </div>
      </section>

      <section className="honey-ribbon" aria-label="Booking benefits"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 py-5 text-xs font-semibold tracking-wide sm:px-8 sm:text-sm"><span>Choose a time</span><span aria-hidden="true" className="honey-ribbon-star">✳</span><span>Review the details</span><span aria-hidden="true" className="honey-ribbon-star">✳</span><span>Feel ready for your visit</span></div></section>

      <section id="how-it-works" className="honey-bento mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24 lg:px-12">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-5 sm:mb-12">
          <div><p className="ui-eyebrow mb-3 honey-label">A little ease, at every step</p><h2 className="honey-section-title max-w-xl text-3xl leading-tight tracking-[-0.045em] sm:text-5xl">Care that feels<br className="hidden sm:block" /> clear from the start.</h2></div>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">Less back and forth. More time for what matters. Your booking and visit details stay together in one private place.</p>
        </div>
        <div className="honey-bento-grid">
          <article className="honey-bento-card honey-bento-dark flex flex-col justify-between p-6 sm:p-9">
            <div className="flex items-start justify-between gap-4"><span className="honey-step-number">01</span><span className="honey-icon-tile"><CalendarDays aria-hidden="true" className="size-5" /></span></div>
            <div className="mt-12"><h3 className="honey-card-title text-2xl sm:text-3xl">A time that works for you.</h3><p className="mt-3 max-w-md text-sm leading-6 text-white/75">See available visits and choose a moment that fits around your day.</p><Link href="/book" className="honey-dark-link mt-6 inline-flex items-center gap-2 text-sm font-semibold">Browse appointments <ArrowUpRight aria-hidden="true" className="size-4" /></Link></div>
          </article>
          <article className="honey-bento-card honey-bento-yellow p-6 sm:p-8">
            <span className="honey-step-number">02</span><span className="honey-open-quote" aria-hidden="true">“</span>
            <h3 className="honey-card-title mt-8 text-2xl sm:text-[28px]">Know what comes next.</h3><p className="mt-3 text-sm leading-6">Review your visit details before you confirm, then find your appointment whenever you need it.</p>
            <div className="honey-mini-list mt-6 space-y-2"><p><ShieldCheck aria-hidden="true" className="size-4" />Your information stays private</p><p><Heart aria-hidden="true" className="size-4" />Your visits in one place</p></div>
          </article>
          <article className="honey-bento-card honey-bento-cream flex flex-col justify-between p-6 sm:p-8">
            <div className="flex items-start justify-between"><span className="honey-step-number">03</span><span className="honey-clock-mark"><Clock3 aria-hidden="true" className="size-5" /></span></div>
            <div className="mt-8"><h3 className="honey-card-title text-2xl">A calmer clinic day.</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">Your confirmed time and booking status are easy to find in My appointments.</p><Link href="/appointments" className="honey-text-link mt-5 inline-flex items-center gap-2 text-sm font-semibold">See my visits <ArrowUpRight aria-hidden="true" className="size-4" /></Link></div>
          </article>
        </div>
      </section>

      <section className="honey-cta-band mx-5 mb-12 sm:mx-8 sm:mb-16 lg:mx-auto lg:max-w-7xl lg:px-12">
        <div className="honey-cta-inner flex flex-col items-start justify-between gap-7 px-6 py-8 sm:flex-row sm:items-center sm:px-10 sm:py-10">
          <div><p className="text-xs font-semibold tracking-[0.15em] text-white/65 uppercase">A little time for you</p><h2 className="honey-cta-title mt-3 max-w-2xl text-3xl leading-tight tracking-[-0.04em] sm:text-4xl">Let’s make your next visit easy.</h2></div>
          <Button asChild variant="outline" className="honey-light-cta h-12 shrink-0 border-white/35 bg-white text-foreground hover:bg-[#fff8e9]"><Link href="/book">Book a visit <ArrowUpRight aria-hidden="true" /></Link></Button>
        </div>
      </section>

      <footer className="honey-footer mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t px-5 py-6 text-xs text-muted-foreground sm:px-8 lg:px-12"><Brand compact /><nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-x-5 gap-y-2"><Link href="/appointments" className="hover:text-foreground">My appointments</Link><Link href="/admin" className="hover:text-foreground">Clinic sign in</Link><span>Thoughtfully built for your care.</span></nav></footer>
    </main>
  );
}

function FutureClinicHome() {
  return (
    <main className="future-home min-h-screen overflow-hidden">
      <header className="future-nav mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8 lg:px-12">
        <Brand />
        <nav aria-label="Main navigation" className="flex items-center gap-2 sm:gap-3">
          <Link href="#care-flow" className="hidden rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex">How it works</Link>
          <Link href="/admin" className="hidden px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground md:inline-flex">Clinic sign in</Link>
          <Button asChild variant="outline" size="sm"><Link href="/appointments">My appointments</Link></Button>
          <Button asChild size="sm"><Link href="/login">Sign in</Link></Button>
        </nav>
      </header>

      <section className="future-hero mx-auto grid max-w-7xl items-center gap-10 px-5 pb-16 pt-10 sm:px-8 sm:pb-20 md:pt-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12 lg:px-12 lg:pb-28">
        <div className="future-hero-copy relative z-10">
          <p className="future-eyebrow mb-6 inline-flex items-center gap-2"><span className="future-signal" />A smarter way to make time for you</p>
          <h1 className="future-heading max-w-2xl text-[clamp(3.2rem,7vw,6.4rem)] leading-[0.94] tracking-[-0.075em]">Your health,<br />without the<br /><span>heavy lifting.</span></h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">A calmer way to find a time, confirm your visit, and keep your care in view. Everything you need, right where you need it.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild className="future-primary-cta h-12 rounded-xl px-6 text-sm"><Link href="/book">Book an appointment <ArrowUpRight aria-hidden="true" /></Link></Button>
            <Link href="/appointments" className="future-secondary-cta inline-flex h-12 items-center gap-2 rounded-xl px-4 text-sm font-semibold">View my visits <ArrowUpRight aria-hidden="true" className="size-4" /></Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground"><span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-primary" />Private by design</span><span className="inline-flex items-center gap-2"><HeartPulse aria-hidden="true" className="size-4 text-[var(--coral)]" />Care, made clearer</span></div>
        </div>

        <div className="future-visual relative mx-auto w-full max-w-[650px]" role="group" aria-label="Preview of the appointment booking experience">
          <div aria-hidden="true" className="future-visual-orbit future-visual-orbit-a" /><div aria-hidden="true" className="future-visual-orbit future-visual-orbit-b" />
          <div className="future-interface relative z-10">
            <div className="future-interface-top flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5"><span className="future-app-icon flex size-9 items-center justify-center rounded-xl"><Activity aria-hidden="true" className="size-4" /></span><span><span className="block text-xs font-semibold">Your care, in sync</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Appointment planner</span></span></div>
              <span className="future-live-tag inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"><span className="size-1.5 rounded-full" />Simple & secure</span>
            </div>
            <div className="future-interface-rule" />
            <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Choose a day</p><p className="mt-1 text-sm font-semibold">A time that works for you</p></div><span className="future-calendar-mark flex size-9 items-center justify-center rounded-xl"><CalendarDays aria-hidden="true" className="size-4" /></span></div>
            <div className="future-date-row mt-5 grid grid-cols-4 gap-2" role="group" aria-label="Example appointment dates"><span><small>MON</small><b>12</b></span><span><small>TUE</small><b>13</b></span><span className="is-selected"><small>WED</small><b>14</b></span><span><small>THU</small><b>15</b></span></div>
            <div className="mt-5 flex items-center justify-between"><p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Available times</p><span className="text-[10px] text-muted-foreground">3 shown</span></div>
            <div className="future-time-row mt-2 grid grid-cols-3 gap-2"><span>9:30 am</span><span className="is-selected">10:30 am</span><span>1:00 pm</span></div>
            <div className="future-visit-summary mt-5 flex items-center justify-between gap-3 rounded-xl p-3"><div className="flex items-center gap-2.5"><span className="future-check flex size-8 items-center justify-center rounded-lg"><Check aria-hidden="true" className="size-4" /></span><span><span className="block text-[10px] font-semibold">Your next visit</span><span className="mt-0.5 block text-[10px] text-muted-foreground">Wednesday · 10:30 am</span></span></div><ArrowUpRight aria-hidden="true" className="size-4 text-primary" /></div>
          </div>
          <div className="future-float future-confirmed absolute bottom-[8%] left-[-2%] z-20 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 sm:left-[-5%] sm:px-4 sm:py-3"><span className="future-float-check flex size-8 items-center justify-center rounded-xl"><Check aria-hidden="true" className="size-4" /></span><span><span className="block text-[10px] font-semibold sm:text-xs">Appointment confirmed</span><span className="mt-0.5 block text-[9px] text-muted-foreground sm:text-[10px]">You’re all set</span></span></div>
          <div className="future-float future-step-badge absolute right-[-1%] top-[8%] z-20 rounded-2xl px-3 py-2.5 sm:right-[-4%] sm:px-4 sm:py-3"><span className="block text-[9px] font-semibold tracking-[0.12em] uppercase">A smoother flow</span><span className="mt-1 block text-xs font-bold">Pick. Review. Done.</span></div>
        </div>
      </section>

      <section className="future-ribbon mx-auto max-w-7xl px-5 sm:px-8 lg:px-12"><div className="future-ribbon-inner grid gap-4 rounded-2xl px-5 py-5 sm:grid-cols-3 sm:px-8 sm:py-6"><p><span>01</span> Find your moment</p><p><span>02</span> Review with confidence</p><p><span>03</span> Keep your visit close</p></div></section>

      <section id="care-flow" className="future-bento-section mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24 lg:px-12">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-5 sm:mb-12"><div><p className="future-eyebrow mb-3">More clarity, from the very first step</p><h2 className="future-section-heading max-w-xl text-3xl leading-tight tracking-[-0.06em] sm:text-5xl">Care that keeps<br className="hidden sm:block" /> up with real life.</h2></div><p className="max-w-sm text-sm leading-6 text-muted-foreground">Thoughtful details make every appointment easier to manage, for you and for the people who care for you.</p></div>
        <div className="future-bento-grid">
          <article className="future-bento-card future-bento-violet flex flex-col justify-between p-6 sm:p-8"><div className="flex items-start justify-between gap-4"><span className="future-card-label">Your care, more connected</span><span className="future-card-symbol"><CalendarDays aria-hidden="true" className="size-5" /></span></div><div className="mt-12"><h3 className="future-card-title max-w-md text-2xl leading-tight sm:text-3xl">One clear next step can change the whole day.</h3><p className="mt-3 max-w-md text-sm leading-6 text-white">Browse available appointments, choose a time, and know exactly what comes next.</p><Link href="/book" className="future-card-link mt-6 inline-flex items-center gap-2 text-sm font-semibold">Explore appointment times <ArrowUpRight aria-hidden="true" className="size-4" /></Link></div><div aria-hidden="true" className="future-card-orbit" /></article>
          <article className="future-bento-card future-bento-coral p-6 sm:p-8"><span className="future-card-symbol"><ShieldCheck aria-hidden="true" className="size-5" /></span><h3 className="future-card-title mt-8 text-xl sm:text-2xl">Your details stay yours.</h3><p className="mt-3 text-sm leading-6">A personal sign-in keeps your appointments in a private, easy-to-find place.</p><div className="future-secure-mark mt-6 flex items-center gap-2 text-xs font-semibold"><span className="future-secure-dot" />Personal and private</div></article>
          <article className="future-bento-card future-bento-ice p-6 sm:p-8"><div className="flex items-start justify-between gap-4"><span className="future-card-label">Keep your day in view</span><span className="future-card-symbol"><Clock3 aria-hidden="true" className="size-5" /></span></div><h3 className="future-card-title mt-8 text-xl sm:text-2xl">Your visit details, all together.</h3><p className="mt-3 max-w-md text-sm leading-6">Check appointment times and booking status whenever you need a quick reminder.</p><Link href="/appointments" className="future-card-link mt-5 inline-flex items-center gap-2 text-sm font-semibold">View my appointments <ArrowUpRight aria-hidden="true" className="size-4" /></Link></article>
        </div>
      </section>

      <section className="future-cta-wrap mx-5 mb-12 sm:mx-8 sm:mb-16 lg:mx-auto lg:max-w-7xl lg:px-12"><div className="future-cta-panel flex flex-col items-start justify-between gap-7 px-6 py-8 sm:flex-row sm:items-center sm:px-10 sm:py-10"><div><p className="text-xs font-semibold tracking-[0.14em] text-white uppercase">A little easier, starting now</p><h2 className="future-cta-title mt-3 max-w-2xl text-3xl leading-tight tracking-[-0.05em] sm:text-4xl">Make your next appointment feel simple.</h2></div><Button asChild variant="outline" className="future-cta-light h-12 shrink-0 border-white/40 bg-white text-foreground hover:bg-[#F7F8FC]"><Link href="/book">Get started <ArrowUpRight aria-hidden="true" /></Link></Button></div></section>

      <footer className="future-footer mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 border-t px-5 py-6 text-xs text-muted-foreground sm:px-8 lg:px-12"><Brand compact /><nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-x-5 gap-y-2"><Link href="/appointments" className="hover:text-foreground">My appointments</Link><Link href="/admin" className="hover:text-foreground">Clinic sign in</Link><span>Thoughtfully built for your care.</span></nav></footer>
    </main>
  );
}

export default function Home() {
  const theme = getUiTheme();
  if (theme === "playful-care") return <PlayfulCareHome />;
  if (theme === "honey-cocoa") return <HoneyCocoaHome />;
  if (theme === "future-clinic") return <FutureClinicHome />;
  return <ExistingHome />;
}
