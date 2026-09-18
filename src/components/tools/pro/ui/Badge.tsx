import type { HTMLAttributes } from 'react';

type BadgeVariant = 'neutral' | 'primary' | 'warn' | 'bad' | 'brass';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  neutral: '',
  primary: 'status-pill-primary',
  warn: 'status-pill-warn',
  bad: 'status-pill-bad',
  brass: 'status-pill-brass',
};

/** Status chip used for revision state (Draft/Issued/Superseded), test-mode
 * indicators, and any other short at-a-glance label. Composes the existing
 * .status-pill class family in global.css. */
export default function Badge({ variant = 'neutral', className = '', children, ...rest }: BadgeProps) {
  return (
    <span className={`status-pill ${VARIANT_CLASS[variant]} ${className}`} {...rest}>
      {children}
    </span>
  );
}
