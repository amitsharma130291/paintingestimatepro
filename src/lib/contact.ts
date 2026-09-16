// Client-side wrapper for /api/contact — mirrors the fetch pattern in
// src/lib/license.ts.
export interface ContactFormInput {
  name: string;
  email: string;
  subject: string;
  message: string;
  company?: string; // honeypot; always empty from a real submission
}

export async function submitContactForm(input: ContactFormInput): Promise<string> {
  const res = await fetch('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Couldn't send your message.");
  }
  return data.message as string;
}
