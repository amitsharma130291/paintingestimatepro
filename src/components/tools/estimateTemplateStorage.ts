// localStorage persistence for the free estimate template — split out from
// EstimateTemplate.tsx (a .tsx file, which this test suite's Vitest/esbuild
// config cannot import directly) so it's independently testable against a
// stubbed localStorage, matching estimateTemplateLogic.ts's existing
// pure-module pattern.
import type { EstimateDraft } from './estimateTemplateLogic';

const STORAGE_KEY = 'pep_free_estimate_drafts_v1';

export type LoadDraftsResult =
  | { status: 'loaded'; drafts: EstimateDraft[]; activeDraftId: string }
  | { status: 'empty' } // no prior save at all -- a genuine first visit
  | { status: 'corrupted'; backupKey: string | null }; // a save existed but couldn't be read back

/**
 * ITEM 9 fix: distinguishes "nothing was ever saved" from "something was
 * saved but is now unreadable" — the old version collapsed both into a
 * silent `null`, so a corrupted save looked identical to a first visit and
 * the corrupted data was discarded with no trace. The raw corrupted value
 * is preserved under a timestamped backup key (best-effort — if THAT write
 * also fails, `backupKey` is null but nothing has been made worse) rather
 * than silently overwritten the next time a draft is saved.
 */
export function loadStoredDrafts(): LoadDraftsResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { status: 'empty' }; // storage inaccessible entirely -- nothing to recover from
  }
  if (raw === null) return { status: 'empty' };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.drafts) || parsed.drafts.length === 0 || typeof parsed.activeDraftId !== 'string') {
      throw new Error('Stored estimate data has an unexpected shape.');
    }
    return { status: 'loaded', drafts: parsed.drafts, activeDraftId: parsed.activeDraftId };
  } catch {
    let backupKey: string | null = `${STORAGE_KEY}_corrupted_backup_${Date.now()}`;
    try {
      localStorage.setItem(backupKey, raw);
    } catch {
      backupKey = null; // best-effort only -- still report 'corrupted' honestly either way
    }
    return { status: 'corrupted', backupKey };
  }
}

export type PersistResult = { status: 'saved' } | { status: 'failed'; reason: string };

/**
 * ITEM 9 fix: previously swallowed every failure silently while the UI
 * unconditionally claimed "saved locally in your browser" regardless of
 * whether this actually succeeded. Now reports success/failure so the
 * caller can show the truth and offer a retry — never claims saved
 * without a completed write. A failed `setItem` call never partially
 * writes (the platform guarantee for a single key), so the PREVIOUS
 * committed value is always left intact on failure.
 */
export function persistDrafts(drafts: EstimateDraft[], activeDraftId: string): PersistResult {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ drafts, activeDraftId }));
    return { status: 'saved' };
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : 'Local storage is unavailable.' };
  }
}
