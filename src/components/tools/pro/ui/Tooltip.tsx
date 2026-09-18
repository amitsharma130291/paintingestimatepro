import { useId, useState, type ReactNode } from 'react';

interface TooltipProps {
  label: string;
  children: ReactNode;
}

/** Wraps a trigger element with a small hover/focus-revealed tooltip —
 * used for the test-mode badge's technical explanation and similar
 * secondary detail that shouldn't compete with the main copy. */
export default function Tooltip({ label, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span aria-describedby={visible ? id : undefined}>{children}</span>
      {visible && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-40 mt-2 w-max max-w-64 -translate-x-1/2 rounded-btn border border-line bg-ink px-3 py-2 text-xs font-medium text-primary-ink shadow-lg"
        >
          {label}
        </span>
      )}
    </span>
  );
}
