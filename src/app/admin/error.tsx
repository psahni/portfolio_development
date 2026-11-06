"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AdminError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-lg space-y-5 px-6 py-20"><h1 className="text-2xl font-semibold">Workspace temporarily unavailable</h1><p className="text-muted-foreground">Please try again in a moment.</p><div className="flex gap-3"><Button onClick={reset}>Try again</Button><Button asChild variant="outline"><Link href="/admin">Back to sign in</Link></Button></div></main>;
}
