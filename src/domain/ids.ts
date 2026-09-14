// Injectable ID/clock sources so lifecycle tests can be deterministic
// (TDD_WORKFLOW.md: "Factories need deterministic IDs/time"). Production
// code uses `defaultIdSource`; tests construct a `sequentialIdSource()`.

export interface IdSource {
  nextId(): string;
  now(): string;
}

let counter = 0;

export const defaultIdSource: IdSource = {
  nextId: () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${++counter}-${Date.now()}`),
  now: () => new Date().toISOString(),
};

export function sequentialIdSource(startTime = '2026-01-01T00:00:00.000Z'): IdSource {
  let seq = 0;
  let clock = new Date(startTime).getTime();
  return {
    nextId: () => `test-id-${++seq}`,
    now: () => {
      clock += 1000;
      return new Date(clock).toISOString();
    },
  };
}
