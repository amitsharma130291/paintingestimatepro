import type { HTMLAttributes, ReactNode } from 'react';

type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  surface?: 'card' | 'sage';
  children: ReactNode;
}

const PADDING_CLASS: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

/** The one card surface for the Pro app — a white .card panel, or the
 * muted sage surface for a secondary/quieter grouping (e.g. an inline
 * summary inside a busier panel). */
export default function Card({ padding = 'md', surface = 'card', className = '', children, ...rest }: CardProps) {
  const surfaceClass = surface === 'sage' ? 'bg-surface-sage border border-line rounded-card' : 'card';
  return (
    <div className={`${surfaceClass} ${PADDING_CLASS[padding]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
