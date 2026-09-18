import type { ReactNode } from 'react';

interface EmptyStateStep {
  label: string;
}

interface EmptyStateProps {
  heading: string;
  description: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  steps?: EmptyStateStep[];
  illustration?: ReactNode;
}

/** Simple line-art roller-and-sheet mark used by the onboarding empty
 * states — an abstract nod to the trade rather than a literal icon. */
export function PaintRollerIllustration() {
  return (
    <svg viewBox="0 0 160 120" fill="none" className="h-24 w-32" aria-hidden="true">
      <rect x="18" y="18" width="70" height="52" rx="6" stroke="var(--color-line)" strokeWidth="2" />
      <line x1="30" y1="34" x2="76" y2="34" stroke="var(--color-line)" strokeWidth="2" />
      <line x1="30" y1="46" x2="66" y2="46" stroke="var(--color-line)" strokeWidth="2" />
      <line x1="30" y1="58" x2="72" y2="58" stroke="var(--color-line)" strokeWidth="2" />
      <rect x="86" y="70" width="34" height="14" rx="7" fill="var(--color-primary)" />
      <rect x="112" y="56" width="8" height="24" rx="3" fill="var(--color-primary)" />
      <line x1="116" y1="56" x2="116" y2="34" stroke="var(--color-accent-brass)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="140" cy="30" r="6" fill="var(--color-accent-brass)" />
    </svg>
  );
}

export default function EmptyState({
  heading,
  description,
  primaryAction,
  secondaryAction,
  steps,
  illustration,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-card border border-line bg-card px-6 py-12 text-center">
      {illustration ?? <PaintRollerIllustration />}
      <h3 className="mt-6 text-xl font-semibold tracking-tight text-ink">{heading}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">{description}</p>
      {(primaryAction || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
      {steps && steps.length > 0 && (
        <ol className="mt-8 flex w-full max-w-lg flex-wrap items-center justify-center gap-x-2 gap-y-3 text-xs font-medium text-ink-soft">
          {steps.map((step, i) => (
            <li key={step.label} className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-sage text-[0.6875rem] font-semibold text-primary-dark">
                {i + 1}
              </span>
              {step.label}
              {i < steps.length - 1 && <span aria-hidden="true" className="text-line">&rarr;</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
