import type { ReactNode } from 'react';
import Card from './Card';

interface MetricCardProps {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
  tone?: 'default' | 'warn';
}

/** One of the four compact Overview metric tiles. `value` is rendered with
 * tabular numerals so a row of these lines up cleanly. */
export default function MetricCard({ label, value, detail, icon, tone = 'default' }: MetricCardProps) {
  return (
    <Card padding="md" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-soft">{label}</p>
        {icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sage text-primary-dark">
            {icon}
          </span>
        )}
      </div>
      <p className="text-[1.75rem] font-semibold leading-none tracking-tight text-ink tabular-nums">{value}</p>
      {detail && (
        <p className={`text-xs font-medium ${tone === 'warn' ? 'text-warn' : 'text-ink-soft'}`}>{detail}</p>
      )}
    </Card>
  );
}
