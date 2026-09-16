import { useState, type FormEvent } from 'react';
import { submitContactForm } from '../lib/contact';

export default function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [company, setCompany] = useState(''); // honeypot
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const confirmation = await submitContactForm({ name, email, subject, message, company });
      setSentMessage(confirmation);
      setName('');
      setEmail('');
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your message.");
    } finally {
      setSending(false);
    }
  }

  if (sentMessage) {
    return (
      <div className="rounded-btn border border-line bg-card p-6 text-center">
        <p className="text-lg font-semibold text-ink">Message sent</p>
        <p className="mt-2 text-sm text-ink-soft">{sentMessage}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Honeypot: hidden from sighted users and from screen readers; a
          filled value means a bot, not a person, submitted this form. */}
      <input
        type="text"
        name="company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <div>
        <label htmlFor="contact-name" className="mb-1.5 block text-sm font-medium text-ink">
          Name
        </label>
        <input
          id="contact-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink"
        />
      </div>

      <div>
        <label htmlFor="contact-email" className="mb-1.5 block text-sm font-medium text-ink">
          Email <span aria-hidden="true">*</span>
        </label>
        <input
          id="contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink"
        />
      </div>

      <div>
        <label htmlFor="contact-subject" className="mb-1.5 block text-sm font-medium text-ink">
          Subject <span aria-hidden="true">*</span>
        </label>
        <input
          id="contact-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink"
        />
      </div>

      <div>
        <label htmlFor="contact-message" className="mb-1.5 block text-sm font-medium text-ink">
          Message <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={6}
          className="w-full resize-y rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink"
        />
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={sending}>
        {sending ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}
