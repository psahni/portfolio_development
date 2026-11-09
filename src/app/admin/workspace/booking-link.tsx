"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function BookingLink({ url }: { url: string }) {
  const [message, setMessage] = useState("");
  const escapedUrl = url.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const snippet = `<a href="${escapedUrl}">Book appointment</a>`;
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage("Copied to clipboard."); }
    catch { setMessage("Select the text and copy it manually."); }
  }
  return <section aria-labelledby="booking-link-title" className="ui-panel mt-6"><h2 id="booking-link-title" className="font-semibold">Patient booking link</h2><p className="ui-hint mt-2">Share the hosted link or add this button to your clinic website. Patients sign in before booking.</p><label htmlFor="hosted-booking-url" className="mt-5 block text-sm font-medium">Hosted booking URL</label><input id="hosted-booking-url" readOnly value={url} className="ui-input" /><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void copy(url)}>Copy link</Button><label htmlFor="website-booking-button" className="mt-5 block text-sm font-medium">Website button HTML</label><textarea id="website-booking-button" readOnly value={snippet} rows={3} className="ui-input h-auto py-3 font-mono text-xs" /><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void copy(snippet)}>Copy website button</Button>{message && <p role="status" className="mt-3 text-sm text-primary">{message}</p>}</section>;
}
