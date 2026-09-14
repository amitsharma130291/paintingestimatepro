// BACK-D12: quota/transaction failure leaves the previous committed store
// intact; the app never claims success on a failed write. Uses
// fake-indexeddb (a real IndexedDB implementation, not a hand-rolled
// mock) so transaction semantics are genuine, not simulated.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openAppDb, writeAll, readAll, STORES, SaveFailedError } from '../../src/storage/db';
import type { IDBPDatabase } from 'idb';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // no open connections should remain (closed in afterEach)
  });
}

describe('storage/db: transactional writes', () => {
  let db: IDBPDatabase;

  beforeEach(async () => {
    // fresh DB per test — the PREVIOUS test's connection is closed in
    // afterEach first, so this never blocks waiting for it to release.
    await deleteDatabase('painting-estimate-pro');
    db = await openAppDb();
  });

  afterEach(() => {
    db.close();
  });

  it('D-storage-01: writeAll commits every record across multiple stores together', async () => {
    await writeAll(db, [
      { store: STORES.paintVariants, records: [{ id: 'v1', name: 'White' } as never] },
      { store: STORES.businessSettings, records: [{ id: 's1', overheadRatio: '0.15' } as never] },
    ]);
    expect((await readAll(db, STORES.paintVariants)).length).toBe(1);
    expect((await readAll(db, STORES.businessSettings)).length).toBe(1);
  });

  it('D-storage-02 (BACK-D12): a failure partway through a multi-record write leaves the store as it was before — no partial write', async () => {
    // Seed one committed variant first.
    await writeAll(db, [{ store: STORES.paintVariants, records: [{ id: 'existing' } as never] }]);

    // Now attempt a batch of 3 additional variants, where the 2nd one is
    // deliberately malformed (missing the keyPath field) so IndexedDB
    // itself rejects that `put` and the surrounding transaction aborts.
    const batch = [{ id: 'v-ok-1' }, { name: 'no id field, will throw' }, { id: 'v-ok-2' }] as unknown as { id: string }[];

    await expect(writeAll(db, [{ store: STORES.paintVariants, records: batch }])).rejects.toBeInstanceOf(SaveFailedError);

    const after = await readAll<{ id: string }>(db, STORES.paintVariants);
    // Only the pre-existing record — none of v-ok-1/v-ok-2 partially committed.
    expect(after.map((r) => r.id)).toEqual(['existing']);
  });

  it('D-storage-03: a failure in one store rolls back writes already queued for an unrelated store in the SAME call', async () => {
    const batch = [{ id: 'p1' }, { noIdField: true }] as unknown as { id: string }[];
    await expect(
      writeAll(db, [
        { store: STORES.businessSettings, records: [{ id: 'settings-should-not-persist' } as never] },
        { store: STORES.paintVariants, records: batch },
      ])
    ).rejects.toBeInstanceOf(SaveFailedError);

    expect(await readAll(db, STORES.businessSettings)).toHaveLength(0);
    expect(await readAll(db, STORES.paintVariants)).toHaveLength(0);
  });
});
