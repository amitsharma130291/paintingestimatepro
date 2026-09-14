# Authoritative data and lifecycle contract — schemaVersion 2

Canonical decimal strings and ratios follow CALCULATION_SPEC.md. IDs are stable UUID-like strings, never array positions. All records include createdAt/updatedAt ISO timestamps. Input validators reject unknown enums and unsafe types; text is rendered as text, never interpreted as HTML. Keep original imported data unmodified until validation succeeds.

## Entities (required unless explicitly optional)
BusinessSettings: id, loadedHourlyRate (nullable until configured), overheadRatio, targetMarginRatio, defaultCoats, defaultWasteRatio, wallThroughput, ceilingThroughput, trimThroughput, doorHoursPerSidePerCoat, defaultTravelAmount, defaultSuppliesAllowance {mode:none|flat|paintPercent, amount, ratio}, sampleAssumptionsConfirmed boolean.
Defaults seed geometry/rates per calculation contract; defaultTravelAmount=0 and supplies mode=none. An explicit sample dataset is separate from a real project.
PaintVariant: id, name, color, sheen, pricePerGal, coverageFt2PerGal, purchaseIncrementGal="1". Color/sheen can be 'unspecified' only if explicitly chosen; variant identity determines pooling. At most one value set per ID in a snapshot. Renaming a live variant never changes old snapshots.
OtherMaterial: id, name, unit, unitCost.
ServiceDefinition: id, name, unit (ft2|linearFt|door), kind (wall|ceiling|trim|door), paintVariantId, coats, wasteRatio, loadedHourlyRate, throughput (wall/ceiling/trim only), hoursPerSidePerCoat (door only), developedWidthFt (trim only), widthFt/heightFt/paintedSides (door only), additionalLaborHoursPerUnit, suppliesCostPerUnit, directExpensePerUnit, currentSellingPrice nullable. Labor and overhead defaults are copied to editable service assumptions; expose an explicit refresh-defaults action. Global current overhead/target apply to health; material price/coverage resolve live.
Room: id, name, lengthFt/widthFt/heightFt (nullable draft), deductionEnabled, openingMode quick|detailed, quick {doorCount,windowCount,doorAreaEach,windowAreaEach}, openings [{id,type,widthFt,heightFt,count}], surfaceIds[]. Inactive opening mode ignored.
Surface: id, roomId nullable, kind, enabled, measurementMode roomDerived|manual, areaFt2 (manual wall/ceiling), trimLengthFt/developedWidthFt (trim), doorCount/widthFt/heightFt/paintedSides (door), paintVariantId, coats, wasteRatio, loadedHourlyRate, throughput or hoursPerSidePerCoat. Required fields depend on enabled/kind/mode. Room-derived only for wall/ceiling; trim/door measurements explicit. Standalone surfaces have roomId=null.
RateSnapshot: id, capturedAt, sourceSettingsId, sourceCatalogRevision, engineVersion, full copies of business settings, material variants and selected other-material prices, plus any service assumptions actually used. Snapshot is self-contained. Surface-specific overrides are inside the revision, not pointers to live defaults.
EstimateRevision: id, projectId, revisionNumber, state draft|issued|superseded, title, businessInfo, customerInfo, room/surface arrays, activeRateSnapshot, additionalLabor[], otherMaterialLines[], suppliesAllowance, otherExpenses[], priceMode suggested|custom, proposedPrice nullable, notes, terms, calculationState, engineVersion, rawCalculatedOutputs (optional until valid), customerDocumentSnapshot (on issue), issuedAt nullable.
additionalLabor line: id, description, hours, loadedHourlyRate.
otherMaterial line: id, description, sourceMaterialId nullable, unit, quantity, unitCost snapshot.
expense line: id, description, amount. Travel is one explicit line.
Project: id, title, revisions[], activeRevisionId, actualReviews[].
Document metadata: estimateNumber string, estimateDate, projectAddress optional, businessInfo {name,contact,address,logo optional}, customerInfo {name,address,contact}, scope/notes/terms. Strings may be blank in draft. Priced issue needs a project title and at least one enabled valid surface, and confirmed assumptions; buyer/customer omission warns but does not silently insert fiction.

## Drafts, issue, and revisions
1. New draft copies current settings/catalog to its activeRateSnapshot. Draft autosave persists its OWN snapshot and changes; it does not recopy the live catalog.
2. Reopen a draft or issued revision using its embedded snapshot, even if a catalog variant was deleted.
3. Explicit 'refresh with current rates' on draft previews changed rates and resulting price/margin. Unresolved deleted variants require a replacement or retaining the snapshot variant; never replace by name. Confirm before applying. Keep a recoverable pre-refresh draft snapshot.
4. Issue validates complete inputs, resolves price, confirms sample assumptions and zero-price if applicable, then freezes inputs, rates, outputs, and customer document. Store engineVersion. Subsequent view/print uses the issued snapshot, not today's engine results.
5. Editing, deleting a room, changing price, or refreshing rates on an issued estimate creates a new draft revision. Preserve the original. Only explicit issue supersedes the previous issued revision. Actual reviews stay linked to the chosen issued revision.
6. A duplicate project gets fresh project/revision/room/surface/line IDs and remapped references; it copies rates by default, drops issued state, documents/actuals, and clears estimate number. It never shares mutable arrays with its source.
7. Engine upgrades may migrate schemas but must not recalculate historical issued output automatically. New recalculation creates a draft revision with a new engineVersion.

## Actual review
ActualReview: id, projectId, baselineIssuedRevisionId, state inProgress|final, materials/labor/otherExpenses categories each {confirmed:boolean, amount:decimal|null}; optional laborBreakdown {mode:direct|hoursRate,hours,rate}; overhead {mode:baselineAllocation|actualFlat, confirmed:boolean, amount:decimal|null}; updatedAt.
Use one authoritative active labor mode; no stale values contribute. baselineAllocation amount is the baseline issued overhead, explicitly labeled and confirmed. Finalization requires all four categories confirmed and nonnull (explicit zero allowed).
Final revenue basis is original issued pre-tax proposedPrice, NOT payment receipts. Compute margin = (baselinePrice - actualCost) / baselinePrice whenever baselinePrice > 0, including losses; baselinePrice = 0 yields margin null and retains the loss amount. Missing baseline price is invalid for an issued baseline. Label 'profit against original quoted price'; change orders/actual revenue collection are out of v1. Partial review shows recorded costs and category completeness only; no final profit, margin, or total variance.

## Backup envelope
{schemaVersion:2, exportId, exportedAt, installationId, engineVersion, businessSettings, paintVariants:[], otherMaterials:[], serviceDefinitions:[], projects:[], importProvenance:[]}.
Each project includes all revisions, snapshots, issued document data, actual reviews, stable IDs, and links. Include normalized local logo bytes if supported; no remote/private file dependency. Exclude payment secrets, license tokens, analytics identifiers. Access recovery is separate.
Use transactional local persistence (e.g. IndexedDB) for multi-record operations. On quota/storage error, leave previous committed state intact and show an actionable save/backup message. Never claim 'saved' on failure.
Import file limit 25 MiB, logo max 1 MiB each; limits may be raised explicitly after testing. Validate all schemas, required fields, decimal ranges, object counts, duplicate IDs, snapshots, referenced IDs, and supported schema/engine display compatibility before writes. Version 1 backups unsupported until an explicit tested migrator exists; newer versions rejected. No silent migration guesses.

Import modes:
- Restore/merge (default): preserve IDs; identical existing records skip; new IDs add. Conflicting content at same ID requires explicit keep-local, replace-imported, or keep-both per project/settings group. Default keep-local. Preserve original snapshot references. No automatic timestamp-wins rule.
- Import as copies: new IDs throughout each imported graph, remap all links including baseline revision. Keep importProvenance keyed by exportId + sourceProjectId. On repeat same import show 'already imported' and skip unless user explicitly asks for another copy; no automatic upsert into locally edited copies.
- Replace all: explicit confirmation, downloadable pre-import backup, atomic replacement after full validation.
A failed import never partly changes the store. Settings/catalog collisions are resolved alongside projects, not matched by name+price. Identical names with different coverage/color remain distinct variants.
