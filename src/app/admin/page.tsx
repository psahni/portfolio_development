import Link from "next/link";
import { ArrowLeft, Heart } from "lucide-react";
import { LoginForm } from "./login-form";

export default function AdminLogin() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8 md:px-12">
      <Link href="/" className="inline-flex w-fit items-center gap-2 rounded text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><ArrowLeft aria-hidden="true" className="size-4" /> Back to home</Link>
      <div className="grid flex-1 items-center gap-10 py-12 md:grid-cols-2 md:gap-16">
        <section>
          <Heart aria-hidden="true" className="mb-6 size-9 text-primary" />
          <p className="mb-4 text-xs font-semibold tracking-[0.16em] text-primary uppercase">Nuvortiq Smart Booking</p>
          <h1 className="text-4xl leading-tight font-medium tracking-tight md:text-5xl">Your clinic.<br />A calmer day.</h1>
          <p className="mt-5 max-w-sm leading-relaxed text-muted-foreground">Sign in to your clinic workspace.</p>
        </section>
        <section aria-labelledby="sign-in-heading" className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <h2 id="sign-in-heading" className="text-2xl font-semibold tracking-tight">Clinic sign in</h2>
          <p className="mt-2 mb-7 text-sm leading-relaxed text-muted-foreground">Use your admin PIN, or choose Send code to sign in with an email code.</p>
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
