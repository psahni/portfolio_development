"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/layout/brand";

export default function AdminError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-lg space-y-8 px-6 py-16"><Brand href="/admin" /><section className="ui-panel space-y-5"><p className="ui-eyebrow">We’ll be right back</p><h1 className="ui-page-title">Workspace temporarily unavailable</h1><p className="ui-hint">Please try again in a moment.</p><div className="flex flex-wrap gap-3"><Button onClick={reset}>Try again</Button><Button asChild variant="outline"><Link href="/admin">Back to sign in</Link></Button></div></section></main>;
}
