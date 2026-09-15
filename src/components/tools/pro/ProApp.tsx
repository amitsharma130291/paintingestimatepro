import { useEffect, useMemo, useState } from 'react';
import { PEP, type Dec } from '../../../engine/decimal';
import { evaluateActualReview, type ActualCategory } from '../../../engine/actuals';
import { parseDecimalField, MAX_AGGREGATE_MONETARY, MAX_AGGREGATE_HOURS, MAX_RATE } from '../../../engine/parse';
import { assembleServiceHealth, type ServiceHealthAssemblyResult } from '../../../domain/serviceHealthAssembly';
import { statusBadge, money, parseCoatsInput, parseOpeningCountInput } from '../shared';
import type { BusinessSettings, PaintVariant, OtherMaterial, ServiceDefinition, Project, Room, Surface, EstimateRevision, ServiceKind, BackupEnvelope, AdditionalLaborLine, OtherMaterialLine, ExpenseLine } from '../../../domain/entities';
import { ENGINE_VERSION } from '../../../domain/entities';
import { freezeCalculatedOutputs, readFrozenCalculatedOutputs } from '../../../domain/calculationSnapshot';
import { createSnapshot } from '../../../domain/snapshot';
import { createDraftRevision, issueRevision, createDraftFromIssued, checkIssueGate, updateRoom, removeRoom, moveRoom, moveSurfaceWithinGroup, upsertRevision, upsertActualReview, supersede } from '../../../domain/project';
import type { ActualReview } from '../../../domain/entities';
import { assembleProjectEstimate, type ProjectEstimateAssembly } from '../../../domain/estimateAssembly';
import { previewRateRefresh, applyRateRefresh, undoRateRefresh as undoRateRefreshDomain, type RateRefreshDiff, type VariantResolution } from '../../../domain/rateRefresh';
import { previewServiceDefaultsRefresh, applyServiceDefaultsRefresh, type ServiceRefreshDiff, type ServiceRefreshableField } from '../../../domain/serviceRefresh';
import { buildCustomerDocument } from '../../../domain/customerDocument';
import {
  exportBackup, validateBackupEnvelope, planFullRestoreMerge, planImportAsCopies, applyFullRestoreResolutions,
  type FullRestorePlan, type ImportConflict,
} from '../../../domain/backup';
import { defaultIdSource } from '../../../domain/ids';
import { readInteriorHandoff, clearInteriorHandoff, buildProjectFromInteriorHandoff, type InteriorHandoffPayload, type HandoffFieldNote } from '../../../domain/interiorHandoff';
import { ConflictError } from '../../../storage/db';
import { validateLogoBytes, MAX_LOGO_DIMENSION_PX } from '../../../domain/logo';
import { reconcileDisplayedComponents } from '../../../engine/document';

/** DOC-010: dimension limits require an actual browser image decode
 * (Image.onload), unlike the byte-level format/size checks in
 * domain/logo.ts, which are pure. Kept as a standalone, mockable
 * function so tests can simulate both a real decode's success and a
 * "decode failure" (a payload that passed the magic-number check but
 * isn't actually a valid image the browser can render). */
function decodeImageDimensions(dataUri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('The image could not be decoded.'));
    img.src = dataUri;
  });
}
import { loadSnapshot, saveBusinessSettings, savePaintVariants, saveProjectSafely, saveImportedBackup, saveReplaceAllBackup, saveServiceDefinition, deleteServiceDefinition, deleteProject } from './proStore';

const ids = defaultIdSource;
const now = () => new Date().toISOString();

function defaultSettings(): BusinessSettings {
  const t = now();
  return {
    id: 'default-settings',
    loadedHourlyRate: '32',
    overheadRatio: '0.15',
    targetMarginRatio: '0.35',
    defaultCoats: 2,
    defaultWasteRatio: '0.10',
    wallThroughput: '150',
    ceilingThroughput: '120',
    trimThroughput: '40',
    doorHoursPerSidePerCoat: '0.75',
    defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' },
    sampleAssumptionsConfirmed: false,
    createdAt: t,
    updatedAt: t,
  };
}

function blankSurface(kind: ServiceKind, roomId: string | null, measurementMode: 'roomDerived' | 'manual', paintVariantId: string): Surface {
  return {
    id: ids.nextId(), roomId, kind, enabled: true, measurementMode,
    areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: kind === 'door' ? 1 : null,
    widthFt: null, heightFt: null, paintedSides: kind === 'door' ? 2 : null,
    paintVariantId, coats: null, wasteRatio: null, loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
  };
}

function blankRoom(name: string): Room {
  return {
    id: ids.nextId(), name, lengthFt: null, widthFt: null, heightFt: null,
    deductionEnabled: false, openingMode: 'quick', quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' },
    openings: [], surfaceIds: [],
  };
}

type Tab = 'settings' | 'catalog' | 'projects' | 'health' | 'actuals' | 'backup';

export default function ProApp() {
  const [tab, setTab] = useState<Tab>('projects');
  const [loading, setLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  // DOC-010: a rejected upload's reason -- never silently ignored.
  const [logoError, setLogoError] = useState<string | null>(null);

  const [settings, setSettings] = useState<BusinessSettings>(defaultSettings());
  const [catalog, setCatalog] = useState<PaintVariant[]>([]);
  // independent-review R08: Price Book Health previously never read any
  // persisted ServiceDefinition at all.
  const [serviceDefinitions, setServiceDefinitions] = useState<ServiceDefinition[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  // LIFE-014: which project (if any) is showing its inline "are you sure"
  // delete confirmation -- an explicit second step, never a single click.
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<string | null>(null);
  // HEALTH-016: which Price Book Health rows have their detail breakdown expanded.
  const [expandedServiceIds, setExpandedServiceIds] = useState<Set<string>>(new Set());
  const [draftEdit, setDraftEdit] = useState<EstimateRevision | null>(null);
  const [draftBaselineVersion, setDraftBaselineVersion] = useState<number | null>(null);
  const [customPriceRaw, setCustomPriceRaw] = useState('');
  // independent-review R07: the issue gate always received
  // zeroPriceConfirmed: false with no UI to ever satisfy it — a $0
  // estimate could never be issued at all. Resets whenever the open
  // draft changes so a stale confirmation from a DIFFERENT project never
  // silently carries over.
  const [zeroPriceConfirmed, setZeroPriceConfirmed] = useState(false);
  const [conflict, setConflict] = useState<{ project: Project; attempted: Project } | null>(null);
  const [refreshPreview, setRefreshPreview] = useState<{ diff: RateRefreshDiff; resolutions: Record<string, VariantResolution> } | null>(null);

  const [actuals, setActuals] = useState<Record<'materials' | 'labor' | 'otherExpenses' | 'overhead', { confirmed: boolean; amount: string }>>({
    materials: { confirmed: false, amount: '' },
    labor: { confirmed: false, amount: '' },
    otherExpenses: { confirmed: false, amount: '' },
    overhead: { confirmed: false, amount: '' },
  });
  // ACT-010 (DATA_CONTRACT.md): overhead has two explicit modes -- confirm
  // the baseline issued revision's OWN allocated overhead unedited, or
  // enter a real actual dollar figure. Defaults to baselineAllocation, the
  // spec's labeled default ("Label baseline overhead as allocated").
  const [overheadMode, setOverheadMode] = useState<'baselineAllocation' | 'actualFlat'>('baselineAllocation');
  // ACT-011 (DATA_CONTRACT.md): actual labor may be entered directly as a
  // dollar amount, or as hours x rate -- the domain model already defined
  // laborBreakdown for this, but no UI ever exposed the hoursRate mode; every
  // review was silently forced through a single flat-amount box.
  const [laborMode, setLaborMode] = useState<'direct' | 'hoursRate'>('direct');
  const [laborHours, setLaborHours] = useState('');
  const [laborRate, setLaborRate] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  type PendingImport =
    | { mode: 'merge'; envelope: BackupEnvelope; plan: FullRestorePlan; resolutions: Record<string, ImportConflict['resolution']>; existingOtherMaterials: OtherMaterial[]; existingServiceDefinitions: ServiceDefinition[]; existingProjectVersions: Record<string, number> }
    | { mode: 'copies'; envelope: BackupEnvelope; alreadyImportedSourceIds: string[]; forcedSourceIds: string[] }
    | { mode: 'replaceAll'; envelope: BackupEnvelope; backupDownloaded: boolean };
  const [importMode, setImportMode] = useState<'merge' | 'copies' | 'replaceAll'>('merge');
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<InteriorHandoffPayload | null>(null);
  const [handoffPreviewNotes, setHandoffPreviewNotes] = useState<HandoffFieldNote[] | null>(null);

  useEffect(() => {
    loadSnapshot()
      .then((snap) => {
        if (snap.businessSettings[0]) setSettings(snap.businessSettings[0]);
        if (snap.paintVariants.length) setCatalog(snap.paintVariants);
        if (snap.projects.length) setProjects(snap.projects);
        setServiceDefinitions(snap.serviceDefinitions);
      })
      .catch(() => {
        /* fresh install — defaults stand */
      })
      .finally(() => setLoading(false));
    // UX-013: this component only ever renders after ProGate's own real
    // entitlement check has passed — reading a pending free-tool handoff
    // here never grants access on its own, it only offers to import data
    // once the visitor is already unlocked through the normal paywall.
    setPendingHandoff(readInteriorHandoff());
  }, []);

  function declineHandoff() {
    clearInteriorHandoff();
    setPendingHandoff(null);
  }

  async function acceptHandoff() {
    if (!pendingHandoff) return;
    const liveSnapshot = currentLiveSnapshot(`live-${now()}`);
    const built = buildProjectFromInteriorHandoff(pendingHandoff, liveSnapshot, ids);
    const nextCatalog = [...catalog, built.variant];
    const revisionWithVariant = { ...built.revision, activeRateSnapshot: { ...built.revision.activeRateSnapshot, paintVariants: [...built.revision.activeRateSnapshot.paintVariants, built.variant] } };
    const project: Project = { id: revisionWithVariant.projectId, title: 'Room from free calculator', revisions: [revisionWithVariant], activeRevisionId: revisionWithVariant.id, actualReviews: [], createdAt: now(), updatedAt: now(), version: 1 };
    setCatalog(nextCatalog);
    setProjects((ps) => [...ps, project]);
    let committedVersion: number | null = null;
    try {
      await savePaintVariants(nextCatalog);
      committedVersion = await saveProjectSafely(project, null);
      setSaveMessage('Imported the room from your free calculator result.');
    } catch {
      setSaveMessage('Imported locally, but saving failed — try Save draft again from the project.');
    }
    setActiveProjectId(project.id);
    setDraftEdit(revisionWithVariant);
    setDraftBaselineVersion(committedVersion);
    setCustomPriceRaw('');
    setTab('projects');
    setHandoffPreviewNotes(built.unsupportedFieldNotes);
    clearInteriorHandoff();
    setPendingHandoff(null);
  }

  async function persistSettings(next: BusinessSettings) {
    setSettings(next);
    try {
      await saveBusinessSettings(next);
      setSaveMessage('Saved.');
    } catch {
      setSaveMessage('Save failed — your previous settings were not changed.');
    }
  }

  async function persistCatalog(next: PaintVariant[]) {
    setCatalog(next);
    try {
      await savePaintVariants(next);
      setSaveMessage('Saved.');
    } catch {
      setSaveMessage('Save failed — your previous catalog was not changed.');
    }
  }

  function addPaintVariant() {
    const t = now();
    persistCatalog([...catalog, { id: ids.nextId(), name: `Paint ${catalog.length + 1}`, color: 'unspecified', sheen: 'eggshell', pricePerGal: '45', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: t, updatedAt: t }]);
  }

  function currentLiveSnapshot(catalogRevisionLabel: string) {
    return createSnapshot(settings, catalog, [], ids, catalogRevisionLabel);
  }

  // ---- Project lifecycle ----
  function newProject() {
    const snapshot = currentLiveSnapshot(`live-${now()}`);
    const revision = createDraftRevision(ids.nextId(), snapshot, ids);
    const project: Project = { id: revision.projectId, title: 'New project', revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: now(), updatedAt: now(), version: 1 };
    setProjects((ps) => [...ps, project]);
    setActiveProjectId(project.id);
    setDraftEdit(revision);
    setDraftBaselineVersion(null); // not yet created in storage — the next save is a create, not an update
    setCustomPriceRaw('');
    setZeroPriceConfirmed(false);
    setRefreshPreview(null);
  }

  // LIFE-014: irreversible, so this is called ONLY after the inline
  // confirmDeleteProjectId prompt has been explicitly confirmed -- never
  // from the list row's own click handler directly. Deleting removes
  // exactly this one project's own record (which embeds its own revisions
  // and actualReviews) via a single-document IndexedDB delete; every
  // other project is untouched by construction.
  function removeProject(projectId: string) {
    setProjects((ps) => ps.filter((p) => p.id !== projectId));
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      setDraftEdit(null);
    }
    setConfirmDeleteProjectId(null);
    deleteProject(projectId).catch(() => setSaveMessage('Removed locally, but deleting from storage failed.'));
  }

  function openProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const revision = project.revisions.find((r) => r.id === project.activeRevisionId) ?? project.revisions[project.revisions.length - 1];
    setActiveProjectId(projectId);
    setDraftEdit(revision);
    setDraftBaselineVersion(project.version);
    setCustomPriceRaw(revision.priceMode === 'custom' ? revision.proposedPrice ?? '' : '');
    setZeroPriceConfirmed(false);
    setRefreshPreview(null);
  }

  function editIssuedAsNewDraft(project: Project, issued: EstimateRevision) {
    const newDraft = createDraftFromIssued(issued, ids);
    setActiveProjectId(project.id);
    setDraftEdit(newDraft);
    setDraftBaselineVersion(project.version);
    setCustomPriceRaw(newDraft.priceMode === 'custom' ? newDraft.proposedPrice ?? '' : '');
    setZeroPriceConfirmed(false);
    setRefreshPreview(null);
  }

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const summary: ProjectEstimateAssembly | null = useMemo(() => {
    if (!draftEdit) return null;
    return assembleProjectEstimate(draftEdit, { priceMode: draftEdit.priceMode, customPriceRaw });
  }, [draftEdit, customPriceRaw]);

  function mutateDraft(fn: (r: EstimateRevision) => EstimateRevision) {
    setDraftEdit((r) => (r ? fn(r) : r));
  }

  // DOC-010: format/size are checked from the file's own BYTES before
  // anything else happens (never trusts file.type or the filename);
  // dimensions are checked only after that passes, via an actual decode,
  // so a payload that sniffs as a valid PNG/JPEG/WebP but that the
  // browser still can't render is caught as a decode failure rather than
  // silently stored. Never writes anything to the draft on any failure.
  async function handleLogoFileChange(file: File) {
    setLogoError(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = validateLogoBytes(bytes);
    if (!result.ok) {
      setLogoError(result.error.message);
      return;
    }
    try {
      const { width, height } = await decodeImageDimensions(result.dataUri);
      if (width > MAX_LOGO_DIMENSION_PX || height > MAX_LOGO_DIMENSION_PX) {
        setLogoError(`Image is ${width}x${height}px; the maximum is ${MAX_LOGO_DIMENSION_PX}x${MAX_LOGO_DIMENSION_PX}px.`);
        return;
      }
    } catch {
      setLogoError('The image could not be decoded — the file may be corrupt.');
      return;
    }
    mutateDraft((r) => ({ ...r, businessInfo: { ...r.businessInfo, logo: result.dataUri }, updatedAt: ids.now() }));
  }

  function removeLogo() {
    setLogoError(null);
    mutateDraft((r) => {
      const { logo: _dropped, ...rest } = r.businessInfo;
      return { ...r, businessInfo: rest, updatedAt: ids.now() };
    });
  }

  // A draft's own frozen snapshot — not the live catalog — is the correct
  // source of selectable paint variants for its surfaces. A variant added
  // to the live catalog AFTER this draft was created does not exist in the
  // draft's snapshot yet (that is the whole point of the snapshot), so
  // offering it here would let a user pick an option that immediately
  // reads back as "invalid" until they explicitly run a rate refresh.
  const snapshotVariants = draftEdit?.activeRateSnapshot.paintVariants ?? [];

  function addRoom() {
    if (!draftEdit || snapshotVariants.length === 0) return;
    const room = blankRoom(`Room ${draftEdit.rooms.length + 1}`);
    const wall = blankSurface('wall', room.id, 'roomDerived', snapshotVariants[0].id);
    room.surfaceIds = [wall.id];
    mutateDraft((r) => ({ ...r, rooms: [...r.rooms, room], surfaces: [...r.surfaces, wall], updatedAt: ids.now() }));
  }

  function addCeilingToRoom(room: Room) {
    if (!draftEdit || snapshotVariants.length === 0) return;
    const ceiling = blankSurface('ceiling', room.id, 'roomDerived', snapshotVariants[0].id);
    mutateDraft((r) => ({
      ...r,
      rooms: r.rooms.map((rm) => (rm.id === room.id ? { ...rm, surfaceIds: [...rm.surfaceIds, ceiling.id] } : rm)),
      surfaces: [...r.surfaces, ceiling],
      updatedAt: ids.now(),
    }));
  }

  function patchRoom(roomId: string, patch: Partial<Room>) {
    mutateDraft((r) => updateRoom(r, roomId, patch, ids));
  }

  function deleteRoom(roomId: string) {
    mutateDraft((r) => removeRoom(r, roomId, ids));
  }

  // PRO-014: display order only -- room/surface ids, surfaceIds cross-
  // references, and every calculated value are completely unaffected.
  function moveRoomUpDown(roomId: string, direction: 'up' | 'down') {
    mutateDraft((r) => moveRoom(r, roomId, direction, ids));
  }

  function moveSurfaceUpDown(surfaceId: string, direction: 'up' | 'down') {
    mutateDraft((r) => moveSurfaceWithinGroup(r, surfaceId, direction, ids));
  }

  function patchSurface(surfaceId: string, patch: Partial<Surface>) {
    mutateDraft((r) => ({ ...r, surfaces: r.surfaces.map((s) => (s.id === surfaceId ? { ...s, ...patch } : s)), updatedAt: ids.now() }));
  }

  function removeSurface(surfaceId: string) {
    mutateDraft((r) => ({
      ...r,
      surfaces: r.surfaces.filter((s) => s.id !== surfaceId),
      rooms: r.rooms.map((rm) => ({ ...rm, surfaceIds: rm.surfaceIds.filter((id) => id !== surfaceId) })),
      updatedAt: ids.now(),
    }));
  }

  function addStandaloneSurface(kind: 'trim' | 'door') {
    if (!draftEdit || snapshotVariants.length === 0) return;
    const s = blankSurface(kind, null, 'manual', snapshotVariants[0].id);
    mutateDraft((r) => ({ ...r, surfaces: [...r.surfaces, s], updatedAt: ids.now() }));
  }

  // ---- Additional project costs: prep/additional labor, itemized other
  // materials, supplies allowance, and other direct expenses (including
  // travel). Independent review: "The main Pro project editor does not
  // expose the approved additional-labor lines, itemized other materials,
  // supplies allowance, or direct-expense/travel entry... a painter cannot
  // fully itemize the specified preparation time, caulk/materials,
  // supplies, travel, and direct expenses in a new paid estimate through
  // the supplied interface." assembleProjectEstimate already fully
  // consumes these fields (materialsTotal/otherExpensesTotal/
  // additionalLaborCost) -- only the editing UI was missing. ----
  function addAdditionalLabor() {
    mutateDraft((r) => ({ ...r, additionalLabor: [...r.additionalLabor, { id: ids.nextId(), description: '', hours: '', loadedHourlyRate: r.activeRateSnapshot.businessSettings.loadedHourlyRate ?? '' }], updatedAt: ids.now() }));
  }
  function patchAdditionalLabor(id: string, patch: Partial<AdditionalLaborLine>) {
    mutateDraft((r) => ({ ...r, additionalLabor: r.additionalLabor.map((l) => (l.id === id ? { ...l, ...patch } : l)), updatedAt: ids.now() }));
  }
  function removeAdditionalLabor(id: string) {
    mutateDraft((r) => ({ ...r, additionalLabor: r.additionalLabor.filter((l) => l.id !== id), updatedAt: ids.now() }));
  }

  function addOtherMaterialLine() {
    mutateDraft((r) => ({ ...r, otherMaterialLines: [...r.otherMaterialLines, { id: ids.nextId(), description: '', sourceMaterialId: null, unit: '', quantity: '', unitCost: '' }], updatedAt: ids.now() }));
  }
  function patchOtherMaterialLine(id: string, patch: Partial<OtherMaterialLine>) {
    mutateDraft((r) => ({ ...r, otherMaterialLines: r.otherMaterialLines.map((l) => (l.id === id ? { ...l, ...patch } : l)), updatedAt: ids.now() }));
  }
  function removeOtherMaterialLine(id: string) {
    mutateDraft((r) => ({ ...r, otherMaterialLines: r.otherMaterialLines.filter((l) => l.id !== id), updatedAt: ids.now() }));
  }

  function patchSuppliesAllowance(patch: Partial<EstimateRevision['suppliesAllowance']>) {
    mutateDraft((r) => ({ ...r, suppliesAllowance: { ...r.suppliesAllowance, ...patch }, updatedAt: ids.now() }));
  }

  function addOtherExpense() {
    mutateDraft((r) => ({ ...r, otherExpenses: [...r.otherExpenses, { id: ids.nextId(), description: '', amount: '' }], updatedAt: ids.now() }));
  }
  function patchOtherExpense(id: string, patch: Partial<ExpenseLine>) {
    mutateDraft((r) => ({ ...r, otherExpenses: r.otherExpenses.map((l) => (l.id === id ? { ...l, ...patch } : l)), updatedAt: ids.now() }));
  }
  function removeOtherExpense(id: string) {
    mutateDraft((r) => ({ ...r, otherExpenses: r.otherExpenses.filter((l) => l.id !== id), updatedAt: ids.now() }));
  }

  async function saveDraft() {
    if (!draftEdit || !activeProject) return;
    // UX-008: `draftEdit` is captured here at call time. If the user keeps
    // typing while this async save is still in flight, a later edit bumps
    // `updatedAt` again (every mutateDraft call does). Recording that
    // captured value now lets the resolved save below detect whether it is
    // still looking at the SAME edit it started with -- if not, the user's
    // newer keystrokes must never be clobbered by this now-stale result.
    const capturedUpdatedAt = draftEdit.updatedAt;
    const revisionToSave: EstimateRevision = {
      ...draftEdit,
      calculationState: summary?.calculationState ?? 'incomplete',
      proposedPrice: draftEdit.priceMode === 'custom' ? (customPriceRaw.trim() === '' ? null : customPriceRaw) : summary?.effectivePrice?.toFixed(2) ?? null,
    };
    const nextProject: Project = { ...upsertRevision(activeProject, revisionToSave), activeRevisionId: revisionToSave.id, updatedAt: now() };
    try {
      const committedVersion = await saveProjectSafely(nextProject, draftBaselineVersion);
      setProjects((ps) => ps.map((p) => (p.id === nextProject.id ? { ...nextProject, version: committedVersion } : p)));
      setDraftEdit((current) => (current && current.id === revisionToSave.id && current.updatedAt === capturedUpdatedAt ? revisionToSave : current));
      setDraftBaselineVersion(committedVersion);
      // V5-08: preRefreshCheckpoint is a normal field on revisionToSave
      // (carried over from draftEdit via the spread above) -- saving must
      // NOT clear it. It is a durable, persisted recovery point precisely
      // so it survives this save and a later reload, not just the
      // in-memory session between refresh and save.
      setSaveMessage('Draft saved.');
    } catch (err) {
      if (err instanceof ConflictError) {
        setConflict({ project: err.currentRecord as Project, attempted: nextProject });
      } else {
        setSaveMessage('Save failed — your previous data was not changed.');
      }
    }
  }

  function resolveConflictReload() {
    if (!conflict) return;
    const latest = conflict.project;
    const revision = latest.revisions.find((r) => r.id === latest.activeRevisionId) ?? latest.revisions[latest.revisions.length - 1];
    setProjects((ps) => ps.map((p) => (p.id === latest.id ? latest : p)));
    setActiveProjectId(latest.id);
    setDraftEdit(revision);
    setDraftBaselineVersion(latest.version);
    setCustomPriceRaw(revision.priceMode === 'custom' ? revision.proposedPrice ?? '' : '');
    setRefreshPreview(null);
    setConflict(null);
    setSaveMessage('Reloaded the latest saved version — your conflicting edit was discarded.');
  }

  async function resolveConflictSaveAsCopy() {
    if (!conflict || !draftEdit) return;
    const newProjectId = ids.nextId();
    const copiedRevision: EstimateRevision = { ...draftEdit, id: ids.nextId(), projectId: newProjectId };
    // task item 6: "save as copy" copies only the current draft, not the
    // whole project's history — actualReviews from `conflict.attempted`
    // reference OTHER revisions (issued ones) that are deliberately not
    // included here. Carrying them over verbatim would leave a dangling
    // `baselineIssuedRevisionId` pointing at a revision this copy doesn't
    // have. Filtering to only reviews whose baseline made it into this
    // copy is correct even though, for a draft-in-progress conflict, that
    // is always empty in practice (a draft is never an actuals baseline).
    const carriedOverActuals = conflict.attempted.actualReviews.filter((ar) => ar.baselineIssuedRevisionId === copiedRevision.id);
    const copy: Project = { ...conflict.attempted, id: newProjectId, title: `${conflict.attempted.title} (my copy)`, revisions: [copiedRevision], activeRevisionId: copiedRevision.id, actualReviews: carriedOverActuals, createdAt: now(), updatedAt: now(), version: 1 };
    try {
      const committedVersion = await saveProjectSafely(copy, null);
      setProjects((ps) => [...ps.map((p) => (p.id === conflict.project.id ? conflict.project : p)), copy]);
      setConflict(null);
      setActiveProjectId(copy.id);
      setDraftEdit(copiedRevision);
      setDraftBaselineVersion(committedVersion);
      setCustomPriceRaw(copiedRevision.priceMode === 'custom' ? copiedRevision.proposedPrice ?? '' : '');
      setSaveMessage('Your edit was saved as a new copy so nothing was lost.');
    } catch {
      setSaveMessage('Save-as-copy failed — your previous data was not changed.');
    }
  }

  // ---- Explicit rate refresh (covers both paint-catalog AND service-default drift) ----
  function startRateRefreshPreview() {
    if (!draftEdit) return;
    const liveSnapshot = currentLiveSnapshot(`live-${now()}`);
    const diff = previewRateRefresh(draftEdit, liveSnapshot);
    setRefreshPreview({ diff, resolutions: {} });
  }

  function cancelRateRefresh() {
    setRefreshPreview(null); // draftEdit was never touched — nothing to undo
  }

  function confirmRateRefresh() {
    if (!draftEdit || !refreshPreview) return;
    const liveSnapshot = currentLiveSnapshot(`live-${now()}`);
    const resolutions = Object.values(refreshPreview.resolutions);
    try {
      // V5-08: applyRateRefresh embeds the pre-refresh revision as
      // `refreshed.preRefreshCheckpoint` itself, so this recovery point is
      // now a normal persisted field, not separate React state that a
      // save could silently drop.
      const refreshed = applyRateRefresh(draftEdit, liveSnapshot, resolutions, ids);
      setDraftEdit(refreshed);
      setRefreshPreview(null);
      setSaveMessage('Rates refreshed. Review the updated summary, then save.');
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Refresh failed.');
    }
  }

  function undoRateRefresh() {
    if (!draftEdit) return;
    const restored = undoRateRefreshDomain(draftEdit);
    if (!restored) return;
    setDraftEdit(restored);
    setSaveMessage('Refresh undone — restored the draft as it was before refreshing rates.');
  }

  const issueGate = useMemo(() => {
    if (!draftEdit || !summary) return { canIssue: false, reasons: ['Add at least one enabled surface.'] };
    const forGate: EstimateRevision = {
      ...draftEdit,
      calculationState: summary.calculationState,
      proposedPrice: draftEdit.priceMode === 'custom' ? (customPriceRaw.trim() === '' ? null : customPriceRaw) : summary.effectivePrice?.toFixed(2) ?? null,
    };
    return checkIssueGate(forGate, { sampleAssumptionsConfirmed: settings.sampleAssumptionsConfirmed, zeroPriceConfirmed });
  }, [draftEdit, summary, settings.sampleAssumptionsConfirmed, customPriceRaw, zeroPriceConfirmed]);

  // DOC-004: the customer-facing document preview used to exist ONLY as
  // the frozen snapshot an issued revision carries -- an unpriced or
  // otherwise incomplete draft had no scope/print preview at all. Once
  // issued, the FROZEN snapshot is authoritative and must never be
  // recomputed live (issued documents stay frozen even after later
  // edits); before that, buildCustomerDocument already tolerates an
  // incomplete revision fine (scope lines come from rooms/surfaces
  // regardless of pricing, and proposedPrice is '' when unset) -- it was
  // simply never called until issue time.
  const previewDocument = useMemo(() => {
    if (draftEdit?.customerDocumentSnapshot) return draftEdit.customerDocumentSnapshot;
    if (!draftEdit || !activeProject) return null;
    return buildCustomerDocument(draftEdit, {
      estimateNumber: `DRAFT-${activeProject.id.slice(-6)}-${draftEdit.revisionNumber}`,
      estimateDate: now().slice(0, 10),
      projectAddress: draftEdit.customerInfo.address,
      revisionLabel: `Rev ${draftEdit.revisionNumber}`,
    });
  }, [draftEdit, activeProject]);

  async function issueEstimate() {
    if (!draftEdit || !activeProject || !summary || summary.calculationState !== 'complete') return;
    // UX-008: same staleness guard as saveDraft -- see its comment.
    const capturedDraftId = draftEdit.id;
    const capturedUpdatedAt = draftEdit.updatedAt;
    const proposedPrice = draftEdit.priceMode === 'custom' ? customPriceRaw : summary.effectivePrice?.toFixed(2) ?? null;
    // independent-review R13: issuing froze the customer document but left
    // rawCalculatedOutputs permanently null, so the actual-cost comparison
    // silently fell back to a LIVE recomputation forever — never a real
    // historical baseline. `summary` here is numerically identical to what
    // re-running the assembly on `ready` would produce (issuing doesn't
    // change any INPUT the engine reads), so freezing it directly is
    // correct and avoids a redundant recomputation.
    const ready: EstimateRevision = { ...draftEdit, calculationState: 'complete', proposedPrice, title: draftEdit.title || activeProject.title, rawCalculatedOutputs: freezeCalculatedOutputs(summary, ENGINE_VERSION) };
    const issueNumber = `E-${activeProject.id.slice(-6)}-${draftEdit.revisionNumber}`;
    const issued = issueRevision(ready, (r) => buildCustomerDocument(r, { estimateNumber: issueNumber, estimateDate: now().slice(0, 10), projectAddress: draftEdit.customerInfo.address, revisionLabel: `Rev ${draftEdit.revisionNumber}` }), ids);
    // DATA_CONTRACT.md #5: "Only explicit issue supersedes the previous
    // issued revision" — the issue workflow never actually called the
    // (already correctly implemented and unit-tested) supersede() helper,
    // so an OLDER issued revision was left at state:'issued' forever
    // alongside the new one instead of being marked superseded.
    const previouslyIssued = activeProject.revisions.find((r) => r.state === 'issued' && r.id !== issued.id);
    const projectWithIssued = upsertRevision(activeProject, issued);
    const nextProject: Project = {
      ...(previouslyIssued ? upsertRevision(projectWithIssued, supersede(previouslyIssued, ids)) : projectWithIssued),
      activeRevisionId: issued.id,
      updatedAt: now(),
    };
    try {
      const committedVersion = await saveProjectSafely(nextProject, draftBaselineVersion);
      setProjects((ps) => ps.map((p) => (p.id === nextProject.id ? { ...nextProject, version: committedVersion } : p)));
      setDraftEdit((current) => (current && current.id === capturedDraftId && current.updatedAt === capturedUpdatedAt ? issued : current));
      setDraftBaselineVersion(committedVersion);
      setSaveMessage('Estimate issued and saved.');
    } catch (err) {
      if (err instanceof ConflictError) setConflict({ project: err.currentRecord as Project, attempted: nextProject });
      else setSaveMessage('Issued locally, but saving failed — your previous data was not changed.');
    }
  }

  // ---- Price Book Health (independent-review R08: reads REAL persisted
  // service definitions — previously one hardcoded wall service from
  // catalog[0] with a null price, never any actually saved data) ----
  const healthResults = useMemo(
    () => serviceDefinitions.map((service) => ({ service, result: assembleServiceHealth(service, catalog, settings) })),
    [serviceDefinitions, catalog, settings]
  );

  function addService(kind: ServiceKind) {
    const t = now();
    // V5-10: CALCULATION_SPEC.md §2 requires explicit user-entered geometry
    // for trim (developedWidthFt) and door (widthFt/heightFt/paintedSides)
    // services -- "no hidden defaults." A new service used to start with
    // an INVENTED 4ft developed width or a 3x6.67 two-sided door already
    // filled in, so a customer who never touched those fields still got a
    // real, silently-assumed paint-consumption number. Every required
    // geometry field now starts unset (null, matching every other
    // required-with-no-default field in this app), leaving the service
    // correctly 'incomplete' until the customer actually enters it.
    const service: ServiceDefinition = {
      id: ids.nextId(), name: `New ${kind} service`, unit: kind === 'door' ? 'door' : kind === 'trim' ? 'linearFt' : 'ft2', kind,
      paintVariantId: catalog[0]?.id ?? null, coats: null, wasteRatio: null, loadedHourlyRate: null, throughput: null,
      hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null, paintedSides: null,
      additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: null,
      createdAt: t, updatedAt: t,
    };
    setServiceDefinitions((ss) => [...ss, service]);
    saveServiceDefinition(service).catch(() => setSaveMessage('Service created locally, but saving failed.'));
  }

  function patchService(id: string, patch: Partial<ServiceDefinition>) {
    setServiceDefinitions((ss) => {
      const next = ss.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: now() } : s));
      const updated = next.find((s) => s.id === id);
      if (updated) saveServiceDefinition(updated).catch(() => setSaveMessage('Service change saved locally, but persisting failed.'));
      return next;
    });
  }

  function removeService(id: string) {
    setServiceDefinitions((ss) => ss.filter((s) => s.id !== id));
    deleteServiceDefinition(id).catch(() => setSaveMessage('Removed locally, but deleting from storage failed.'));
  }

  // CAT-008: explicit refresh-defaults preview -- never triggered by an
  // ordinary save, only by this action, and never rewrites a customized
  // field until the user picks it and confirms.
  const [serviceRefreshPreview, setServiceRefreshPreview] = useState<{ serviceId: string; diff: ServiceRefreshDiff; fieldsToRevert: Set<ServiceRefreshableField> } | null>(null);

  function startServiceRefreshPreview(service: ServiceDefinition) {
    setServiceRefreshPreview({ serviceId: service.id, diff: previewServiceDefaultsRefresh(service, catalog, settings), fieldsToRevert: new Set() });
  }

  function cancelServiceRefreshPreview() {
    setServiceRefreshPreview(null);
  }

  function confirmServiceRefreshPreview() {
    if (!serviceRefreshPreview) return;
    const service = serviceDefinitions.find((s) => s.id === serviceRefreshPreview.serviceId);
    if (!service) return;
    const updated = applyServiceDefaultsRefresh(service, serviceRefreshPreview.fieldsToRevert);
    patchService(service.id, updated);
    setServiceRefreshPreview(null);
  }

  // ---- Actuals (scoped to the active project's issued revision) ----
  const issuedRevision = activeProject?.revisions.find((r) => r.state === 'issued' && r.id === activeProject.activeRevisionId) ?? activeProject?.revisions.find((r) => r.state === 'issued') ?? null;
  const existingActualReview = activeProject?.actualReviews.find((ar) => ar.baselineIssuedRevisionId === issuedRevision?.id) ?? null;

  // ACT-010: the baseline issued revision's OWN allocated overhead, used to
  // populate/confirm the 'baselineAllocation' mode. Prefers the frozen
  // snapshot (independent-review R13); falls back to a live recompute for
  // an old issued revision from before outputs were frozen, exactly like
  // actualResult's own baselineCost fallback below. Returns the exact Dec
  // — V5-11: this value is a fully-precise INTERNAL calculation result
  // (e.g. a repeating decimal from a production-rate division), not
  // manually typed text, so it must never be forced back through the
  // 10-fractional-digit TEXT-ENTRY grammar in parseDecimalField. That
  // limit exists to catch a human mistyping a number, not to second-guess
  // the app's own arithmetic.
  function baselineOverheadValue(): Dec | null {
    if (!issuedRevision) return null;
    const frozen = readFrozenCalculatedOutputs(issuedRevision.rawCalculatedOutputs);
    if (frozen.status === 'frozen' && frozen.overhead !== null) return frozen.overhead;
    const issuedSummary = assembleProjectEstimate(issuedRevision, { priceMode: issuedRevision.priceMode, customPriceRaw: issuedRevision.proposedPrice ?? '' });
    return issuedSummary.calculationState === 'complete' ? issuedSummary.overhead : null;
  }
  function baselineOverheadString(): string | null {
    return baselineOverheadValue()?.toString() ?? null;
  }

  // ACT-013/014 fix: reload previously-saved actuals when switching to a
  // project/issued revision that already has one — without this, actuals
  // silently reset to blank on every reload (nothing was ever persisted).
  useEffect(() => {
    if (existingActualReview) {
      setActuals({
        materials: { confirmed: existingActualReview.materials.confirmed, amount: existingActualReview.materials.amount ?? '' },
        labor: { confirmed: existingActualReview.labor.confirmed, amount: existingActualReview.labor.amount ?? '' },
        otherExpenses: { confirmed: existingActualReview.otherExpenses.confirmed, amount: existingActualReview.otherExpenses.amount ?? '' },
        overhead: { confirmed: existingActualReview.overhead.confirmed, amount: existingActualReview.overhead.amount ?? '' },
      });
      setOverheadMode(existingActualReview.overhead.mode);
      if (existingActualReview.laborBreakdown) {
        setLaborMode(existingActualReview.laborBreakdown.mode);
        setLaborHours(existingActualReview.laborBreakdown.hours ?? '');
        setLaborRate(existingActualReview.laborBreakdown.rate ?? '');
      } else {
        setLaborMode('direct');
        setLaborHours('');
        setLaborRate('');
      }
    } else {
      setActuals({ materials: { confirmed: false, amount: '' }, labor: { confirmed: false, amount: '' }, otherExpenses: { confirmed: false, amount: '' }, overhead: { confirmed: false, amount: '' } });
      setOverheadMode('baselineAllocation');
      setLaborMode('direct');
      setLaborHours('');
      setLaborRate('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuedRevision?.id]);

  // independent-review R09/R10: raw typed text was fed directly into
  // `new PEP(...)` (crashes on "abc") and finality was derived from the
  // CHECKBOX count alone, ignoring whether the amounts were actually
  // valid/non-null — a review with all 4 boxes checked but every amount
  // left blank was saved as 'final' even though the engine's own
  // completeness rule (confirmed && amount != null) says otherwise. This
  // is the one shared, crash-proof parse both saveActuals() and
  // actualResult below now use, so the saved finality and the on-screen
  // preview can never disagree.
  function deriveActualCategory(raw: { confirmed: boolean; amount: string }): { confirmed: boolean; value: Dec | null; invalid: boolean } {
    if (!raw.confirmed) return { confirmed: false, value: null, invalid: false };
    if (raw.amount.trim() === '') return { confirmed: true, value: null, invalid: false }; // confirmed but not yet entered — a real partial state, never zero
    // AGG-005: rejects negative by default (a cost cannot be negative) AND
    // caps at the same aggregate ceiling checked on the SUM in
    // evaluateActualReview -- a single absurd entry is rejected here at
    // the field level, same as every other money field in this app.
    const parsed = parseDecimalField(raw.amount, { max: MAX_AGGREGATE_MONETARY });
    return parsed.kind === 'valid' ? { confirmed: true, value: parsed.value, invalid: false } : { confirmed: true, value: null, invalid: true };
  }

  // ACT-010/V5-11: in baselineAllocation mode, the value being confirmed is
  // the baseline's own allocated overhead, taken directly as the Dec
  // already computed above — never round-tripped through the free-text
  // parser (which would wrongly reject a legitimate repeating-decimal
  // baseline over 10 fractional digits, exactly as a manually mistyped
  // value would be rejected). There is nothing for the user to retype, and
  // nothing for them to get wrong, so this category is never "invalid" in
  // this mode — only present (a real baseline exists) or absent.
  function deriveOverheadCategory(): { confirmed: boolean; value: Dec | null; invalid: boolean } {
    if (overheadMode === 'baselineAllocation') {
      return { confirmed: actuals.overhead.confirmed, value: actuals.overhead.confirmed ? baselineOverheadValue() : null, invalid: false };
    }
    return deriveActualCategory(actuals.overhead);
  }

  // ACT-011: actual labor entered as hours x rate, using ONE authoritative
  // active mode (DATA_CONTRACT.md: "no stale values contribute") -- the
  // direct-amount field's stale text never leaks into an hoursRate-mode
  // save, and vice versa, exactly like the free job-cost calculator's own
  // materialsMode/laborMode never blending inactive fields.
  function deriveLaborCategory(): { confirmed: boolean; value: Dec | null; invalid: boolean } {
    if (laborMode === 'direct') return deriveActualCategory(actuals.labor);
    if (!actuals.labor.confirmed) return { confirmed: false, value: null, invalid: false };
    if (laborHours.trim() === '' || laborRate.trim() === '') return { confirmed: true, value: null, invalid: false };
    const hoursField = parseDecimalField(laborHours, { max: MAX_AGGREGATE_HOURS });
    const rateField = parseDecimalField(laborRate, { max: MAX_RATE });
    if (hoursField.kind !== 'valid' || rateField.kind !== 'valid') return { confirmed: true, value: null, invalid: true };
    return { confirmed: true, value: hoursField.value.times(rateField.value), invalid: false };
  }

  const derivedActuals = useMemo(
    () => ({
      materials: deriveActualCategory(actuals.materials),
      labor: deriveLaborCategory(),
      otherExpenses: deriveActualCategory(actuals.otherExpenses),
      overhead: deriveOverheadCategory(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actuals, overheadMode, issuedRevision, laborMode, laborHours, laborRate]
  );
  const anyActualCategoryInvalid = Object.values(derivedActuals).some((c) => c.invalid);

  async function saveActuals() {
    if (!activeProject || !issuedRevision) return;
    // Genuinely complete = confirmed AND a valid, non-null amount (explicit
    // zero counts — ACT-02) — never just "the checkbox is ticked." AGG-005:
    // also never "final" when the four categories individually validate but
    // their SUM exceeds the supported aggregate range -- the persisted
    // record must agree with evaluateActualReview's own live computation,
    // never claim 'final' while the on-screen result is blocked.
    const genuinelyCompleteCount = Object.values(derivedActuals).filter((c) => c.confirmed && c.value !== null).length;
    const isFinal = genuinelyCompleteCount === 4 && actualResult?.state === 'final';
    const review: ActualReview = {
      id: existingActualReview?.id ?? ids.nextId(),
      projectId: activeProject.id,
      baselineIssuedRevisionId: issuedRevision.id,
      state: isFinal ? 'final' : 'inProgress',
      materials: { confirmed: actuals.materials.confirmed, amount: derivedActuals.materials.value?.toString() ?? null },
      labor: { confirmed: actuals.labor.confirmed, amount: derivedActuals.labor.value?.toString() ?? null },
      otherExpenses: { confirmed: actuals.otherExpenses.confirmed, amount: derivedActuals.otherExpenses.value?.toString() ?? null },
      overhead: { confirmed: actuals.overhead.confirmed, amount: derivedActuals.overhead.value?.toString() ?? null, mode: overheadMode },
      ...(laborMode === 'hoursRate' ? { laborBreakdown: { mode: laborMode, hours: laborHours, rate: laborRate } } : {}),
      updatedAt: now(),
    };
    const nextProject = upsertActualReview(activeProject, review);
    try {
      const committedVersion = await saveProjectSafely(nextProject, activeProject.version);
      setProjects((ps) => ps.map((p) => (p.id === nextProject.id ? { ...nextProject, version: committedVersion } : p)));
      // Bump the currently-open draft's own version baseline too — a
      // later saveDraft()/issueEstimate() on this same project must not
      // conflict against the version this actuals-save just advanced past.
      setDraftBaselineVersion(committedVersion);
      setSaveMessage('Actuals saved.');
    } catch (err) {
      if (err instanceof ConflictError) setConflict({ project: err.currentRecord as Project, attempted: nextProject });
      else setSaveMessage('Save failed — your previous data was not changed.');
    }
  }

  // independent-review R13: explicit compatibility handling for an issued
  // revision that predates rawCalculatedOutputs being frozen at all —
  // `frozenOutputsMissing` lets the UI say so rather than silently
  // presenting a live recomputation as if it were the original baseline.
  const frozenOutputs = issuedRevision ? readFrozenCalculatedOutputs(issuedRevision.rawCalculatedOutputs) : null;
  const frozenOutputsMissing = frozenOutputs?.status === 'missing';

  const actualResult = useMemo(() => {
    if (!issuedRevision || !issuedRevision.proposedPrice) return null;
    const toCategory = (c: { confirmed: boolean; value: Dec | null }): ActualCategory => ({ confirmed: c.confirmed, amount: c.value });
    const frozen = readFrozenCalculatedOutputs(issuedRevision.rawCalculatedOutputs);
    let baselineCost: string;
    if (frozen.status === 'frozen' && frozen.jobCost !== null) {
      baselineCost = frozen.jobCost.toString();
    } else {
      // No usable frozen baseline (an old record from before this fix, or
      // one that was somehow issued incomplete) — fall back to a live
      // recompute, the same as before this fix, but now a NAMED,
      // disclosed fallback rather than the only path that ever existed.
      const issuedSummary = assembleProjectEstimate(issuedRevision, { priceMode: issuedRevision.priceMode, customPriceRaw: issuedRevision.proposedPrice ?? '' });
      baselineCost = issuedSummary.calculationState === 'complete' ? issuedSummary.jobCost!.toString() : '0';
    }
    return evaluateActualReview({
      materials: toCategory(derivedActuals.materials),
      labor: toCategory(derivedActuals.labor),
      otherExpenses: toCategory(derivedActuals.otherExpenses),
      overhead: toCategory(derivedActuals.overhead),
      baselinePrice: new PEP(issuedRevision.proposedPrice),
      baselineCost: new PEP(baselineCost),
    });
  }, [issuedRevision, derivedActuals]);

  // ---- Backup ----
  async function handleExport() {
    // independent-review R12: this used to export the REACT-STATE
    // settings/catalog/projects (a stale in-memory snapshot from whenever
    // this tab last loaded or synced) while only otherMaterials/
    // serviceDefinitions/importProvenance came from a fresh read — so a
    // project committed by ANOTHER tab after this one loaded was silently
    // absent from the export. Replace-all uses this same export function
    // for its required pre-import safety backup, so that recovery file
    // could be incomplete too. Every collection now comes from ONE fresh,
    // consistent storage read, taken right before building the file.
    const snapshot = await loadSnapshot();
    const currentSettings = snapshot.businessSettings[0] ?? settings; // a fresh install may not have persisted settings yet
    const envelope = exportBackup('install-local', currentSettings, snapshot.paintVariants, snapshot.otherMaterials, snapshot.serviceDefinitions, snapshot.projects, ids, snapshot.importProvenance);
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `painting-estimate-pro-backup-${now().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Step 1: parse + validate + compute the plan for the CHOSEN import mode.
  // NO writes happen here — this only populates `pendingImport` for the
  // user to review (item 7: restore/merge, import-as-copies, replace-all).
  async function handleImportFileSelected(file: File) {
    setImportMessage(null);
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setImportMessage('Not imported: the file is not valid JSON.');
      return;
    }
    const result = validateBackupEnvelope(parsed, file.size);
    if (!result.ok) {
      setImportMessage(`Not imported: ${result.issues.map((i) => i.message).join(' ')}`);
      return;
    }
    const envelope = result.envelope;

    if (importMode === 'replaceAll') {
      setPendingImport({ mode: 'replaceAll', envelope, backupDownloaded: false });
      return;
    }

    const snapshot = await loadSnapshot();

    if (importMode === 'copies') {
      // "Already imported this export" is keyed by (exportId, sourceProjectId)
      // — read from PERSISTED provenance so this survives across sessions,
      // not just an in-memory Set that resets on reload (item 6).
      const alreadyImportedSourceIds = snapshot.importProvenance.filter((rec) => rec.exportId === envelope.exportId).map((rec) => rec.sourceProjectId);
      setPendingImport({ mode: 'copies', envelope, alreadyImportedSourceIds, forcedSourceIds: [] });
      return;
    }

    // Default: restore/merge.
    const plan = planFullRestoreMerge(
      { businessSettings: settings, paintVariants: catalog, otherMaterials: snapshot.otherMaterials, serviceDefinitions: snapshot.serviceDefinitions, projects },
      { businessSettings: envelope.businessSettings, paintVariants: envelope.paintVariants, otherMaterials: envelope.otherMaterials, serviceDefinitions: envelope.serviceDefinitions, projects: envelope.projects }
    );
    const resolutions: Record<string, ImportConflict['resolution']> = {};
    for (const c of plan.conflicts) resolutions[`${c.kind}:${c.id}`] = 'keepLocal';
    // Captured HERE, at preview time — never re-read at confirm time. This
    // is exactly what lets the storage transaction later detect a change
    // that landed in between (item 8's two-tab scenario).
    const existingProjectVersions = Object.fromEntries(projects.map((p) => [p.id, p.version]));
    setPendingImport({ mode: 'merge', envelope, plan, resolutions, existingOtherMaterials: snapshot.otherMaterials, existingServiceDefinitions: snapshot.serviceDefinitions, existingProjectVersions });
  }

  function setImportResolution(conflict: ImportConflict, resolution: ImportConflict['resolution']) {
    setPendingImport((pending) => (pending && pending.mode === 'merge' ? { ...pending, resolutions: { ...pending.resolutions, [`${conflict.kind}:${conflict.id}`]: resolution } } : pending));
  }

  function toggleForceAnotherCopy(sourceProjectId: string) {
    setPendingImport((pending) => {
      if (!pending || pending.mode !== 'copies') return pending;
      const isForced = pending.forcedSourceIds.includes(sourceProjectId);
      const forcedSourceIds = isForced ? pending.forcedSourceIds.filter((id) => id !== sourceProjectId) : [...pending.forcedSourceIds, sourceProjectId];
      return { ...pending, forcedSourceIds };
    });
  }

  /** Preview counts only — never generates a real copy or consumes an ID,
   * so it's safe to call on every render. */
  function copiesPreviewCounts(pending: Extract<PendingImport, { mode: 'copies' }>): { toCopyCount: number; skipCount: number } {
    const alreadySet = new Set(pending.alreadyImportedSourceIds);
    const forcedSet = new Set(pending.forcedSourceIds);
    let toCopyCount = 0;
    for (const p of pending.envelope.projects) if (forcedSet.has(p.id) || !alreadySet.has(p.id)) toCopyCount += 1;
    return { toCopyCount, skipCount: pending.envelope.projects.length - toCopyCount };
  }

  /** The one place actual remapped copies (real fresh IDs) are generated —
   * called exactly once, at confirm time. */
  function buildCopiesForConfirm(pending: Extract<PendingImport, { mode: 'copies' }>) {
    const alreadySet = new Set(pending.alreadyImportedSourceIds);
    const forcedSet = new Set(pending.forcedSourceIds);
    const toForce = pending.envelope.projects.filter((p) => forcedSet.has(p.id));
    const toNormal = pending.envelope.projects.filter((p) => !forcedSet.has(p.id));
    const forced = planImportAsCopies(toForce, pending.envelope.exportId, new Set(), ids, true);
    const normal = planImportAsCopies(toNormal, pending.envelope.exportId, alreadySet, ids, false);
    return {
      projects: [...forced.projects, ...normal.projects],
      skippedSourceIds: normal.skippedSourceIds,
      provenance: [...forced.provenance, ...normal.provenance],
    };
  }

  function cancelImport() {
    // Cancellation writes nothing — `pendingImport` only ever held an
    // in-memory plan; discarding it leaves storage and app state untouched.
    setPendingImport(null);
    setImportMessage('Import cancelled — nothing was changed.');
  }

  async function downloadPreImportBackup() {
    await handleExport();
    setPendingImport((pending) => (pending && pending.mode === 'replaceAll' ? { ...pending, backupDownloaded: true } : pending));
  }

  // Step 2: commit the chosen mode's plan atomically (item 7), with every
  // project write version-checked against its current stored state
  // (item 8) — never trusting the in-memory snapshot taken at preview time.
  async function confirmImport() {
    if (!pendingImport) return;

    if (pendingImport.mode === 'replaceAll') {
      if (!pendingImport.backupDownloaded) return; // guarded by the disabled Confirm button too
      const { envelope } = pendingImport;
      try {
        const { committedProjectVersions } = await saveReplaceAllBackup({
          businessSettings: envelope.businessSettings,
          paintVariants: envelope.paintVariants,
          otherMaterials: envelope.otherMaterials,
          serviceDefinitions: envelope.serviceDefinitions,
          projects: envelope.projects,
          provenance: envelope.importProvenance,
        });
        // Use the ACTUALLY committed versions (independent-review R04),
        // never the envelope's own — otherwise this same tab's very next
        // save would use a stale baseline and incorrectly conflict
        // against the data it just wrote itself.
        setSettings(envelope.businessSettings);
        setCatalog(envelope.paintVariants);
        setProjects(envelope.projects.map((p) => ({ ...p, version: committedProjectVersions.get(p.id) ?? p.version })));
        // Any currently-open project editor may reference a project that
        // no longer exists (or exists with entirely different content and
        // a stale version baseline) after a full replace — close it
        // rather than risk a stale editor silently overwriting restored
        // work on its next save.
        setActiveProjectId(null);
        setDraftEdit(null);
        setDraftBaselineVersion(null);
        setConflict(null);
        setPendingImport(null);
        setImportMessage(`Everything replaced: ${envelope.projects.length} project(s) restored from the imported file.`);
      } catch {
        setImportMessage('Replace-all import failed while saving — your previous data was not changed.');
      }
      return;
    }

    if (pendingImport.mode === 'copies') {
      const { projects: toCopy, skippedSourceIds, provenance } = buildCopiesForConfirm(pendingImport);
      try {
        const { committedProjectVersions } = await saveImportedBackup({ projects: toCopy.map((project) => ({ project, expectedVersion: null })), provenance });
        // independent-review R11: a copy's `version` field is carried over
        // verbatim from whatever the SOURCE project happened to be at
        // (e.g. 7) — the ACTUAL committed version is a fresh value from
        // the global counter and is almost never the same number. Using
        // the stale source version here means opening this copy and
        // saving it immediately would conflict against its own
        // just-written data.
        setProjects((ps) => [...ps, ...toCopy.map((p) => ({ ...p, version: committedProjectVersions.get(p.id) ?? p.version }))]);
        setPendingImport(null);
        setImportMessage(`Import as copies complete: ${toCopy.length} project(s) copied${skippedSourceIds.length ? `, ${skippedSourceIds.length} already-imported source(s) skipped` : ''}.`);
      } catch {
        setImportMessage('Import failed while saving — your previous data was not changed.');
      }
      return;
    }

    // mode === 'merge'
    const { envelope, plan, resolutions, existingOtherMaterials, existingServiceDefinitions, existingProjectVersions } = pendingImport;
    const resolved = applyFullRestoreResolutions(
      { businessSettings: settings, paintVariants: catalog, otherMaterials: existingOtherMaterials, serviceDefinitions: existingServiceDefinitions },
      envelope, plan, resolutions, existingProjectVersions, ids
    );
    try {
      const { committedProjectVersions } = await saveImportedBackup({
        businessSettings: resolved.finalSettings,
        paintVariants: resolved.finalPaintVariants,
        otherMaterials: resolved.finalOtherMaterials,
        serviceDefinitions: resolved.finalServiceDefinitions,
        projects: resolved.projectWrites,
        provenance: resolved.provenance,
      });
      const writtenById = new Map(resolved.projectWrites.map((w) => [w.project.id, w.project]));
      const keptProjects = projects.filter((p) => !writtenById.has(p.id));
      const newlyWritten = resolved.projectWrites.map((w) => ({ ...w.project, version: committedProjectVersions.get(w.project.id) ?? w.project.version }));
      setSettings(resolved.finalSettings);
      setCatalog(resolved.finalPaintVariants);
      setProjects([...keptProjects, ...newlyWritten]);
      setPendingImport(null);
      setImportMessage(`Import complete: ${resolved.projectWrites.length} project write(s) committed, ${plan.conflicts.length} conflict(s) resolved as chosen.`);
    } catch (err) {
      if (err instanceof ConflictError) {
        setPendingImport(null);
        setImportMessage("This import couldn't be confirmed: at least one affected project changed elsewhere since you previewed it. Nothing was changed — please re-select the file to refresh the preview.");
      } else {
        setImportMessage('Import failed while saving — your previous data was not changed.');
      }
    }
  }

  if (loading) return <div className="card p-6 text-sm text-ink-soft">Loading…</div>;

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-line pb-3 print:hidden">
        {(['settings', 'catalog', 'projects', 'health', 'actuals', 'backup'] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`btn ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
            {t === 'settings' ? 'Business settings' : t === 'catalog' ? 'Paint catalog' : t === 'projects' ? 'Projects' : t === 'health' ? 'Price Book Health' : t === 'actuals' ? 'Actual review' : 'Backup'}
          </button>
        ))}
      </div>
      {saveMessage && (
        <div className="mt-3 print:hidden">
          <p className="text-xs text-ink-soft">{saveMessage}</p>
          {/* UX-010: a save failure (private browsing, storage disabled, quota
              exceeded) must never end with just an honest error and nothing
              actionable -- point the user at the one thing that actually
              protects unsaved work: exporting a backup now, while the data
              still exists in this tab's memory. */}
          {saveMessage.toLowerCase().includes('failed') && (
            <p className="mt-1 text-xs text-warn">Your data may not be saved in this browser. Go to the Backup tab and use "Export backup (.json)" now to avoid losing this session's changes.</p>
          )}
        </div>
      )}
      {pendingHandoff && (
        <div className="mt-3 rounded-btn border border-line bg-line-soft p-4 text-sm print:hidden">
          <p className="font-semibold">Bring in the room from your free calculator result?</p>
          <p className="mt-1 text-ink-soft">
            {pendingHandoff.lengthFt}×{pendingHandoff.widthFt}×{pendingHandoff.heightFt} ft, {pendingHandoff.doorCount} door(s), {pendingHandoff.windowCount} window(s), {pendingHandoff.coats} coats, ${pendingHandoff.pricePerGal}/gal at {pendingHandoff.coverageFt2PerGal} sqft/gal.
            {pendingHandoff.includeCeiling && ' Ceiling included.'} This creates a new project — your free-tool result is untouched either way.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={declineHandoff}>Not now</button>
            <button type="button" className="btn btn-primary" onClick={acceptHandoff}>Import into a new project</button>
          </div>
        </div>
      )}
      {handoffPreviewNotes && handoffPreviewNotes.length > 0 && (
        <div className="mt-3 rounded-btn border border-warn-line bg-warn-soft p-3 text-xs text-warn print:hidden">
          <p className="font-semibold">Imported — a couple of things to know:</p>
          <ul className="mt-1 list-disc pl-4">
            {handoffPreviewNotes.map((n, i) => (
              <li key={i}>
                <strong>{n.field}:</strong> {n.note}
              </li>
            ))}
          </ul>
          <button type="button" className="text-link mt-1 text-xs" onClick={() => setHandoffPreviewNotes(null)}>
            Dismiss
          </button>
        </div>
      )}
      {conflict && (
        <div className="mt-3 rounded-btn border border-warn-line bg-warn-soft p-4 text-sm text-warn print:hidden">
          <p className="font-semibold">This project was changed elsewhere before your save landed.</p>
          <p className="mt-1">Your edit is still here. Reload the latest saved version (discarding your edit), or save your edit as a new copy instead of overwriting.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={resolveConflictReload}>Reload latest</button>
            <button type="button" className="btn btn-primary" onClick={resolveConflictSaveAsCopy}>Save my edit as a copy</button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {tab === 'settings' && (
          <div className="card space-y-3 p-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settings.sampleAssumptionsConfirmed} onChange={(e) => persistSettings({ ...settings, sampleAssumptionsConfirmed: e.target.checked })} />
              I confirm these are sample assumptions I've reviewed (required before issuing a priced estimate).
            </label>
            <NumField label="Loaded hourly rate ($/hr)" value={settings.loadedHourlyRate ?? ''} onChange={(v) => persistSettings({ ...settings, loadedHourlyRate: v })} />
            <NumField label="Overhead (ratio, e.g. 0.15)" value={settings.overheadRatio} onChange={(v) => persistSettings({ ...settings, overheadRatio: v })} />
            <NumField label="Target margin (ratio, e.g. 0.35)" value={settings.targetMarginRatio} onChange={(v) => persistSettings({ ...settings, targetMarginRatio: v })} />
            <NumField label="Wall throughput (sqft/hr/coat)" value={settings.wallThroughput ?? ''} onChange={(v) => persistSettings({ ...settings, wallThroughput: v })} />
            <NumField label="Ceiling throughput (sqft/hr/coat)" value={settings.ceilingThroughput ?? ''} onChange={(v) => persistSettings({ ...settings, ceilingThroughput: v })} />
            <NumField label="Trim throughput (linear ft/hr/coat)" value={settings.trimThroughput ?? ''} onChange={(v) => persistSettings({ ...settings, trimThroughput: v })} />
            <NumField label="Door hours/side/coat" value={settings.doorHoursPerSidePerCoat ?? ''} onChange={(v) => persistSettings({ ...settings, doorHoursPerSidePerCoat: v })} />
            <NumField label="Waste ratio (e.g. 0.10)" value={settings.defaultWasteRatio} onChange={(v) => persistSettings({ ...settings, defaultWasteRatio: v })} />
            <p className="text-xs text-ink-soft">Changing these never edits a saved draft or issued estimate — each keeps the rates captured in its own snapshot until you explicitly run "Refresh rates" on that project.</p>
          </div>
        )}

        {tab === 'catalog' && (
          <div className="card p-6">
            <button type="button" className="btn btn-secondary" onClick={addPaintVariant}>
              + Add paint variant
            </button>
            <div className="mt-4 space-y-3">
              {catalog.map((v) => (
                <div key={v.id} className="grid grid-cols-2 gap-2 rounded-btn border border-line p-3 sm:grid-cols-4">
                  <TextField label="Name" value={v.name} onChange={(val) => persistCatalog(catalog.map((x) => (x.id === v.id ? { ...x, name: val } : x)))} />
                  <NumField label="Price/gal ($)" value={v.pricePerGal} onChange={(val) => persistCatalog(catalog.map((x) => (x.id === v.id ? { ...x, pricePerGal: val } : x)))} />
                  <NumField label="Coverage (sqft/gal)" value={v.coverageFt2PerGal} onChange={(val) => persistCatalog(catalog.map((x) => (x.id === v.id ? { ...x, coverageFt2PerGal: val } : x)))} />
                  <TextField label="Sheen" value={v.sheen} onChange={(val) => persistCatalog(catalog.map((x) => (x.id === v.id ? { ...x, sheen: val } : x)))} />
                </div>
              ))}
              {catalog.length === 0 && <p className="text-sm text-ink-soft">Add a paint product before estimating.</p>}
            </div>
          </div>
        )}

        {tab === 'projects' && !activeProjectId && (
          <div className="card p-6">
            <button type="button" className="btn btn-primary" disabled={catalog.length === 0} onClick={newProject}>
              + New project
            </button>
            {catalog.length === 0 && <p className="mt-2 text-sm text-warn">Add a paint product in the catalog first.</p>}
            <div className="mt-4 space-y-2">
              {projects.map((p) => {
                const rev = p.revisions.find((r) => r.id === p.activeRevisionId) ?? p.revisions[p.revisions.length - 1];
                const hasHistory = p.revisions.length > 1 || p.actualReviews.length > 0;
                return (
                  <div key={p.id} className="rounded-btn border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" onClick={() => openProject(p.id)} className="block flex-1 text-left hover:text-primary">
                        <span className="font-semibold">{p.title}</span>
                        <span className="ml-2 text-xs text-ink-soft">{rev.state} · rev {rev.revisionNumber}</span>
                      </button>
                      <button type="button" className="text-link text-xs text-bad" onClick={() => setConfirmDeleteProjectId(p.id)}>Delete</button>
                    </div>
                    {/* LIFE-014: a clear, explicit second step before an
                        irreversible delete -- never a single click, and a
                        stronger warning when the project already has
                        revision or actual-cost history to lose. */}
                    {confirmDeleteProjectId === p.id && (
                      <div className="mt-2 rounded-btn border border-bad-line bg-bad-soft p-3 text-sm">
                        <p>
                          Permanently delete "{p.title}"{hasHistory ? ', including all of its revisions and actual-cost history' : ''}? This cannot be undone.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button type="button" className="btn btn-secondary" onClick={() => setConfirmDeleteProjectId(null)}>Cancel</button>
                          <button type="button" className="btn btn-primary" onClick={() => removeProject(p.id)}>Yes, delete permanently</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {projects.length === 0 && (
                <div className="text-sm text-ink-soft">
                  <p>No projects yet.</p>
                  {/* UX-011: this app's data lives only in this browser's
                      local storage -- clearing site data loses it. */}
                  <p className="mt-1">Your projects are stored only in this browser. Clearing your browser's site data will permanently erase them — use "Export backup (.json)" under the Backup tab regularly, and keep the file somewhere safe, so you can restore everything if that ever happens.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'projects' && activeProjectId && draftEdit && activeProject && (
          <div className="space-y-4">
            <button type="button" className="text-link text-xs print:hidden" onClick={() => { setActiveProjectId(null); setDraftEdit(null); }}>
              ← Back to projects
            </button>

            {activeProject.revisions.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <span className="text-xs font-medium text-ink-soft">Revisions:</span>
                {[...activeProject.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber).map((rev) => (
                  <button
                    key={rev.id}
                    type="button"
                    className={`btn ${rev.id === draftEdit.id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => {
                      setDraftEdit(rev);
                      setCustomPriceRaw(rev.priceMode === 'custom' ? rev.proposedPrice ?? '' : '');
                    }}
                  >
                    Rev {rev.revisionNumber} · {rev.state}
                    {rev.id === activeProject.activeRevisionId ? ' (active)' : ''}
                  </button>
                ))}
                <span className="text-xs text-ink-soft">Viewing any revision here never changes which one is active — only issuing a new one does.</span>
              </div>
            )}

            <div className="card p-6 print:hidden">
              <TextField label="Project title" value={draftEdit.title} onChange={(v) => mutateDraft((r) => ({ ...r, title: v, updatedAt: ids.now() }))} />
              <p className="mt-1 text-xs text-ink-soft">
                Revision {draftEdit.revisionNumber} · <span className="font-semibold">{draftEdit.state}</span>
                {draftEdit.state === 'issued' && ' — this revision is frozen. Editing creates a new draft revision.'}
              </p>
              {draftEdit.state === 'issued' && (
                <button type="button" className="btn btn-secondary mt-2" onClick={() => editIssuedAsNewDraft(activeProject, draftEdit)}>
                  Edit (creates a new draft revision)
                </button>
              )}
            </div>

            {draftEdit.state === 'draft' && (
              <div className="card p-6 print:hidden">
                <h3 className="font-semibold">Business &amp; customer info</h3>
                <p className="mt-1 text-xs text-ink-soft">Appears on the customer-facing document when you issue this estimate.</p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <TextField label="Your business name" value={draftEdit.businessInfo.name} onChange={(v) => mutateDraft((r) => ({ ...r, businessInfo: { ...r.businessInfo, name: v }, updatedAt: ids.now() }))} />
                  <TextField label="Your contact (phone/email)" value={draftEdit.businessInfo.contact} onChange={(v) => mutateDraft((r) => ({ ...r, businessInfo: { ...r.businessInfo, contact: v }, updatedAt: ids.now() }))} />
                  <TextField label="Your business address" value={draftEdit.businessInfo.address} onChange={(v) => mutateDraft((r) => ({ ...r, businessInfo: { ...r.businessInfo, address: v }, updatedAt: ids.now() }))} />
                  <TextField label="Customer name" value={draftEdit.customerInfo.name} onChange={(v) => mutateDraft((r) => ({ ...r, customerInfo: { ...r.customerInfo, name: v }, updatedAt: ids.now() }))} />
                  <TextField label="Customer contact" value={draftEdit.customerInfo.contact} onChange={(v) => mutateDraft((r) => ({ ...r, customerInfo: { ...r.customerInfo, contact: v }, updatedAt: ids.now() }))} />
                  <TextField label="Job site / customer address" value={draftEdit.customerInfo.address} onChange={(v) => mutateDraft((r) => ({ ...r, customerInfo: { ...r.customerInfo, address: v }, updatedAt: ids.now() }))} />
                </div>
                <div className="mt-3">
                  <label className="block text-sm">
                    <span className="font-medium text-ink-soft">Business logo (PNG, JPEG, or WebP; max 1 MiB)</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="mt-1 block text-sm"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = ''; // allow re-selecting the same file after a rejection
                        if (file) handleLogoFileChange(file);
                      }}
                    />
                  </label>
                  {logoError && <p className="mt-1 text-sm text-bad">{logoError}</p>}
                  {draftEdit.businessInfo.logo && (
                    <div className="mt-2 flex items-center gap-3">
                      <img src={draftEdit.businessInfo.logo} alt={`${draftEdit.businessInfo.name || 'Business'} logo`} className="h-16 w-16 rounded-btn border border-line object-contain" />
                      <button type="button" className="text-link text-xs text-bad" onClick={removeLogo}>Remove logo</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {draftEdit.state === 'draft' && (
              <>
                <div className="card p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Rooms</h3>
                    <button type="button" className="btn btn-secondary" disabled={snapshotVariants.length === 0} onClick={addRoom}>+ Add room</button>
                  </div>
                  <div className="mt-4 space-y-4">
                    {draftEdit.rooms.map((room, i) => (
                      <RoomEditor
                        key={room.id}
                        room={room}
                        surfaces={draftEdit.surfaces.filter((s) => room.surfaceIds.includes(s.id))}
                        catalog={snapshotVariants}
                        onPatchRoom={(patch) => patchRoom(room.id, patch)}
                        onDeleteRoom={() => deleteRoom(room.id)}
                        onAddCeiling={() => addCeilingToRoom(room)}
                        onPatchSurface={patchSurface}
                        onRemoveSurface={removeSurface}
                        onMoveUp={i > 0 ? () => moveRoomUpDown(room.id, 'up') : undefined}
                        onMoveDown={i < draftEdit.rooms.length - 1 ? () => moveRoomUpDown(room.id, 'down') : undefined}
                      />
                    ))}
                  </div>
                </div>

                <div className="card p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Standalone surfaces (no room required)</h3>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-secondary" disabled={snapshotVariants.length === 0} onClick={() => addStandaloneSurface('trim')}>+ Trim</button>
                      <button type="button" className="btn btn-secondary" disabled={snapshotVariants.length === 0} onClick={() => addStandaloneSurface('door')}>+ Door</button>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {draftEdit.surfaces.filter((s) => s.roomId === null).map((s, i, standalone) => (
                      <StandaloneSurfaceEditor
                        key={s.id}
                        surface={s}
                        catalog={snapshotVariants}
                        onPatch={(patch) => patchSurface(s.id, patch)}
                        onRemove={() => removeSurface(s.id)}
                        onMoveUp={i > 0 ? () => moveSurfaceUpDown(s.id, 'up') : undefined}
                        onMoveDown={i < standalone.length - 1 ? () => moveSurfaceUpDown(s.id, 'down') : undefined}
                      />
                    ))}
                    {draftEdit.surfaces.filter((s) => s.roomId === null).length === 0 && <p className="text-sm text-ink-soft">No standalone trim or door surfaces added.</p>}
                  </div>
                </div>

                <div className="card space-y-6 p-6">
                  <h3 className="font-semibold">Additional costs</h3>
                  <p className="-mt-4 text-xs text-ink-soft">
                    These are PROJECT ESTIMATING inputs — what this job will cost you to complete. They are separate from Price Book Health's per-unit
                    service assumptions and from the Actual review tab's post-job recorded costs; entering a cost here never edits either of those.
                  </p>

                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Additional labor (prep, cleanup, touch-up)</h4>
                      <button type="button" className="btn btn-secondary" onClick={addAdditionalLabor}>+ Add task</button>
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">Named tasks with their own hours and loaded rate — on top of each surface's application labor, so nothing is double-counted with production hours.</p>
                    <div className="mt-2 space-y-2">
                      {draftEdit.additionalLabor.map((l) => (
                        <div key={l.id} className="grid grid-cols-1 items-end gap-2 rounded-btn border border-line p-2 sm:grid-cols-[1fr_auto_auto_auto]">
                          <TextField label="Description" value={l.description} onChange={(v) => patchAdditionalLabor(l.id, { description: v })} />
                          <NumField label="Hours" value={l.hours} onChange={(v) => patchAdditionalLabor(l.id, { hours: v })} className="w-24" />
                          <NumField label="$/hour" value={l.loadedHourlyRate} onChange={(v) => patchAdditionalLabor(l.id, { loadedHourlyRate: v })} className="w-24" />
                          <button type="button" className="text-link text-xs text-bad" onClick={() => removeAdditionalLabor(l.id)}>Remove</button>
                        </div>
                      ))}
                      {draftEdit.additionalLabor.length === 0 && <p className="text-sm text-ink-soft">No additional labor tasks added.</p>}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Other materials</h4>
                      <button type="button" className="btn btn-secondary" onClick={addOtherMaterialLine}>+ Add material</button>
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">Itemized, non-paint materials (caulk, tape, drop cloths, etc.) by quantity and unit cost.</p>
                    <div className="mt-2 space-y-2">
                      {draftEdit.otherMaterialLines.map((l) => (
                        <div key={l.id} className="grid grid-cols-1 items-end gap-2 rounded-btn border border-line p-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
                          <TextField label="Description" value={l.description} onChange={(v) => patchOtherMaterialLine(l.id, { description: v })} />
                          <TextField label="Unit" value={l.unit} onChange={(v) => patchOtherMaterialLine(l.id, { unit: v })} />
                          <NumField label="Quantity" value={l.quantity} onChange={(v) => patchOtherMaterialLine(l.id, { quantity: v })} className="w-24" />
                          <NumField label="Unit cost ($)" value={l.unitCost} onChange={(v) => patchOtherMaterialLine(l.id, { unitCost: v })} className="w-28" />
                          <button type="button" className="text-link text-xs text-bad" onClick={() => removeOtherMaterialLine(l.id)}>Remove</button>
                        </div>
                      ))}
                      {draftEdit.otherMaterialLines.length === 0 && <p className="text-sm text-ink-soft">No other materials added.</p>}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold">Supplies allowance</h4>
                    <p className="mt-1 text-xs text-ink-soft">One mode only — not a second untracked percentage on top of itemized materials above.</p>
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <label className="block text-sm">
                        <span className="font-medium text-ink-soft">Mode</span>
                        <select className="mt-1 rounded-btn border border-line px-2 py-1" value={draftEdit.suppliesAllowance.mode} onChange={(e) => patchSuppliesAllowance({ mode: e.target.value as 'none' | 'flat' | 'paintPercent' })}>
                          <option value="none">None</option>
                          <option value="flat">Flat amount</option>
                          <option value="paintPercent">% of paint cost</option>
                        </select>
                      </label>
                      {draftEdit.suppliesAllowance.mode === 'flat' && (
                        <NumField label="Amount ($)" value={draftEdit.suppliesAllowance.amount} onChange={(v) => patchSuppliesAllowance({ amount: v })} className="w-32" />
                      )}
                      {draftEdit.suppliesAllowance.mode === 'paintPercent' && (
                        <NumField label="% of paint cost" value={draftEdit.suppliesAllowance.ratio ? (Number(draftEdit.suppliesAllowance.ratio) * 100).toString() : ''} onChange={(v) => patchSuppliesAllowance({ ratio: v.trim() === '' ? '' : (Number(v) / 100).toString() })} className="w-32" />
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Other direct expenses (including travel)</h4>
                      <button type="button" className="btn btn-secondary" onClick={addOtherExpense}>+ Add expense</button>
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">A configured business default travel amount, if any, appears here as its own line on a brand-new draft — editing or removing it here never re-applies it automatically on save.</p>
                    <div className="mt-2 space-y-2">
                      {draftEdit.otherExpenses.map((l) => (
                        <div key={l.id} className="grid grid-cols-1 items-end gap-2 rounded-btn border border-line p-2 sm:grid-cols-[1fr_auto_auto]">
                          <TextField label="Description" value={l.description} onChange={(v) => patchOtherExpense(l.id, { description: v })} />
                          <NumField label="Amount ($)" value={l.amount} onChange={(v) => patchOtherExpense(l.id, { amount: v })} className="w-28" />
                          <button type="button" className="text-link text-xs text-bad" onClick={() => removeOtherExpense(l.id)}>Remove</button>
                        </div>
                      ))}
                      {draftEdit.otherExpenses.length === 0 && <p className="text-sm text-ink-soft">No other direct expenses added.</p>}
                    </div>
                  </div>
                </div>

                <div className="card p-6">
                  <h3 className="font-semibold">Rate refresh</h3>
                  <p className="mt-1 text-xs text-ink-soft">This draft's rates were captured on {new Date(draftEdit.activeRateSnapshot.capturedAt).toLocaleString()}. Refreshing pulls today's catalog and settings — nothing changes until you confirm.</p>
                  {!refreshPreview ? (
                    <button type="button" className="btn btn-secondary mt-2" onClick={startRateRefreshPreview}>Check for rate updates</button>
                  ) : (
                    <RateRefreshPanel diff={refreshPreview.diff} catalog={catalog} resolutions={refreshPreview.resolutions} onResolutionsChange={(resolutions) => setRefreshPreview({ diff: refreshPreview.diff, resolutions })} onConfirm={confirmRateRefresh} onCancel={cancelRateRefresh} />
                  )}
                  {draftEdit.preRefreshCheckpoint && (
                    <div className="mt-3 rounded-btn border border-warn-line bg-warn-soft p-3 text-sm text-warn">
                      <p>Rates were refreshed on this draft. This recovery point is saved with the draft and survives reopening it.</p>
                      <button type="button" className="btn btn-secondary mt-2" onClick={undoRateRefresh}>Undo refresh</button>
                    </div>
                  )}
                </div>

                <div className="card p-6">
                  <h3 className="font-semibold">Estimate summary</h3>
                  {summary && summary.calculationState !== 'complete' && (
                    // UX-003: same role="alert" fix as the free tools -- an
                    // assistive-tech user gets an announcement as soon as
                    // this appears, not just a silent visual cue.
                    <p role="alert" className="mt-2 text-sm text-bad">{summary.calculationState === 'invalid' ? 'One or more enabled surfaces have invalid inputs.' : 'Add at least one enabled, fully-specified surface.'} {summary.reasons.join(' ')}</p>
                  )}
                  {summary && summary.calculationState === 'complete' && (() => {
                    // PRO-013: CALCULATION_SPEC §7's own reconciliation
                    // primitive existed and was tested in isolation but was
                    // never wired into the actual summary display -- Direct
                    // cost and Overhead are each independently rounded for
                    // display (money()), so their displayed sum can differ
                    // from the displayed Job cost by a cent even though the
                    // underlying raw Decimal arithmetic is exact. Surface
                    // that as an explicit row rather than a screen that
                    // silently disagrees with its own addition.
                    const reconciled = reconcileDisplayedComponents([summary.directCost!, summary.overhead!], summary.jobCost!);
                    return (
                    <>
                      {/* UX-004: announce recalculated totals to screen readers. */}
                      <dl className="mt-2 space-y-2 text-sm" aria-live="polite" aria-atomic="true">
                        <Row label="Materials" value={money(summary.materials)} />
                        <Row label="Labor" value={money(summary.laborCost)} />
                        <Row label="Direct cost" value={money(summary.directCost)} />
                        <Row label="Overhead" value={money(summary.overhead)} />
                        {!reconciled.adjustment.isZero() && <Row label="Rounding adjustment" value={money(reconciled.adjustment)} />}
                        <Row label="Estimated job cost" value={money(summary.jobCost)} strong />
                      </dl>

                      {/* CALCULATION_SPEC §1: "Waste >0.5 and overhead >0.5
                          produce nonblocking review warnings" -- informational
                          only, never blocks pricing or issuing. */}
                      {summary.warnings.length > 0 && (
                        <div className="mt-3 rounded-[calc(var(--radius-card)-8px)] border border-warn-line bg-warn-soft p-3 text-sm text-warn">
                          {summary.warnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </div>
                      )}

                      <div className="mt-4 flex gap-2">
                        <button type="button" className={`btn ${draftEdit.priceMode === 'suggested' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => mutateDraft((r) => ({ ...r, priceMode: 'suggested', updatedAt: ids.now() }))}>Suggested price</button>
                        <button type="button" className={`btn ${draftEdit.priceMode === 'custom' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => mutateDraft((r) => ({ ...r, priceMode: 'custom', updatedAt: ids.now() }))}>Custom price</button>
                      </div>
                      {draftEdit.priceMode === 'custom' && <NumField label="Your price ($)" value={customPriceRaw} onChange={setCustomPriceRaw} className="mt-2 max-w-xs" />}

                      <dl className="mt-4 space-y-2 text-sm" aria-live="polite" aria-atomic="true">
                        <Row label="Proposed price" value={summary.effectivePrice ? money(summary.effectivePrice) : '—'} strong />
                        <Row label="Profit" value={summary.price?.profit ? money(summary.price.profit) : '—'} />
                        <Row label="Margin" value={summary.price?.marginRatio ? `${summary.price.marginRatio.times(100).toFixed(1)}%` : '—'} />
                        {summary.price && (
                          <div>
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge(summary.price).className}`}>{statusBadge(summary.price).label}</span>
                          </div>
                        )}
                      </dl>

                      {summary.effectivePrice?.isZero() && (
                        <label className="mt-2 flex items-center gap-2 text-sm text-warn">
                          <input type="checkbox" checked={zeroPriceConfirmed} onChange={(e) => setZeroPriceConfirmed(e.target.checked)} />
                          I confirm this is an intentional $0 no-charge estimate.
                        </label>
                      )}
                    </>
                    );
                  })()}

                  {/* V6-05/CORE-028: saving a draft must never depend on
                      calculation completeness -- a work-in-progress room,
                      blank line item, or invalid raw entry is exactly what
                      "save draft" exists to preserve for later correction.
                      saveDraft() already tolerates a null/incomplete
                      `summary` (falls back to calculationState:'incomplete',
                      proposedPrice:null); only the render gate previously
                      hid the button. Issuing stays behind the separate,
                      already-correct issueGate.canIssue check below. */}
                  <div className="mt-4 flex gap-2">
                    <button type="button" className="btn btn-secondary" onClick={saveDraft}>Save draft</button>
                    <button type="button" className="btn btn-primary" disabled={!issueGate.canIssue} onClick={issueEstimate}>Issue estimate</button>
                  </div>
                  {!issueGate.canIssue && (() => {
                    // The calculation-incompleteness reason is already shown,
                    // more specifically, in the "not complete/invalid"
                    // message above -- don't repeat it verbatim here.
                    const incompleteAlreadyShown = summary && summary.calculationState !== 'complete';
                    const reasons = issueGate.reasons.filter((r) => !(incompleteAlreadyShown && r === 'Estimate is not complete — check for missing or invalid inputs.'));
                    return reasons.length > 0 ? (
                      <ul className="mt-2 text-xs text-warn">
                        {reasons.map((r, i) => (<li key={i}>{r}</li>))}
                      </ul>
                    ) : null;
                  })()}
                </div>
              </>
            )}

            {previewDocument && (
              <div className="card p-6">
                <p className="tag-preview mb-2 inline-block print:hidden">{previewDocument.status === 'issued' ? 'Customer-facing document' : 'Customer-facing document — draft preview'}</p>
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    {/* DOC-010/BACK-025: the logo is a self-contained data
                        URI already embedded in this document -- it renders
                        (and prints) directly from local data, with no
                        network fetch, both live and after a restore. */}
                    {previewDocument.businessInfo.logo && <img src={previewDocument.businessInfo.logo} alt={`${previewDocument.businessInfo.name || 'Business'} logo`} className="h-12 w-12 object-contain" />}
                    <div>
                      {previewDocument.businessInfo.name && <p className="font-semibold">{previewDocument.businessInfo.name}</p>}
                      {previewDocument.businessInfo.contact && <p className="text-sm text-ink-soft">{previewDocument.businessInfo.contact}</p>}
                      {previewDocument.businessInfo.address && <p className="text-sm text-ink-soft">{previewDocument.businessInfo.address}</p>}
                    </div>
                  </div>
                  <button type="button" className="btn btn-primary print:hidden" onClick={() => window.print()}>Print / Save as PDF</button>
                </div>
                {/* DOC-004: an explicit DRAFT marker on a not-yet-issued
                    preview -- this is never the final customer document. */}
                {previewDocument.status === 'draft' && <p className="mb-2 inline-block rounded-btn border border-warn-line bg-warn-soft px-2 py-1 text-xs font-semibold text-warn">DRAFT — not yet issued</p>}
                <p className="font-semibold">{previewDocument.projectTitle}</p>
                {previewDocument.projectAddress && <p className="text-sm text-ink-soft">{previewDocument.projectAddress}</p>}
                {(previewDocument.customerInfo.name || previewDocument.customerInfo.address) && (
                  <p className="text-sm text-ink-soft">
                    Prepared for: {previewDocument.customerInfo.name || '—'}
                    {previewDocument.customerInfo.address ? `, ${previewDocument.customerInfo.address}` : ''}
                  </p>
                )}
                <p className="text-sm text-ink-soft">Estimate {previewDocument.estimateNumber} — {previewDocument.estimateDate} · {previewDocument.revisionLabel} · {previewDocument.status}</p>
                <ul className="mt-3 text-sm text-ink-soft">
                  {previewDocument.scopeLines.map((line, i) => (<li key={i}>{line}</li>))}
                </ul>
                {/* DOC-004: never show $0.00 (or a bare "$") as though it
                    were an assumed selling price when none has actually
                    been set yet. */}
                <p className="mt-3 text-2xl font-semibold tabular-nums">{previewDocument.proposedPrice ? `$${previewDocument.proposedPrice}` : 'PRICE PENDING'}</p>
                <p className="text-xs text-ink-soft">{previewDocument.taxNotice}</p>
                {previewDocument.notes && <p className="mt-3 text-sm text-ink-soft whitespace-pre-wrap">{previewDocument.notes}</p>}
                {previewDocument.terms && <p className="mt-2 text-xs text-ink-soft whitespace-pre-wrap">{previewDocument.terms}</p>}
                <p className="mt-3 text-xs text-ink-soft italic print:hidden">No cost, overhead, or margin figures appear on this document — verified by allow-list, see IMPLEMENTATION_DECISIONS.md.</p>
              </div>
            )}
          </div>
        )}

        {tab === 'health' && (
          <div className="card space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">Price Book Health</h3>
                <p className="text-xs text-ink-soft">Reviews your OWN saved services against their modeled cost — consumption-based, not the purchased quantities a real project rounds to.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['wall', 'ceiling', 'trim', 'door'] as ServiceKind[]).map((k) => (
                  <button key={k} type="button" className="btn btn-secondary" disabled={catalog.length === 0} onClick={() => addService(k)}>
                    + {k} service
                  </button>
                ))}
              </div>
            </div>
            {catalog.length === 0 && <p className="text-sm text-ink-soft">Add a paint variant to the catalog first.</p>}
            {catalog.length > 0 && healthResults.length === 0 && <p className="text-sm text-ink-soft">No services yet — add one above to review its price against its modeled cost.</p>}
            {healthResults.map(({ service, result }) => (
              <div key={service.id} className="rounded-btn border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{service.name || 'Untitled service'}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-link text-xs"
                      aria-expanded={expandedServiceIds.has(service.id)}
                      onClick={() => setExpandedServiceIds((ids) => {
                        const next = new Set(ids);
                        if (next.has(service.id)) next.delete(service.id); else next.add(service.id);
                        return next;
                      })}
                    >
                      {expandedServiceIds.has(service.id) ? 'Hide details' : 'Details'}
                    </button>
                    <button type="button" className="text-link text-xs" onClick={() => startServiceRefreshPreview(service)}>Check for default updates</button>
                    <button type="button" className="text-link text-xs" onClick={() => removeService(service.id)}>Remove</button>
                  </div>
                </div>
                {serviceRefreshPreview?.serviceId === service.id && (
                  <ServiceRefreshPanel
                    service={service}
                    beforeResult={result}
                    catalog={catalog}
                    settings={settings}
                    diff={serviceRefreshPreview.diff}
                    fieldsToRevert={serviceRefreshPreview.fieldsToRevert}
                    onFieldsToRevertChange={(fields) => setServiceRefreshPreview((p) => (p ? { ...p, fieldsToRevert: fields } : p))}
                    onConfirm={confirmServiceRefreshPreview}
                    onCancel={cancelServiceRefreshPreview}
                  />
                )}
                <TextField label="Service name" value={service.name} onChange={(v) => patchService(service.id, { name: v })} />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="block text-sm">
                    <span className="font-medium text-ink-soft">Paint variant</span>
                    <select
                      className="mt-1 w-full rounded-btn border border-line bg-card px-2 py-2 text-sm"
                      value={service.paintVariantId ?? ''}
                      onChange={(e) => patchService(service.id, { paintVariantId: e.target.value || null })}
                    >
                      <option value="">— none —</option>
                      {catalog.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
                    </select>
                  </label>
                  <NumField label="Coats (blank = default)" value={service.coats?.toString() ?? ''} onChange={(v) => { const parsed = parseCoatsInput(v); if (parsed !== 'reject') patchService(service.id, { coats: parsed }); }} />
                  <NumField label="Waste ratio (blank = default)" value={service.wasteRatio ?? ''} onChange={(v) => patchService(service.id, { wasteRatio: v.trim() === '' ? null : v })} />
                  <NumField label="Loaded $/hr (blank = default)" value={service.loadedHourlyRate ?? ''} onChange={(v) => patchService(service.id, { loadedHourlyRate: v.trim() === '' ? null : v })} />
                  {(service.kind === 'wall' || service.kind === 'ceiling') && (
                    <NumField label="Throughput sqft/hr/coat (blank = default)" value={service.throughput ?? ''} onChange={(v) => patchService(service.id, { throughput: v.trim() === '' ? null : v })} />
                  )}
                  {service.kind === 'trim' && (
                    <>
                      <NumField label="Developed width (ft)" value={service.developedWidthFt ?? ''} onChange={(v) => patchService(service.id, { developedWidthFt: v })} />
                      <NumField label="Throughput linear-ft/hr/coat (blank = default)" value={service.throughput ?? ''} onChange={(v) => patchService(service.id, { throughput: v.trim() === '' ? null : v })} />
                    </>
                  )}
                  {service.kind === 'door' && (
                    <>
                      <NumField label="Width (ft)" value={service.widthFt ?? ''} onChange={(v) => patchService(service.id, { widthFt: v })} />
                      <NumField label="Height (ft)" value={service.heightFt ?? ''} onChange={(v) => patchService(service.id, { heightFt: v })} />
                      <label className="block text-sm">
                        <span className="font-medium text-ink-soft">Painted sides</span>
                        <select className="mt-1 w-full rounded-btn border border-line bg-card px-2 py-2 text-sm" value={service.paintedSides ?? ''} onChange={(e) => patchService(service.id, { paintedSides: e.target.value ? (Number(e.target.value) as 1 | 2) : null })}>
                          <option value="">—</option>
                          <option value="1">1</option>
                          <option value="2">2</option>
                        </select>
                      </label>
                      <NumField label="Hours/side/coat (blank = default)" value={service.hoursPerSidePerCoat ?? ''} onChange={(v) => patchService(service.id, { hoursPerSidePerCoat: v.trim() === '' ? null : v })} />
                    </>
                  )}
                  <NumField label="Current selling price ($, blank = none)" value={service.currentSellingPrice ?? ''} onChange={(v) => patchService(service.id, { currentSellingPrice: v.trim() === '' ? null : v })} />
                </div>
                <div className="mt-3">
                  {result.state !== 'ok' ? (
                    <p className={`text-sm ${result.state === 'invalid' ? 'text-bad' : 'text-ink-soft'}`}>{result.reasons.join(' ')}</p>
                  ) : (
                    <dl className="space-y-1 text-sm">
                      <Row label="Modeled cost/unit" value={money(result.row.unitCost!.modeledCostPerUnit)} />
                      <Row label="Current price" value={service.currentSellingPrice ? money(new PEP(service.currentSellingPrice)) : '— (none set)'} />
                      <Row label="Status" value={result.row.price ? statusBadge(result.row.price).label : 'Set a price to review'} />
                      {result.row.price && (
                        <>
                          <Row label="Margin" value={result.row.price.marginRatio ? `${result.row.price.marginRatio.times(100).toFixed(1)}%` : '—'} />
                          <Row label="Required price for target margin" value={money(result.row.price.minimumTargetPrice)} />
                        </>
                      )}
                    </dl>
                  )}
                  {/* HEALTH-016: on expand, the full cost breakdown behind
                      the single "Modeled cost/unit" figure above -- every
                      field computeServiceUnitCost already returns, plus
                      the resolved product/geometry inputs that produced
                      it, so a reviewer can see WHY a price is over/under
                      target without re-deriving it by hand. */}
                  {result.state === 'ok' && expandedServiceIds.has(service.id) && (() => {
                    const variant = service.paintVariantId ? catalog.find((v) => v.id === service.paintVariantId) : undefined;
                    const geometry =
                      service.kind === 'door'
                        ? `${service.widthFt ?? '—'} × ${service.heightFt ?? '—'} ft, ${service.paintedSides ?? '—'} side(s), per door`
                        : service.kind === 'trim'
                          ? `${service.developedWidthFt ?? '—'} ft developed width, per linear ft`
                          : 'per ft²';
                    const uc = result.row.unitCost!;
                    return (
                      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-ink-soft">
                        <Row label="Product / color" value={variant ? `${variant.name} / ${variant.color}` : '—'} />
                        <Row label="Coverage" value={variant ? `${variant.coverageFt2PerGal} ft²/gal` : '—'} />
                        <Row label="Coats" value={String(service.coats ?? settings.defaultCoats)} />
                        <Row label="Waste ratio" value={`${new PEP(service.wasteRatio ?? settings.defaultWasteRatio).times(100).toFixed(1)}%`} />
                        <Row label="Geometry" value={geometry} />
                        <Row label="Labor hours/unit" value={uc.laborHoursPerUnit.toFixed(4)} />
                        <Row label="Labor cost/unit" value={money(uc.laborCostPerUnit)} />
                        <Row label="Paint consumption cost/unit" value={money(uc.paintConsumptionCostPerUnit)} />
                        <Row label="Materials/unit" value={money(uc.materialsPerUnit)} />
                        <Row label="Direct cost/unit" value={money(uc.directCostPerUnit)} />
                        <Row label="Overhead/unit" value={money(uc.overheadPerUnit)} />
                      </dl>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'actuals' && (
          <div className="card p-6">
            {!issuedRevision && <p className="text-sm text-ink-soft">Open a project with an issued estimate first — actuals are recorded against an issued baseline.</p>}
            {issuedRevision && (
              <>
                {frozenOutputsMissing && (
                  <p className="mb-3 rounded-btn border border-warn-line bg-warn-soft p-2 text-xs text-warn">
                    This estimate was issued before frozen cost baselines existed — the comparison below uses a live recalculation against today's engine, not the original frozen figures.
                  </p>
                )}
                {/* BACK-026: the frozen baseline itself is ALWAYS trusted
                    and displayed as-is regardless of which engine version
                    produced it (it is never recalculated) -- this is
                    purely informational, never a warning that blocks
                    anything. */}
                {frozenOutputs?.status === 'frozen' && frozenOutputs.engineVersion !== ENGINE_VERSION && (
                  <p className="mb-3 rounded-btn border border-line bg-card p-2 text-xs text-ink-soft">
                    Calculated with app engine version {frozenOutputs.engineVersion} (this app is {ENGINE_VERSION}) — these frozen figures are preserved exactly as issued and are never recalculated.
                  </p>
                )}
                {(['materials', 'labor', 'otherExpenses', 'overhead'] as const).map((cat) => (
                  <div key={cat} className="mb-3">
                    {cat === 'labor' && (
                      <div className="mb-1 flex items-center gap-4 text-xs text-ink-soft">
                        <label className="flex items-center gap-1">
                          <input type="radio" name="laborMode" checked={laborMode === 'direct'} onChange={() => setLaborMode('direct')} />
                          Enter amount directly
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="radio" name="laborMode" checked={laborMode === 'hoursRate'} onChange={() => setLaborMode('hoursRate')} />
                          Hours × rate
                        </label>
                      </div>
                    )}
                    {cat === 'overhead' && (
                      <div className="mb-1 flex items-center gap-4 text-xs text-ink-soft">
                        <label className="flex items-center gap-1">
                          <input type="radio" name="overheadMode" checked={overheadMode === 'baselineAllocation'} onChange={() => setOverheadMode('baselineAllocation')} />
                          Use baseline allocation
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="radio" name="overheadMode" checked={overheadMode === 'actualFlat'} onChange={() => setOverheadMode('actualFlat')} />
                          Enter actual amount
                        </label>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-sm capitalize">
                        <input type="checkbox" checked={actuals[cat].confirmed} onChange={(e) => setActuals((a) => ({ ...a, [cat]: { ...a[cat], confirmed: e.target.checked } }))} />
                        {cat}
                      </label>
                      {cat === 'overhead' ? (
                        <input
                          aria-label="Overhead amount"
                          className={`w-32 rounded-btn border px-2 py-1 tabular-nums ${derivedActuals.overhead.invalid ? 'border-bad' : 'border-line'} ${overheadMode === 'baselineAllocation' ? 'bg-surface-soft' : ''}`}
                          value={overheadMode === 'baselineAllocation' ? baselineOverheadString() ?? '' : actuals.overhead.amount}
                          disabled={overheadMode === 'baselineAllocation'}
                          onChange={(e) => setActuals((a) => ({ ...a, overhead: { ...a.overhead, amount: e.target.value } }))}
                          placeholder="0.00"
                        />
                      ) : cat === 'labor' && laborMode === 'hoursRate' ? (
                        <>
                          <input aria-label="Labor hours" className="w-24 rounded-btn border border-line px-2 py-1 tabular-nums" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} placeholder="hours" />
                          <span className="text-ink-soft">×</span>
                          <input aria-label="Labor rate" className="w-24 rounded-btn border border-line px-2 py-1 tabular-nums" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} placeholder="$/hour" />
                          <span className="text-ink-soft tabular-nums">= {derivedActuals.labor.value ? money(derivedActuals.labor.value) : '—'}</span>
                        </>
                      ) : (
                        <input className={`w-32 rounded-btn border px-2 py-1 tabular-nums ${derivedActuals[cat].invalid ? 'border-bad' : 'border-line'}`} value={actuals[cat].amount} onChange={(e) => setActuals((a) => ({ ...a, [cat]: { ...a[cat], amount: e.target.value } }))} placeholder="0.00" />
                      )}
                    </div>
                    {cat === 'overhead' && overheadMode === 'baselineAllocation' && (
                      <p className="mt-1 text-xs text-ink-soft">Allocated overhead from the issued estimate, not a measured actual overhead figure.</p>
                    )}
                    {derivedActuals[cat].invalid && <p className="mt-1 text-xs text-bad">Enter a plain non-negative number (e.g. 120.50), or leave blank.</p>}
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" disabled={anyActualCategoryInvalid} onClick={saveActuals}>Save actuals</button>
                {anyActualCategoryInvalid && <p className="mt-1 text-xs text-bad">Fix the invalid amount(s) above before saving.</p>}
                {actualResult && (
                  <dl className="mt-4 space-y-2 text-sm">
                    {actualResult.state === 'in_progress' ? (
                      <p className="text-warn">In progress — {actualResult.confirmedCategories}/4 categories confirmed. Final profit/margin is withheld until all four are confirmed.</p>
                    ) : actualResult.state === 'out_of_supported_range' ? (
                      // AGG-005: every category is confirmed, but the SUM
                      // exceeds the supported range -- never render a
                      // "final" total, never null-format into a misleading
                      // "—" among otherwise-normal rows.
                      <p role="alert" className="text-bad">This job's total actual cost exceeds the supported range (max ${MAX_AGGREGATE_MONETARY.toString()}). Double-check your entered amounts.</p>
                    ) : (
                      <>
                        <Row label="Actual cost" value={money(actualResult.actualCost)} />
                        <Row label="Profit vs. original quote" value={money(actualResult.profitAgainstOriginalQuote)} strong />
                        <Row label="Margin" value={actualResult.marginRatio ? `${actualResult.marginRatio.times(100).toFixed(1)}%` : '— (baseline price was $0)'} />
                        <Row label="Total variance vs. estimate" value={money(actualResult.totalVariance)} />
                      </>
                    )}
                  </dl>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'backup' && (
          <div className="card space-y-4 p-6">
            <div>
              <button type="button" className="btn btn-primary" onClick={handleExport}>
                Export backup (.json)
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-soft">Restore from backup</label>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <select
                  className="rounded-btn border border-line px-2 py-1 text-sm"
                  value={importMode}
                  disabled={!!pendingImport}
                  onChange={(e) => setImportMode(e.target.value as typeof importMode)}
                >
                  <option value="merge">Merge with existing (default)</option>
                  <option value="copies">Import as copies</option>
                  <option value="replaceAll">Replace everything</option>
                </select>
                <input
                  type="file"
                  accept="application/json"
                  disabled={!!pendingImport}
                  onChange={(e) => e.target.files?.[0] && handleImportFileSelected(e.target.files[0])}
                />
              </div>
              {importMessage && <p className="mt-2 text-sm text-ink-soft">{importMessage}</p>}
            </div>

            {pendingImport?.mode === 'merge' && (
              <div className="rounded-btn border border-line bg-canvas-soft p-4 text-sm">
                <p className="font-semibold">Import preview — nothing has been saved yet</p>
                <ul className="mt-2 list-disc pl-5 text-ink-soft">
                  <li>{pendingImport.plan.toAdd.projects.length} new project(s) will be added</li>
                  <li>{pendingImport.plan.toAdd.paintVariants.length} new paint variant(s) will be added</li>
                  <li>{pendingImport.plan.toAdd.otherMaterials.length} new other-material(s) will be added</li>
                  <li>{pendingImport.plan.toAdd.serviceDefinitions.length} new service definition(s) will be added</li>
                  <li>{pendingImport.plan.toSkip.projectIds.length} identical project(s) will be skipped (already present)</li>
                  <li>{pendingImport.plan.toSkip.paintVariantIds.length} identical paint variant(s) will be skipped</li>
                </ul>

                {pendingImport.plan.conflicts.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="font-medium text-warn">{pendingImport.plan.conflicts.length} conflict(s) need a choice — your local copy is kept by default:</p>
                    {pendingImport.plan.conflicts.map((c) => (
                      <div key={`${c.kind}:${c.id}`} className="rounded-btn border border-warn-line bg-warn-soft p-3">
                        <p className="text-ink-soft">
                          {c.kind === 'businessSettings' ? 'Business settings' : c.kind === 'paintVariant' ? `Paint variant "${c.id}"` : c.kind === 'otherMaterial' ? `Other material "${c.id}"` : c.kind === 'serviceDefinition' ? `Service definition "${c.id}"` : `Project "${c.id}"`} differs from the imported copy.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          {(['keepLocal', 'replaceImported', ...(c.kind === 'businessSettings' ? [] : (['keepBoth'] as const))] as ImportConflict['resolution'][]).map((opt) => (
                            <label key={opt} className="flex items-center gap-1.5 text-xs">
                              <input
                                type="radio"
                                name={`resolution-${c.kind}-${c.id}`}
                                checked={pendingImport.resolutions[`${c.kind}:${c.id}`] === opt}
                                onChange={() => setImportResolution(c, opt)}
                              />
                              {opt === 'keepLocal' ? 'Keep local' : opt === 'replaceImported' ? 'Use imported' : 'Keep both (import as a copy)'}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn btn-secondary" onClick={cancelImport}>Cancel (nothing will change)</button>
                  <button type="button" className="btn btn-primary" onClick={confirmImport}>Confirm import</button>
                </div>
              </div>
            )}

            {pendingImport?.mode === 'copies' && (
              <div className="rounded-btn border border-line bg-canvas-soft p-4 text-sm">
                <p className="font-semibold">Import-as-copies preview — nothing has been saved yet</p>
                <p className="mt-2 text-ink-soft">
                  {copiesPreviewCounts(pendingImport).toCopyCount} project(s) will be copied with fresh IDs; {copiesPreviewCounts(pendingImport).skipCount} already imported from this export and will be skipped.
                </p>
                {pendingImport.envelope.projects.filter((p) => pendingImport.alreadyImportedSourceIds.includes(p.id)).length > 0 && (
                  <div className="mt-2 space-y-1">
                    {pendingImport.envelope.projects.filter((p) => pendingImport.alreadyImportedSourceIds.includes(p.id)).map((p) => (
                      <label key={p.id} className="flex items-center gap-1.5 text-xs text-ink-soft">
                        <input type="checkbox" checked={pendingImport.forcedSourceIds.includes(p.id)} onChange={() => toggleForceAnotherCopy(p.id)} />
                        "{p.title}" was already imported from this file — copy it again anyway
                      </label>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn btn-secondary" onClick={cancelImport}>Cancel (nothing will change)</button>
                  <button type="button" className="btn btn-primary" onClick={confirmImport}>Confirm import</button>
                </div>
              </div>
            )}

            {pendingImport?.mode === 'replaceAll' && (
              <div className="rounded-btn border border-warn-line bg-warn-soft p-4 text-sm">
                <p className="font-semibold text-warn">Replace everything — nothing has been saved yet</p>
                <p className="mt-2 text-ink-soft">
                  This will DELETE every current project, the paint catalog, other materials, service definitions, and business settings, replacing them entirely with the {pendingImport.envelope.projects.length} project(s) in this file. Download a backup of your CURRENT data first, in case you need to undo this.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-secondary" onClick={downloadPreImportBackup}>
                    {pendingImport.backupDownloaded ? 'Backup downloaded ✓ (download again)' : 'Download a backup of current data first'}
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn btn-secondary" onClick={cancelImport}>Cancel (nothing will change)</button>
                  <button type="button" className="btn btn-primary" disabled={!pendingImport.backupDownloaded} onClick={confirmImport}>
                    Confirm — replace everything
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RoomEditor({ room, surfaces, catalog, onPatchRoom, onDeleteRoom, onAddCeiling, onPatchSurface, onRemoveSurface, onMoveUp, onMoveDown }: {
  room: Room; surfaces: Surface[]; catalog: PaintVariant[];
  onPatchRoom: (patch: Partial<Room>) => void; onDeleteRoom: () => void; onAddCeiling: () => void;
  onPatchSurface: (surfaceId: string, patch: Partial<Surface>) => void; onRemoveSurface: (surfaceId: string) => void;
  /** PRO-014: undefined at the first/last boundary -- rendered as a
   * disabled button rather than omitted, so the control's position never
   * shifts and a keyboard user tabbing through the list always lands on
   * the same control regardless of a room's position. */
  onMoveUp?: () => void; onMoveDown?: () => void;
}) {
  const wall = surfaces.find((s) => s.kind === 'wall');
  const ceiling = surfaces.find((s) => s.kind === 'ceiling');
  return (
    <div className="rounded-btn border border-line p-4">
      <div className="mb-2 flex items-center justify-end gap-1">
        <button type="button" className="btn btn-secondary px-2 py-1 text-xs" aria-label={`Move ${room.name || 'room'} up`} disabled={!onMoveUp} onClick={onMoveUp}>↑ Move up</button>
        <button type="button" className="btn btn-secondary px-2 py-1 text-xs" aria-label={`Move ${room.name || 'room'} down`} disabled={!onMoveDown} onClick={onMoveDown}>↓ Move down</button>
      </div>
      <TextField label="Room name" value={room.name} onChange={(v) => onPatchRoom({ name: v })} />
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumField label="Length (ft)" value={room.lengthFt ?? ''} onChange={(v) => onPatchRoom({ lengthFt: v })} />
        <NumField label="Width (ft)" value={room.widthFt ?? ''} onChange={(v) => onPatchRoom({ widthFt: v })} />
        <NumField label="Height (ft)" value={room.heightFt ?? ''} onChange={(v) => onPatchRoom({ heightFt: v })} />
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={room.deductionEnabled} onChange={(e) => onPatchRoom({ deductionEnabled: e.target.checked })} /> Deduct openings
        </label>
        {room.deductionEnabled && (
          <label className="block text-sm">
            <span className="font-medium text-ink-soft">Opening entry</span>
            <select
              className="mt-1 rounded-btn border border-line px-2 py-1"
              value={room.openingMode}
              onChange={(e) => onPatchRoom({ openingMode: e.target.value as 'quick' | 'detailed' })}
            >
              <option value="quick">Quick (20/15 ft² each)</option>
              <option value="detailed">Detailed (measured)</option>
            </select>
          </label>
        )}
      </div>
      {room.deductionEnabled && room.openingMode === 'quick' && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <NumField label="Doors" value={String(room.quick.doorCount)} onChange={(v) => { const parsed = parseOpeningCountInput(v); if (parsed !== 'reject') onPatchRoom({ quick: { ...room.quick, doorCount: parsed } }); }} />
          <NumField label="Windows" value={String(room.quick.windowCount)} onChange={(v) => { const parsed = parseOpeningCountInput(v); if (parsed !== 'reject') onPatchRoom({ quick: { ...room.quick, windowCount: parsed } }); }} />
        </div>
      )}
      {room.deductionEnabled && room.openingMode === 'detailed' && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-ink-soft">Measured openings supersede the quick 20/15 ft² constants — enter each opening's own width and height.</p>
          {room.openings.map((o) => (
            <div key={o.id} className="grid grid-cols-2 items-end gap-2 rounded-btn border border-line p-2 sm:grid-cols-5">
              <label className="block text-sm">
                <span className="font-medium text-ink-soft">Type</span>
                <select className="mt-1 w-full rounded-btn border border-line px-2 py-1" value={o.type} onChange={(e) => onPatchRoom({ openings: room.openings.map((x) => (x.id === o.id ? { ...x, type: e.target.value as 'door' | 'window' } : x)) })}>
                  <option value="door">Door</option>
                  <option value="window">Window</option>
                </select>
              </label>
              <NumField label="Width (ft)" value={o.widthFt} onChange={(v) => onPatchRoom({ openings: room.openings.map((x) => (x.id === o.id ? { ...x, widthFt: v } : x)) })} />
              <NumField label="Height (ft)" value={o.heightFt} onChange={(v) => onPatchRoom({ openings: room.openings.map((x) => (x.id === o.id ? { ...x, heightFt: v } : x)) })} />
              <NumField label="Count" value={String(o.count)} onChange={(v) => { const parsed = parseOpeningCountInput(v); if (parsed !== 'reject') onPatchRoom({ openings: room.openings.map((x) => (x.id === o.id ? { ...x, count: parsed } : x)) }); }} />
              <button type="button" className="text-link text-xs text-bad" onClick={() => onPatchRoom({ openings: room.openings.filter((x) => x.id !== o.id) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={() => onPatchRoom({ openings: [...room.openings, { id: defaultIdSource.nextId(), type: 'door', widthFt: '', heightFt: '', count: 1 }] })}>+ Add measured opening</button>
          {room.openings.length === 0 && <p className="text-sm text-ink-soft">No measured openings added.</p>}
        </div>
      )}

      {wall && (
        <SurfaceRow label="Wall" surface={wall} catalog={catalog} onPatch={(patch) => onPatchSurface(wall.id, patch)} />
      )}
      {ceiling ? (
        <SurfaceRow label="Ceiling" surface={ceiling} catalog={catalog} onPatch={(patch) => onPatchSurface(ceiling.id, patch)} onRemove={() => onRemoveSurface(ceiling.id)} />
      ) : (
        <button type="button" className="text-link mt-2 text-xs" onClick={onAddCeiling}>+ Add ceiling (own paint variant)</button>
      )}

      <button type="button" className="text-link mt-3 block text-xs text-bad" onClick={onDeleteRoom}>Remove room</button>
    </div>
  );
}

function SurfaceRow({ label, surface, catalog, onPatch, onRemove }: { label: string; surface: Surface; catalog: PaintVariant[]; onPatch: (patch: Partial<Surface>) => void; onRemove?: () => void }) {
  return (
    <div className="mt-3 rounded-btn bg-line-soft p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={surface.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} /> Enabled
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="font-medium text-ink-soft">Paint variant</span>
          <select className="mt-1 w-full rounded-btn border border-line px-2 py-1" value={surface.paintVariantId ?? ''} onChange={(e) => onPatch({ paintVariantId: e.target.value })}>
            {catalog.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
          </select>
        </label>
        <NumField label="Coats 1-5 (blank = default)" value={surface.coats?.toString() ?? ''} onChange={(v) => { const parsed = parseCoatsInput(v); if (parsed !== 'reject') onPatch({ coats: parsed }); }} />
        <NumField label="Waste ratio (blank = default)" value={surface.wasteRatio ?? ''} onChange={(v) => onPatch({ wasteRatio: v.trim() === '' ? null : v })} />
        <NumField label="Throughput override" value={surface.throughput ?? ''} onChange={(v) => onPatch({ throughput: v.trim() === '' ? null : v })} />
      </div>
      {onRemove && <button type="button" className="text-link mt-2 text-xs" onClick={onRemove}>Remove ceiling</button>}
    </div>
  );
}

function StandaloneSurfaceEditor({ surface, catalog, onPatch, onRemove, onMoveUp, onMoveDown }: {
  surface: Surface; catalog: PaintVariant[]; onPatch: (patch: Partial<Surface>) => void; onRemove: () => void;
  onMoveUp?: () => void; onMoveDown?: () => void;
}) {
  return (
    <div className="rounded-btn border border-line p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium capitalize">{surface.kind}</span>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary px-2 py-1 text-xs" aria-label={`Move this ${surface.kind} up`} disabled={!onMoveUp} onClick={onMoveUp}>↑</button>
          <button type="button" className="btn btn-secondary px-2 py-1 text-xs" aria-label={`Move this ${surface.kind} down`} disabled={!onMoveDown} onClick={onMoveDown}>↓</button>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={surface.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} /> Enabled
          </label>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="font-medium text-ink-soft">Paint variant</span>
          <select className="mt-1 w-full rounded-btn border border-line px-2 py-1" value={surface.paintVariantId ?? ''} onChange={(e) => onPatch({ paintVariantId: e.target.value })}>
            {catalog.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
          </select>
        </label>
        {surface.kind === 'trim' ? (
          <>
            <NumField label="Trim length (ft)" value={surface.trimLengthFt ?? ''} onChange={(v) => onPatch({ trimLengthFt: v })} />
            <NumField label="Developed width (ft)" value={surface.developedWidthFt ?? ''} onChange={(v) => onPatch({ developedWidthFt: v })} />
            <NumField label="Throughput (linear ft/hr/coat)" value={surface.throughput ?? ''} onChange={(v) => onPatch({ throughput: v.trim() === '' ? null : v })} />
          </>
        ) : (
          <>
            <NumField label="Door count" value={surface.doorCount?.toString() ?? ''} onChange={(v) => { const parsed = parseOpeningCountInput(v); if (parsed !== 'reject') onPatch({ doorCount: parsed }); }} />
            <NumField label="Width (ft)" value={surface.widthFt ?? ''} onChange={(v) => onPatch({ widthFt: v })} />
            <NumField label="Height (ft)" value={surface.heightFt ?? ''} onChange={(v) => onPatch({ heightFt: v })} />
            <label className="block text-sm">
              <span className="font-medium text-ink-soft">Painted sides</span>
              <select className="mt-1 w-full rounded-btn border border-line px-2 py-1" value={surface.paintedSides ?? 1} onChange={(e) => onPatch({ paintedSides: Number(e.target.value) as 1 | 2 })}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
            <NumField label="Hours/side/coat override" value={surface.hoursPerSidePerCoat ?? ''} onChange={(v) => onPatch({ hoursPerSidePerCoat: v.trim() === '' ? null : v })} />
          </>
        )}
        <NumField label="Coats 1-5 (blank = default)" value={surface.coats?.toString() ?? ''} onChange={(v) => { const parsed = parseCoatsInput(v); if (parsed !== 'reject') onPatch({ coats: parsed }); }} />
        <NumField label="Waste ratio (blank = default)" value={surface.wasteRatio ?? ''} onChange={(v) => onPatch({ wasteRatio: v.trim() === '' ? null : v })} />
      </div>
      <button type="button" className="text-link mt-2 text-xs text-bad" onClick={onRemove}>Remove surface</button>
    </div>
  );
}

function RateRefreshPanel({ diff, catalog, resolutions, onResolutionsChange, onConfirm, onCancel }: {
  diff: RateRefreshDiff; catalog: PaintVariant[]; resolutions: Record<string, VariantResolution>;
  onResolutionsChange: (r: Record<string, VariantResolution>) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const allMissingResolved = diff.missingVariantIds.every((id) => resolutions[id]);
  return (
    <div className="mt-3 rounded-btn border border-line p-4">
      {diff.variantChanges.length === 0 && diff.missingVariantIds.length === 0 && diff.settingsChanges.length === 0 && (
        <p className="text-sm text-ink-soft">No changes since this draft's rates were captured.</p>
      )}
      {diff.variantChanges.length > 0 && (
        <div>
          <p className="text-sm font-semibold">Paint catalog changes</p>
          <ul className="mt-1 text-sm">
            {diff.variantChanges.map((c, i) => (<li key={i}>{c.variantName} · {c.field}: {c.oldValue} → {c.newValue}</li>))}
          </ul>
        </div>
      )}
      {diff.settingsChanges.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold">Business settings changes</p>
          <ul className="mt-1 text-sm">
            {diff.settingsChanges.map((c, i) => (<li key={i}>{c.field}: {c.oldValue ?? '—'} → {c.newValue ?? '—'}</li>))}
          </ul>
        </div>
      )}
      {diff.missingVariantIds.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-warn">These surfaces use a paint variant no longer in your catalog — choose how to handle each before confirming.</p>
          {diff.missingVariantIds.map((variantId) => (
            <div key={variantId} className="mt-2 flex items-center gap-2 text-sm">
              <span>{variantId}</span>
              <button type="button" className={`btn ${resolutions[variantId]?.action === 'retain' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => onResolutionsChange({ ...resolutions, [variantId]: { variantId, action: 'retain' } })}>
                Keep using its old price/coverage
              </button>
              <select
                className="rounded-btn border border-line px-2 py-1"
                value={resolutions[variantId]?.action === 'replaceWith' ? resolutions[variantId].newVariantId : ''}
                onChange={(e) => e.target.value && onResolutionsChange({ ...resolutions, [variantId]: { variantId, action: 'replaceWith', newVariantId: e.target.value } })}
              >
                <option value="">Replace with…</option>
                {catalog.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
              </select>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!allMissingResolved} onClick={onConfirm}>Confirm refresh</button>
      </div>
    </div>
  );
}

/** CAT-008: preview a service's own customized fields against the
 * CURRENT live business defaults before touching anything. Each field is
 * an opt-in checkbox (default unchecked -- "keep my custom value"); the
 * before/after modeled-cost/price/margin comparison is computed live via
 * the same real assembleServiceHealth the row itself already uses,
 * against a candidate service with only the checked fields reverted. */
function ServiceRefreshPanel({ service, beforeResult, catalog, settings, diff, fieldsToRevert, onFieldsToRevertChange, onConfirm, onCancel }: {
  service: ServiceDefinition; beforeResult: ServiceHealthAssemblyResult; catalog: PaintVariant[]; settings: BusinessSettings;
  diff: ServiceRefreshDiff; fieldsToRevert: Set<ServiceRefreshableField>;
  onFieldsToRevertChange: (fields: Set<ServiceRefreshableField>) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const afterResult = assembleServiceHealth(applyServiceDefaultsRefresh(service, fieldsToRevert), catalog, settings);
  return (
    <div className="mt-3 rounded-btn border border-line p-4">
      {diff.fieldChanges.length === 0 && !diff.variantMissing && <p className="text-sm text-ink-soft">No customized assumptions to review — every field on this service already tracks your current defaults.</p>}
      {diff.fieldChanges.length > 0 && (
        <div>
          <p className="text-sm font-semibold">Customized assumptions vs. your current defaults</p>
          <ul className="mt-1 space-y-1 text-sm">
            {diff.fieldChanges.map((c) => (
              <li key={c.field} className="flex items-center gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={fieldsToRevert.has(c.field)}
                    onChange={(e) => {
                      const next = new Set(fieldsToRevert);
                      if (e.target.checked) next.add(c.field); else next.delete(c.field);
                      onFieldsToRevertChange(next);
                    }}
                  />
                  Update {c.label} to current default
                </label>
                <span className="text-ink-soft">({c.customValue} → {c.liveDefaultValue ?? '—'})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {diff.variantMissing && (
        <p className="mt-3 text-sm text-warn">This service's paint variant no longer exists in your catalog — choose a replacement using the "Paint variant" selector above before confirming.</p>
      )}
      {diff.fieldChanges.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-semibold">Effect on this service if confirmed</p>
          <Row label="Modeled cost/unit" value={beforeResult.state === 'ok' ? `${money(beforeResult.row.unitCost!.modeledCostPerUnit)} → ${afterResult.state === 'ok' ? money(afterResult.row.unitCost!.modeledCostPerUnit) : '—'}` : '—'} />
          <Row
            label="Status"
            value={
              beforeResult.state === 'ok' && beforeResult.row.price
                ? `${statusBadge(beforeResult.row.price).label} → ${afterResult.state === 'ok' && afterResult.row.price ? statusBadge(afterResult.row.price).label : '—'}`
                : '—'
            }
          />
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={diff.fieldChanges.length === 0 || fieldsToRevert.size === 0} onClick={onConfirm}>Confirm updates</button>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, className = '' }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="font-medium text-ink-soft">{label}</span>
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-btn border border-line bg-card px-3 py-2 text-ink tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-ink-soft">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-btn border border-line bg-card px-3 py-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
    </label>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}
