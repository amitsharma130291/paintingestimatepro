import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { track } from '../../lib/analytics';

export interface WalkthroughStep {
  heading: string;
  body: string;
  image: string;
  alt: string;
  width: number;
  height: number;
}

const SWIPE_THRESHOLD_PX = 40;

/**
 * No genuine screen recording exists for this product, and this component
 * exists specifically so nothing gets fabricated in its place (per the
 * brief: "If a genuine screen recording asset is not available, do not
 * fabricate one"). This is the "compact interactive walkthrough" fallback
 * instead — one real screenshot at a time, stepped through deliberately,
 * never auto-advancing. It replaces the previous stacked, show-all-four
 * layout, which is why the page doesn't grow to fit two versions of the
 * same four steps.
 */
export default function ProWalkthrough({ steps }: { steps: WalkthroughStep[] }) {
  const [index, setIndex] = useState(0);
  const started = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(steps.length - 1, next));
    if (clamped === index) return;
    if (!started.current) {
      started.current = true;
      track('walkthrough_started');
    }
    setIndex(clamped);
    track('walkthrough_progressed', { step: clamped + 1 });
    if (clamped === steps.length - 1) track('walkthrough_completed');
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(index - 1);
    }
  }

  function onTouchStart(e: TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: TouchEvent) {
    if (touchStartX.current == null) return;
    const delta = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    // A left swipe moves forward (next), a right swipe moves back (previous).
    if (delta < 0) goTo(index + 1);
    else goTo(index - 1);
  }

  // First-view tracking for someone who never touches prev/next/swipe at
  // all (e.g. just reads step 1) -- fires once, the first time the
  // component actually scrolls into view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          track('walkthrough_started');
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const step = steps[index];

  return (
    <div
      ref={rootRef}
      role="group"
      aria-roledescription="carousel"
      aria-label={`Product walkthrough, step ${index + 1} of ${steps.length}: ${step.heading}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="rounded-card border border-line bg-card p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:p-6"
    >
      <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="overflow-hidden rounded-card border border-line">
          <img src={step.image} alt={step.alt} width={step.width} height={step.height} loading="lazy" className="w-full" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-soft">
            Step {index + 1} of {steps.length}
          </p>
          <h3 className="mt-1 text-balance text-xl font-semibold tracking-tight text-ink">{step.heading}</h3>
          <p className="mt-2 text-base leading-relaxed text-ink-soft">{step.body}</p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous step"
          className="btn btn-secondary !min-h-[44px] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </button>

        <div className="flex items-center gap-2" aria-hidden="true">
          {steps.map((s, i) => (
            <span
              key={s.heading}
              className={`h-2 w-2 rounded-full transition-colors ${i === index ? 'bg-primary' : 'bg-line'}`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={index === steps.length - 1}
          aria-label="Next step"
          className="btn btn-secondary !min-h-[44px] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
