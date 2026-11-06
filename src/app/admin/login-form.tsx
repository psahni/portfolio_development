"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { requestStaffAuth } from "@/modules/identity/client";

const inputClass = "mt-2 h-12 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"pin" | "code">("pin");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"pin" | "code" | "request" | null>(null);
  const [error, setError] = useState("");
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === "code" && pending === null) codeInput.current?.focus();
  }, [step, pending]);

  async function signIn(method: "pin" | "code" | "request") {
    if (pending) return;
    setError("");
    const address = email.trim().toLowerCase();
    if (!z.email().safeParse(address).success) { setError("Enter a valid email address."); return; }
    if (method === "pin" && !/^\d{4}$/.test(pin)) { setError("Enter your four-digit PIN."); return; }
    if (method === "code" && !/^(\d{4}|\d{6})$/.test(code)) { setError("Enter your sign-in code."); return; }
    setPending(method);
    try {
      if (method === "request") {
        await requestStaffAuth("email-otp/send-verification-otp", { email: address, type: "sign-in" });
        // Retain the email separately; the code step never submits a PIN.
        setEmail(address); setPin(""); setCode(""); setStep("code");
      } else {
        if (method === "pin") await requestStaffAuth("sign-in/admin-pin", { email: address, pin });
        else await requestStaffAuth("sign-in/email-otp", { email: address, otp: code });
        router.replace("/admin/workspace"); router.refresh();
      }
    } catch (failure) {
      setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Unable to connect. Please try again.");
    } finally { setPending(null); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signIn(step);
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={pending !== null} className="space-y-5">
      {step === "pin" ? <>
        <div><label htmlFor="email" className="text-sm font-medium">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending !== null} className={inputClass} /></div>
        <div><label htmlFor="pin" className="text-sm font-medium">PIN</label>
          <input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value)} disabled={pending !== null} className={inputClass} />
          <button type="button" onClick={() => void signIn("request")} disabled={pending !== null} className="mt-3 rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-50">{pending === "request" ? "Sending code…" : "Send code"}</button>
        </div>
      </> : <>
        <p role="status" className="break-words text-sm leading-relaxed text-muted-foreground">If this email has staff access, use your sign-in code below.<br /><span className="font-medium text-foreground">{email}</span></p>
        <div><label htmlFor="code" className="text-sm font-medium">Code</label>
          <input ref={codeInput} id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} disabled={pending !== null} className={inputClass} /></div>
      </>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <Button type="submit" disabled={pending !== null} className="w-full">{pending === "pin" || pending === "code" ? "Signing in…" : "Sign in"}</Button>
      {step === "code" && <button type="button" disabled={pending !== null} onClick={() => { setStep("pin"); setPin(""); setCode(""); setError(""); }} className="w-full rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Use another email</button>}
    </form>
  );
}
