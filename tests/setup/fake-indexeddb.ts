// Gives storage/db.ts a real IndexedDB implementation under Node so
// integration tests exercise actual transaction semantics instead of a hand
// rolled in-memory stand-in.
import 'fake-indexeddb/auto';
