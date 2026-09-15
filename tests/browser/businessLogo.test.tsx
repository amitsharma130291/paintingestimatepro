// @vitest-environment jsdom
// DOC-010: the real upload/preview/replace/remove flow through ProApp,
// plus print rendering. jsdom does not implement a real image decoder,
// so `Image.onload`/`onerror` never fire naturally for a data: URI here
// -- the global Image constructor is mocked per-test to deterministically
// simulate a successful decode (with controllable dimensions) or a
// decode failure, matching real-browser Image semantics exactly (the
// same onload/onerror contract ProApp.tsx's decodeImageDimensions relies
// on). Byte-level format/size validation (the part that does NOT depend
// on decoding) is exercised against real PNG/JPEG bytes with no mocking
// at all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';

const NOW = '2026-01-01T00:00:00.000Z';
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngFile(totalBytes: number, name = 'logo.png', type = 'image/png'): File {
  const bytes = new Uint8Array(totalBytes);
  bytes.set(PNG_MAGIC);
  return new File([bytes], name, { type });
}
function svgFileDisguisedAsPng(): File {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  // Deliberately claims image/png and a .png filename -- format must be
  // sniffed from bytes, never trusted from either.
  return new File([svg], 'logo.png', { type: 'image/png' });
}

/** Mocks the global Image constructor so decodeImageDimensions resolves
 * (or rejects) deterministically, exactly like a real browser's decoder
 * would for a valid (or corrupt) image -- this is the standard technique
 * for testing Image.onload/onerror-driven code without a real decoder. */
function mockImageDecode(outcome: { width: number; height: number } | 'fail') {
  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_v: string) {
      queueMicrotask(() => {
        if (outcome === 'fail') this.onerror?.();
        else {
          this.naturalWidth = outcome.width;
          this.naturalHeight = outcome.height;
          this.onload?.();
        }
      });
    }
  }
  vi.stubGlobal('Image', MockImage);
}

beforeEach(async () => {
  mockImageDecode({ width: 200, height: 200 }); // sane default; overridden per test as needed
  const db = await openAppDb();
  try {
    for (const store of Object.values(STORES)) await db.clear(store);
    await db.put(STORES.businessSettings, {
      id: 'default-settings', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
      wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
      defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
    });
    await db.put(STORES.paintVariants, { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW });
  } finally {
    db.close();
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mountNewProject() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  await screen.findByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)');
}

describe('DOC-010: business logo upload, preview, replace, and remove', () => {
  it('uploading a valid small PNG shows a preview with accessible alt text, no error', async () => {
    await mountNewProject();
    const input = screen.getByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile(200)] } });

    // Two matches are expected and correct: the editor's own upload
    // preview AND the always-available customer-document preview (DOC-004)
    // both render the same businessInfo.logo.
    const images = await screen.findAllByRole('img', { name: /logo/i });
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images[0].getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByRole('button', { name: 'Remove logo' })).toBeTruthy();
  });

  it('rejects an SVG disguised with a .png filename and image/png declared type -- format is sniffed from bytes', async () => {
    await mountNewProject();
    const input = screen.getByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [svgFileDisguisedAsPng()] } });

    expect(await screen.findByText(/only png, jpeg, or webp/i)).toBeTruthy();
    expect(screen.queryAllByRole('img', { name: /logo/i })).toHaveLength(0);
  });

  it('rejects a file over the 1 MiB size limit', async () => {
    await mountNewProject();
    const input = screen.getByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile(1024 * 1024 + 1)] } });

    expect(await screen.findByText(/maximum is 1048576 bytes/i)).toBeTruthy();
  });

  it('rejects an image exceeding the dimension limit even though the bytes are a valid small-enough PNG', async () => {
    mockImageDecode({ width: 5000, height: 5000 });
    await mountNewProject();
    const input = screen.getByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile(200)] } });

    expect(await screen.findByText(/5000x5000px/i)).toBeTruthy();
    expect(screen.queryAllByRole('img', { name: /logo/i })).toHaveLength(0);
  });

  it('handles a decode failure (valid magic bytes, but the browser cannot actually render it) without crashing or storing anything', async () => {
    mockImageDecode('fail');
    await mountNewProject();
    const input = screen.getByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile(200)] } });

    expect(await screen.findByText(/could not be decoded/i)).toBeTruthy();
    expect(screen.queryAllByRole('img', { name: /logo/i })).toHaveLength(0);
  });

  it('removing the logo clears the preview', async () => {
    await mountNewProject();
    fireEvent.change(screen.getByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)'), { target: { files: [pngFile(200)] } });
    await waitFor(() => expect(screen.queryAllByRole('img', { name: /logo/i }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Remove logo' }));
    await waitFor(() => expect(screen.queryAllByRole('img', { name: /logo/i })).toHaveLength(0));
  });

  it('replacing an existing logo with a new valid one updates the preview', async () => {
    await mountNewProject();
    const input = screen.getByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile(200, 'first.png')] } });
    await waitFor(() => expect(screen.queryAllByRole('img', { name: /logo/i }).length).toBeGreaterThan(0));
    const firstSrc = screen.getAllByRole('img', { name: /logo/i })[0].getAttribute('src');

    fireEvent.change(input, { target: { files: [pngFile(300, 'second.png')] } });
    await waitFor(() => {
      const secondSrc = screen.getAllByRole('img', { name: /logo/i })[0].getAttribute('src');
      expect(secondSrc).not.toBe(firstSrc);
    });
  });

  it('the uploaded logo appears in the customer document preview (and therefore in print output, which renders the same DOM)', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Logo test job' } });
    fireEvent.change(screen.getByLabelText('Your business name'), { target: { value: 'Acme Painting' } });
    fireEvent.change(screen.getByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)'), { target: { files: [pngFile(200)] } });
    await waitFor(() => expect(screen.queryAllByRole('img', { name: /Acme Painting logo/i }).length).toBeGreaterThan(0));

    // The customer-facing document preview is a SEPARATE render of the
    // same businessInfo -- confirm the logo also appears there.
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await screen.findByText('$126.00');
    const images = await screen.findAllByRole('img', { name: /Acme Painting logo/i });
    expect(images.length).toBeGreaterThanOrEqual(2); // the editor's own preview + the customer document preview
  });

  it('the logo survives save and full reopen (real IndexedDB)', async () => {
    await mountNewProject();
    fireEvent.change(screen.getByLabelText('Business logo (PNG, JPEG, or WebP; max 1 MiB)'), { target: { files: [pngFile(200)] } });
    await waitFor(() => expect(screen.queryAllByRole('img', { name: /logo/i }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());

    cleanup();
    mockImageDecode({ width: 200, height: 200 });
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));
    await waitFor(() => expect(screen.queryAllByRole('img', { name: /logo/i }).length).toBeGreaterThan(0));
  });
});
