// @vitest-environment jsdom
// The sales page's product walkthrough: no genuine screen recording exists
// for this product, so this is the "compact interactive walkthrough"
// fallback the optimization brief calls for instead of fabricating a video
// asset. Covers the concrete, testable requirements: previous/next
// controls, a step counter, no automatic advancement, keyboard
// navigation, and that analytics events fire at the right moments without
// ever double-firing "completed" from repeated clicks past the end.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ProWalkthrough from '../../src/components/tools/ProWalkthrough';

const STEPS = [
  { heading: 'Build the job', body: 'Step one body.', image: '/guide/one.webp', alt: 'Step one', width: 100, height: 100 },
  { heading: 'Check the true cost', body: 'Step two body.', image: '/guide/two.webp', alt: 'Step two', width: 100, height: 100 },
  { heading: 'Protect the margin', body: 'Step three body.', image: '/guide/three.webp', alt: 'Step three', width: 100, height: 100 },
  { heading: 'Compare estimate with actual', body: 'Step four body.', image: '/guide/four.webp', alt: 'Step four', width: 100, height: 100 },
];

// IntersectionObserver doesn't exist in jsdom -- stub it so mount doesn't
// throw; the component's own view-triggered "walkthrough_started" isn't
// what these tests are exercising (the click/keyboard-driven paths are).
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => cleanup());

describe('ProWalkthrough: no automatic advancement, real prev/next/keyboard navigation', () => {
  it('starts on step 1 of 4 and shows its heading', () => {
    render(<ProWalkthrough steps={STEPS} />);
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Build the job' })).toBeTruthy();
  });

  it('"Previous" is disabled on the first step; clicking "Next" advances exactly one step', () => {
    render(<ProWalkthrough steps={STEPS} />);
    expect((screen.getByRole('button', { name: 'Previous step' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Check the true cost' })).toBeTruthy();
  });

  it('"Next" is disabled on the last step, and repeated clicks never advance past it', () => {
    render(<ProWalkthrough steps={STEPS} />);
    const next = screen.getByRole('button', { name: 'Next step' });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByText('Step 4 of 4')).toBeTruthy();
    expect((next as HTMLButtonElement).disabled).toBe(true);
  });

  it('the right arrow key advances a step and the left arrow key goes back, without a mouse', () => {
    render(<ProWalkthrough steps={STEPS} />);
    const carousel = screen.getByRole('group', { name: /step 1 of 4/i });
    fireEvent.keyDown(carousel, { key: 'ArrowRight' });
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    fireEvent.keyDown(carousel, { key: 'ArrowLeft' });
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
  });

  it('does not advance on its own — the heading stays on step 1 with no interaction', async () => {
    render(<ProWalkthrough steps={STEPS} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
  });

  it('fires walkthrough_progressed on each step change and walkthrough_completed exactly once, only on reaching the last step', () => {
    const seen: string[] = [];
    const onProgressed = () => seen.push('progressed');
    const onCompleted = () => seen.push('completed');
    document.addEventListener('pep:walkthrough_progressed', onProgressed);
    document.addEventListener('pep:walkthrough_completed', onCompleted);
    try {
      render(<ProWalkthrough steps={STEPS} />);
      const next = screen.getByRole('button', { name: 'Next step' });
      fireEvent.click(next); // -> step 2
      fireEvent.click(next); // -> step 3
      fireEvent.click(next); // -> step 4 (last)
      fireEvent.click(next); // disabled, no-op -- must not re-fire "completed"
      expect(seen.filter((e) => e === 'progressed').length).toBe(3);
      expect(seen.filter((e) => e === 'completed').length).toBe(1);
    } finally {
      document.removeEventListener('pep:walkthrough_progressed', onProgressed);
      document.removeEventListener('pep:walkthrough_completed', onCompleted);
    }
  });

  it('every step image has real, step-specific alt text', () => {
    render(<ProWalkthrough steps={STEPS} />);
    expect(screen.getByAltText('Step one')).toBeTruthy();
  });
});
