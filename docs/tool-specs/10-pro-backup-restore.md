# Pro backup/restore — v2.1

The authoritative envelope, IDs, validation, import modes, limits, and conflict policy are in ../DATA_CONTRACT.md.

Export complete projects/revisions/snapshots/actuals, catalogs/services/settings and required local assets with schema/engine versions. Exclude license secrets and payment data. Explain that browser-local persistence is not a backup and may be lost if browser data is cleared.

Import flow:
1. Parse file within supported limits, without mutating storage.
2. Validate complete shape, types/ranges, enums, graph references, versions, and unique IDs.
3. Choose restore/merge (default), import as copies, or replace all.
4. Preview additions/skips/conflicts; collect explicit conflict choices. No name+price matching.
5. Provide pre-import backup for destructive replacement.
6. Commit transaction; on any error rollback and report 'not imported'.
7. Confirm record counts actually committed; record provenance.

Repeated identical restore skips identical records; conflicting locally edited data requires choices. Repeated import-as-copies skips prior source IDs for same export unless explicitly duplicated. New copied IDs remap all children/actual baselines, not only project IDs.

Test quota failure, transaction failure, truncated file, duplicate IDs, missing snapshots, dangling actual baseline, unsupported version, catalog ID conflict, repeat import, and live-deleted catalog items embedded in snapshots. Every failure leaves original committed store unchanged.
