// ITEM 9 regression: EstimateTemplate.tsx silently swallowed every
// localStorage failure while the UI unconditionally claimed "saved
// locally in your browser," and a corrupted stored value was silently
// discarded and replaced with a fresh draft with no indication anything
// was ever wrong. These tests drive the actual exported storage functions
// against a stubbed localStorage, not a reimplementation of their logic.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadStoredDrafts, persistDrafts } from '../../src/components/tools/estimateTemplateStorage';

function makeMemoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('loadStoredDrafts', () => {
  it('reports "empty" (not "corrupted") for a genuine first visit — no stored key at all', () => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
    expect(loadStoredDrafts()).toEqual({ status: 'empty' });
  });

  it('loads a well-formed stored value', () => {
    const stored = { drafts: [{ id: 'd1' }], activeDraftId: 'd1' };
    vi.stubGlobal('localStorage', makeMemoryStorage({ pep_free_estimate_drafts_v1: JSON.stringify(stored) }));
    expect(loadStoredDrafts()).toEqual({ status: 'loaded', drafts: stored.drafts, activeDraftId: 'd1' });
  });

  it('REGRESSION: distinguishes a corrupted stored value from a first visit, and preserves the raw bytes under a backup key rather than silently discarding them', () => {
    const storage = makeMemoryStorage({ pep_free_estimate_drafts_v1: '{not valid json' });
    vi.stubGlobal('localStorage', storage);
    const result = loadStoredDrafts();
    expect(result.status).toBe('corrupted');
    if (result.status === 'corrupted') {
      expect(result.backupKey).not.toBeNull();
      expect(storage.getItem(result.backupKey!)).toBe('{not valid json'); // the original bytes are recoverable
    }
  });

  it('a well-formed JSON value with the wrong shape (missing drafts array) is also reported as corrupted, not silently accepted', () => {
    vi.stubGlobal('localStorage', makeMemoryStorage({ pep_free_estimate_drafts_v1: JSON.stringify({ somethingElse: true }) }));
    expect(loadStoredDrafts().status).toBe('corrupted');
  });

  it('an empty drafts array is treated as corrupted/invalid, never a silently-accepted valid state', () => {
    vi.stubGlobal('localStorage', makeMemoryStorage({ pep_free_estimate_drafts_v1: JSON.stringify({ drafts: [], activeDraftId: 'x' }) }));
    expect(loadStoredDrafts().status).toBe('corrupted');
  });

  it('storage being completely inaccessible (getItem itself throws) is treated as empty, not a crash', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(loadStoredDrafts()).toEqual({ status: 'empty' });
  });
});

describe('persistDrafts', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
  });

  it('reports "saved" on a successful write', () => {
    expect(persistDrafts([{ id: 'd1' } as never], 'd1')).toEqual({ status: 'saved' });
  });

  it('REGRESSION: reports "failed" (not silent success) when the underlying storage write throws — e.g. quota exceeded', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
    });
    const result = persistDrafts([{ id: 'd1' } as never], 'd1');
    expect(result.status).toBe('failed');
  });

  it('a failed write never touches the previously committed value — the prior save stays intact', () => {
    const storage = makeMemoryStorage({ pep_free_estimate_drafts_v1: JSON.stringify({ drafts: [{ id: 'old' }], activeDraftId: 'old' }) });
    vi.stubGlobal('localStorage', {
      ...storage,
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
    });
    persistDrafts([{ id: 'new' } as never], 'new');
    // Re-read via the ORIGINAL storage object (not the failing stub) to confirm nothing changed underneath.
    expect(JSON.parse(storage.getItem('pep_free_estimate_drafts_v1')!)).toEqual({ drafts: [{ id: 'old' }], activeDraftId: 'old' });
  });
});
