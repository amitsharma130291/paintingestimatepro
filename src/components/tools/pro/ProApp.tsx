import { useEffect, useMemo, useState } from 'react';
import { PEP } from '../../../engine/decimal';
import { evaluateActualReview, type ActualCategory } from '../../../engine/actuals';
import { computeServiceUnitCost, evaluateServiceHealth } from '../../../engine/serviceHealth';
import { statusBadge, money } from '../shared';
import type { BusinessSettings, PaintVariant, Project, Room, Surface, EstimateRevision, ServiceKind } from '../../../domain/entities';
import { createSnapshot } from '../../../domain/snapshot';
import { createDraftRevision, issueRevision, createDraftFromIssued, checkIssueGate, updateRoom, removeRoom } from '../../../domain/project';
import { assembleProjectEstimate, type ProjectEstimateAssembly } from '../../../domain/estimateAssembly';
import { previewRateRefresh, applyRateRefresh, type RateRefreshDiff, type VariantResolution } from '../../../domain/rateRefresh';
import { buildCustomerDocument } from '../../../domain/customerDocument';
import { exportBackup, validateBackupEnvelope } from '../../../domain/backup';
import { defaultIdSource } from '../../../domain/ids';
import { ConflictError } from '../../../storage/db';
import { loadSnapshot, saveBusinessSettings, savePaintVariants, saveProjectSafely, saveProjects } from './proStore';

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

  const [settings, setSettings] = useState<BusinessSettings>(defaultSettings());
  const [catalog, setCatalog] = useState<PaintVariant[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [draftEdit, setDraftEdit] = useState<EstimateRevision | null>(null);
  const [draftBaselineUpdatedAt, setDraftBaselineUpdatedAt] = useState<string | null>(null);
  const [customPriceRaw, setCustomPriceRaw] = useState('');
  const [conflict, setConflict] = useState<{ project: Project; attempted: Project } | null>(null);
  const [refreshPreview, setRefreshPreview] = useState<{ diff: RateRefreshDiff; resolutions: Record<string, VariantResolution> } | null>(null);

  const [actuals, setActuals] = useState<Record<'materials' | 'labor' | 'otherExpenses' | 'overhead', { confirmed: boolean; amount: string }>>({
    materials: { confirmed: false, amount: '' },
    labor: { confirmed: false, amount: '' },
    otherExpenses: { confirmed: false, amount: '' },
    overhead: { confirmed: false, amount: '' },
  });
  const [importMessage, setImportMessage] = useState<string | null>(null);

  useEffect(() => {
    loadSnapshot()
      .then((snap) => {
        if (snap.businessSettings[0]) setSettings(snap.businessSettings[0]);
        if (snap.paintVariants.length) setCatalog(snap.paintVariants);
        if (snap.projects.length) setProjects(snap.projects);
      })
      .catch(() => {
        /* fresh install — defaults stand */
      })
      .finally(() => setLoading(false));
  }, []);

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
    const project: Project = { id: revision.projectId, title: 'New project', revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: now(), updatedAt: now() };
    setProjects((ps) => [...ps, project]);
    setActiveProjectId(project.id);
    setDraftEdit(revision);
    setDraftBaselineUpdatedAt(null);
    setCustomPriceRaw('');
    setRefreshPreview(null);
  }

  function openProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const revision = project.revisions.find((r) => r.id === project.activeRevisionId) ?? project.revisions[project.revisions.length - 1];
    setActiveProjectId(projectId);
    setDraftEdit(revision);
    setDraftBaselineUpdatedAt(project.updatedAt);
    setCustomPriceRaw(revision.priceMode === 'custom' ? revision.proposedPrice ?? '' : '');
    setRefreshPreview(null);
  }

  function editIssuedAsNewDraft(project: Project, issued: EstimateRevision) {
    const newDraft = createDraftFromIssued(issued, ids);
    setActiveProjectId(project.id);
    setDraftEdit(newDraft);
    setDraftBaselineUpdatedAt(project.updatedAt);
    setCustomPriceRaw(newDraft.priceMode === 'custom' ? newDraft.proposedPrice ?? '' : '');
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

  function addRoom() {
    if (!draftEdit || catalog.length === 0) return;
    const room = blankRoom(`Room ${draftEdit.rooms.length + 1}`);
    const wall = blankSurface('wall', room.id, 'roomDerived', catalog[0].id);
    room.surfaceIds = [wall.id];
    mutateDraft((r) => ({ ...r, rooms: [...r.rooms, room], surfaces: [...r.surfaces, wall], updatedAt: ids.now() }));
  }

  function addCeilingToRoom(room: Room) {
    if (!draftEdit || catalog.length === 0) return;
    const ceiling = blankSurface('ceiling', room.id, 'roomDerived', catalog[0].id);
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
    if (!draftEdit || catalog.length === 0) return;
    const s = blankSurface(kind, null, 'manual', catalog[0].id);
    mutateDraft((r) => ({ ...r, surfaces: [...r.surfaces, s], updatedAt: ids.now() }));
  }

  async function saveDraft() {
    if (!draftEdit || !activeProject) return;
    const revisionToSave: EstimateRevision = {
      ...draftEdit,
      calculationState: summary?.calculationState ?? 'incomplete',
      proposedPrice: draftEdit.priceMode === 'custom' ? (customPriceRaw.trim() === '' ? null : customPriceRaw) : summary?.effectivePrice?.toFixed(2) ?? null,
    };
    const nextProject: Project = {
      ...activeProject,
      revisions: activeProject.revisions.map((r) => (r.id === revisionToSave.id ? revisionToSave : r)),
      activeRevisionId: revisionToSave.id,
      updatedAt: now(),
    };
    try {
      await saveProjectSafely(nextProject, draftBaselineUpdatedAt);
      setProjects((ps) => ps.map((p) => (p.id === nextProject.id ? nextProject : p)));
      setDraftEdit(revisionToSave);
      setDraftBaselineUpdatedAt(nextProject.updatedAt);
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
    setProjects((ps) => ps.map((p) => (p.id === conflict.project.id ? conflict.project : p)));
    openProject(conflict.project.id);
    setConflict(null);
    setSaveMessage('Reloaded the latest saved version — your conflicting edit was discarded.');
  }

  async function resolveConflictSaveAsCopy() {
    if (!conflict || !draftEdit) return;
    const newProjectId = ids.nextId();
    const copiedRevision: EstimateRevision = { ...draftEdit, id: ids.nextId(), projectId: newProjectId };
    const copy: Project = { ...conflict.attempted, id: newProjectId, title: `${conflict.attempted.title} (my copy)`, revisions: [copiedRevision], activeRevisionId: copiedRevision.id, createdAt: now(), updatedAt: now() };
    try {
      await saveProjectSafely(copy, null);
      setProjects((ps) => [...ps.map((p) => (p.id === conflict.project.id ? conflict.project : p)), copy]);
      setConflict(null);
      openProject(copy.id);
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
      const refreshed = applyRateRefresh(draftEdit, liveSnapshot, resolutions, ids);
      setDraftEdit(refreshed);
      setRefreshPreview(null);
      setSaveMessage('Rates refreshed. Review the updated summary, then save.');
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Refresh failed.');
    }
  }

  const issueGate = useMemo(() => {
    if (!draftEdit || !summary) return { canIssue: false, reasons: ['Add at least one enabled surface.'] };
    const forGate: EstimateRevision = {
      ...draftEdit,
      calculationState: summary.calculationState,
      proposedPrice: draftEdit.priceMode === 'custom' ? (customPriceRaw.trim() === '' ? null : customPriceRaw) : summary.effectivePrice?.toFixed(2) ?? null,
    };
    return checkIssueGate(forGate, { sampleAssumptionsConfirmed: settings.sampleAssumptionsConfirmed, zeroPriceConfirmed: false });
  }, [draftEdit, summary, settings.sampleAssumptionsConfirmed, customPriceRaw]);

  async function issueEstimate() {
    if (!draftEdit || !activeProject || !summary || summary.calculationState !== 'complete') return;
    const proposedPrice = draftEdit.priceMode === 'custom' ? customPriceRaw : summary.effectivePrice?.toFixed(2) ?? null;
    const ready: EstimateRevision = { ...draftEdit, calculationState: 'complete', proposedPrice, title: draftEdit.title || activeProject.title };
    const issueNumber = `E-${activeProject.id.slice(-6)}-${draftEdit.revisionNumber}`;
    const issued = issueRevision(ready, (r) => buildCustomerDocument(r, { estimateNumber: issueNumber, estimateDate: now().slice(0, 10), projectAddress: '', revisionLabel: `Rev ${draftEdit.revisionNumber}` }), ids);
    const nextProject: Project = { ...activeProject, revisions: activeProject.revisions.map((r) => (r.id === issued.id ? issued : r)), activeRevisionId: issued.id, updatedAt: now() };
    try {
      await saveProjectSafely(nextProject, draftBaselineUpdatedAt);
      setProjects((ps) => ps.map((p) => (p.id === nextProject.id ? nextProject : p)));
      setDraftEdit(issued);
      setDraftBaselineUpdatedAt(nextProject.updatedAt);
      setSaveMessage('Estimate issued and saved.');
    } catch (err) {
      if (err instanceof ConflictError) setConflict({ project: err.currentRecord as Project, attempted: nextProject });
      else setSaveMessage('Issued locally, but saving failed — your previous data was not changed.');
    }
  }

  // ---- Price Book Health (uses catalog[0] + settings as a live service model) ----
  const healthRows = useMemo(() => {
    if (catalog.length === 0 || !settings.loadedHourlyRate) return [];
    const variant = catalog[0];
    const unit = computeServiceUnitCost({
      kind: 'wall',
      areaPerUnit: new PEP(1),
      coats: settings.defaultCoats,
      wasteRatio: new PEP(settings.defaultWasteRatio),
      coverageFt2PerGal: new PEP(variant.coverageFt2PerGal),
      pricePerGal: new PEP(variant.pricePerGal),
      applicationHoursPerUnit: new PEP(settings.defaultCoats).dividedBy(new PEP(settings.wallThroughput ?? '150')),
      additionalLaborHoursPerUnit: new PEP(0),
      loadedHourlyRate: new PEP(settings.loadedHourlyRate),
      suppliesCostPerUnit: new PEP(0),
      directExpensePerUnit: new PEP(0),
      overheadRatio: new PEP(settings.overheadRatio),
    });
    return [evaluateServiceHealth('wall-standard', unit, null, new PEP(settings.targetMarginRatio))];
  }, [catalog, settings]);

  // ---- Actuals (scoped to the active project's issued revision) ----
  const issuedRevision = activeProject?.revisions.find((r) => r.state === 'issued' && r.id === activeProject.activeRevisionId) ?? activeProject?.revisions.find((r) => r.state === 'issued') ?? null;
  const actualResult = useMemo(() => {
    if (!issuedRevision || !issuedRevision.proposedPrice) return null;
    const toCategory = (c: { confirmed: boolean; amount: string }): ActualCategory => ({ confirmed: c.confirmed, amount: c.confirmed && c.amount.trim() !== '' ? new PEP(c.amount) : null });
    const storedJobCost = (issuedRevision.rawCalculatedOutputs as { jobCost?: string } | null)?.jobCost;
    const issuedSummary = assembleProjectEstimate(issuedRevision, { priceMode: issuedRevision.priceMode, customPriceRaw: issuedRevision.proposedPrice ?? '' });
    const baselineCost = storedJobCost ?? (issuedSummary.calculationState === 'complete' ? issuedSummary.jobCost!.toString() : '0');
    return evaluateActualReview({
      materials: toCategory(actuals.materials),
      labor: toCategory(actuals.labor),
      otherExpenses: toCategory(actuals.otherExpenses),
      overhead: toCategory(actuals.overhead),
      baselinePrice: new PEP(issuedRevision.proposedPrice),
      baselineCost: new PEP(baselineCost),
    });
  }, [issuedRevision, actuals]);

  // ---- Backup ----
  async function handleExport() {
    const envelope = exportBackup('install-local', settings, catalog, [], [], projects, ids);
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

  async function handleImport(file: File) {
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
    setSettings(result.envelope.businessSettings);
    setCatalog(result.envelope.paintVariants);
    setProjects(result.envelope.projects);
    try {
      await saveBusinessSettings(result.envelope.businessSettings);
      await savePaintVariants(result.envelope.paintVariants);
      await saveProjects(result.envelope.projects);
      setImportMessage(`Restored ${result.envelope.projects.length} project(s) and ${result.envelope.paintVariants.length} paint variant(s).`);
    } catch {
      setImportMessage('Restore failed while saving — your previous data was not changed.');
    }
  }

  if (loading) return <div className="card p-6 text-sm text-ink-soft">Loading…</div>;

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-line pb-3">
        {(['settings', 'catalog', 'projects', 'health', 'actuals', 'backup'] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`btn ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
            {t === 'settings' ? 'Business settings' : t === 'catalog' ? 'Paint catalog' : t === 'projects' ? 'Projects' : t === 'health' ? 'Price Book Health' : t === 'actuals' ? 'Actual review' : 'Backup'}
          </button>
        ))}
      </div>
      {saveMessage && <p className="mt-3 text-xs text-ink-soft">{saveMessage}</p>}
      {conflict && (
        <div className="mt-3 rounded-btn border border-warn-line bg-warn-soft p-4 text-sm text-warn">
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
                return (
                  <button key={p.id} type="button" onClick={() => openProject(p.id)} className="block w-full rounded-btn border border-line p-3 text-left hover:border-primary">
                    <span className="font-semibold">{p.title}</span>
                    <span className="ml-2 text-xs text-ink-soft">{rev.state} · rev {rev.revisionNumber}</span>
                  </button>
                );
              })}
              {projects.length === 0 && <p className="text-sm text-ink-soft">No projects yet.</p>}
            </div>
          </div>
        )}

        {tab === 'projects' && activeProjectId && draftEdit && activeProject && (
          <div className="space-y-4">
            <button type="button" className="text-link text-xs" onClick={() => { setActiveProjectId(null); setDraftEdit(null); }}>
              ← Back to projects
            </button>

            <div className="card p-6">
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
              <>
                <div className="card p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Rooms</h3>
                    <button type="button" className="btn btn-secondary" disabled={catalog.length === 0} onClick={addRoom}>+ Add room</button>
                  </div>
                  <div className="mt-4 space-y-4">
                    {draftEdit.rooms.map((room) => (
                      <RoomEditor
                        key={room.id}
                        room={room}
                        surfaces={draftEdit.surfaces.filter((s) => room.surfaceIds.includes(s.id))}
                        catalog={catalog}
                        onPatchRoom={(patch) => patchRoom(room.id, patch)}
                        onDeleteRoom={() => deleteRoom(room.id)}
                        onAddCeiling={() => addCeilingToRoom(room)}
                        onPatchSurface={patchSurface}
                        onRemoveSurface={removeSurface}
                      />
                    ))}
                  </div>
                </div>

                <div className="card p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Standalone surfaces (no room required)</h3>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-secondary" disabled={catalog.length === 0} onClick={() => addStandaloneSurface('trim')}>+ Trim</button>
                      <button type="button" className="btn btn-secondary" disabled={catalog.length === 0} onClick={() => addStandaloneSurface('door')}>+ Door</button>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {draftEdit.surfaces.filter((s) => s.roomId === null).map((s) => (
                      <StandaloneSurfaceEditor key={s.id} surface={s} catalog={catalog} onPatch={(patch) => patchSurface(s.id, patch)} onRemove={() => removeSurface(s.id)} />
                    ))}
                    {draftEdit.surfaces.filter((s) => s.roomId === null).length === 0 && <p className="text-sm text-ink-soft">No standalone trim or door surfaces added.</p>}
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
                </div>

                <div className="card p-6">
                  <h3 className="font-semibold">Estimate summary</h3>
                  {summary && summary.calculationState !== 'complete' && (
                    <p className="mt-2 text-sm text-bad">{summary.calculationState === 'invalid' ? 'One or more enabled surfaces have invalid inputs.' : 'Add at least one enabled, fully-specified surface.'} {summary.reasons.join(' ')}</p>
                  )}
                  {summary && summary.calculationState === 'complete' && (
                    <>
                      <dl className="mt-2 space-y-2 text-sm">
                        <Row label="Materials" value={money(summary.materials)} />
                        <Row label="Labor" value={money(summary.laborCost)} />
                        <Row label="Direct cost" value={money(summary.directCost)} />
                        <Row label="Overhead" value={money(summary.overhead)} />
                        <Row label="Estimated job cost" value={money(summary.jobCost)} strong />
                      </dl>

                      <div className="mt-4 flex gap-2">
                        <button type="button" className={`btn ${draftEdit.priceMode === 'suggested' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => mutateDraft((r) => ({ ...r, priceMode: 'suggested', updatedAt: ids.now() }))}>Suggested price</button>
                        <button type="button" className={`btn ${draftEdit.priceMode === 'custom' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => mutateDraft((r) => ({ ...r, priceMode: 'custom', updatedAt: ids.now() }))}>Custom price</button>
                      </div>
                      {draftEdit.priceMode === 'custom' && <NumField label="Your price ($)" value={customPriceRaw} onChange={setCustomPriceRaw} className="mt-2 max-w-xs" />}

                      <dl className="mt-4 space-y-2 text-sm">
                        <Row label="Proposed price" value={summary.effectivePrice ? money(summary.effectivePrice) : '—'} strong />
                        <Row label="Profit" value={summary.price?.profit ? money(summary.price.profit) : '—'} />
                        <Row label="Margin" value={summary.price?.marginRatio ? `${summary.price.marginRatio.times(100).toFixed(1)}%` : '—'} />
                        {summary.price && (
                          <div>
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge(summary.price).className}`}>{statusBadge(summary.price).label}</span>
                          </div>
                        )}
                      </dl>

                      <div className="mt-4 flex gap-2">
                        <button type="button" className="btn btn-secondary" onClick={saveDraft}>Save draft</button>
                        <button type="button" className="btn btn-primary" disabled={!issueGate.canIssue} onClick={issueEstimate}>Issue estimate</button>
                      </div>
                      {!issueGate.canIssue && (
                        <ul className="mt-2 text-xs text-warn">
                          {issueGate.reasons.map((r, i) => (<li key={i}>{r}</li>))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            {draftEdit.customerDocumentSnapshot && (
              <div className="card p-6">
                <p className="tag-preview mb-2 inline-block">Customer-facing document</p>
                <p className="font-semibold">{draftEdit.customerDocumentSnapshot.projectTitle}</p>
                <p className="text-sm text-ink-soft">Estimate {draftEdit.customerDocumentSnapshot.estimateNumber} — {draftEdit.customerDocumentSnapshot.estimateDate} · {draftEdit.customerDocumentSnapshot.status}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">${draftEdit.customerDocumentSnapshot.proposedPrice}</p>
                <p className="text-xs text-ink-soft">{draftEdit.customerDocumentSnapshot.taxNotice}</p>
                <ul className="mt-2 text-sm text-ink-soft">
                  {draftEdit.customerDocumentSnapshot.scopeLines.map((line, i) => (<li key={i}>{line}</li>))}
                </ul>
                <p className="mt-2 text-xs text-ink-soft italic">No cost, overhead, or margin figures appear on this document — verified by allow-list, see IMPLEMENTATION_DECISIONS.md.</p>
              </div>
            )}
          </div>
        )}

        {tab === 'health' && (
          <div className="card p-6">
            {healthRows.length === 0 && <p className="text-sm text-ink-soft">Add a paint variant and set a labor rate first.</p>}
            {healthRows.map((row) => (
              <div key={row.serviceId} className="rounded-btn border border-line p-4">
                <p className="font-semibold">Wall (standard) — $/ft²</p>
                {row.unitCost && (
                  <dl className="mt-2 space-y-1 text-sm">
                    <Row label="Modeled cost/unit" value={money(row.unitCost.modeledCostPerUnit)} />
                    <Row label="Status" value={row.price ? statusBadge(row.price).label : 'Set a price to review'} />
                  </dl>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'actuals' && (
          <div className="card p-6">
            {!issuedRevision && <p className="text-sm text-ink-soft">Open a project with an issued estimate first — actuals are recorded against an issued baseline.</p>}
            {issuedRevision && (
              <>
                {(['materials', 'labor', 'otherExpenses', 'overhead'] as const).map((cat) => (
                  <div key={cat} className="mb-3 flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm capitalize">
                      <input type="checkbox" checked={actuals[cat].confirmed} onChange={(e) => setActuals((a) => ({ ...a, [cat]: { ...a[cat], confirmed: e.target.checked } }))} />
                      {cat}
                    </label>
                    <input className="w-32 rounded-btn border border-line px-2 py-1 tabular-nums" value={actuals[cat].amount} onChange={(e) => setActuals((a) => ({ ...a, [cat]: { ...a[cat], amount: e.target.value } }))} placeholder="0.00" />
                  </div>
                ))}
                {actualResult && (
                  <dl className="mt-4 space-y-2 text-sm">
                    {actualResult.state === 'in_progress' ? (
                      <p className="text-warn">In progress — {actualResult.confirmedCategories}/4 categories confirmed. Final profit/margin is withheld until all four are confirmed.</p>
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
              <input type="file" accept="application/json" className="mt-1" onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} />
              {importMessage && <p className="mt-2 text-sm text-ink-soft">{importMessage}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RoomEditor({ room, surfaces, catalog, onPatchRoom, onDeleteRoom, onAddCeiling, onPatchSurface, onRemoveSurface }: {
  room: Room; surfaces: Surface[]; catalog: PaintVariant[];
  onPatchRoom: (patch: Partial<Room>) => void; onDeleteRoom: () => void; onAddCeiling: () => void;
  onPatchSurface: (surfaceId: string, patch: Partial<Surface>) => void; onRemoveSurface: (surfaceId: string) => void;
}) {
  const wall = surfaces.find((s) => s.kind === 'wall');
  const ceiling = surfaces.find((s) => s.kind === 'ceiling');
  return (
    <div className="rounded-btn border border-line p-4">
      <TextField label="Room name" value={room.name} onChange={(v) => onPatchRoom({ name: v })} />
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumField label="Length (ft)" value={room.lengthFt ?? ''} onChange={(v) => onPatchRoom({ lengthFt: v })} />
        <NumField label="Width (ft)" value={room.widthFt ?? ''} onChange={(v) => onPatchRoom({ widthFt: v })} />
        <NumField label="Height (ft)" value={room.heightFt ?? ''} onChange={(v) => onPatchRoom({ heightFt: v })} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumField label="Doors" value={String(room.quick.doorCount)} onChange={(v) => onPatchRoom({ quick: { ...room.quick, doorCount: Number.parseInt(v, 10) || 0 } })} />
        <NumField label="Windows" value={String(room.quick.windowCount)} onChange={(v) => onPatchRoom({ quick: { ...room.quick, windowCount: Number.parseInt(v, 10) || 0 } })} />
        <label className="flex items-center gap-2 pt-5 text-sm">
          <input type="checkbox" checked={room.deductionEnabled} onChange={(e) => onPatchRoom({ deductionEnabled: e.target.checked })} /> Deduct openings
        </label>
      </div>

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
        <NumField label="Coats (blank = default)" value={surface.coats?.toString() ?? ''} onChange={(v) => onPatch({ coats: v.trim() === '' ? null : Number.parseInt(v, 10) || 1 })} />
        <NumField label="Waste ratio (blank = default)" value={surface.wasteRatio ?? ''} onChange={(v) => onPatch({ wasteRatio: v.trim() === '' ? null : v })} />
        <NumField label="Throughput override" value={surface.throughput ?? ''} onChange={(v) => onPatch({ throughput: v.trim() === '' ? null : v })} />
      </div>
      {onRemove && <button type="button" className="text-link mt-2 text-xs" onClick={onRemove}>Remove ceiling</button>}
    </div>
  );
}

function StandaloneSurfaceEditor({ surface, catalog, onPatch, onRemove }: { surface: Surface; catalog: PaintVariant[]; onPatch: (patch: Partial<Surface>) => void; onRemove: () => void }) {
  return (
    <div className="rounded-btn border border-line p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium capitalize">{surface.kind}</span>
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
        {surface.kind === 'trim' ? (
          <>
            <NumField label="Trim length (ft)" value={surface.trimLengthFt ?? ''} onChange={(v) => onPatch({ trimLengthFt: v })} />
            <NumField label="Developed width (ft)" value={surface.developedWidthFt ?? ''} onChange={(v) => onPatch({ developedWidthFt: v })} />
            <NumField label="Throughput (linear ft/hr/coat)" value={surface.throughput ?? ''} onChange={(v) => onPatch({ throughput: v.trim() === '' ? null : v })} />
          </>
        ) : (
          <>
            <NumField label="Door count" value={surface.doorCount?.toString() ?? ''} onChange={(v) => onPatch({ doorCount: Number.parseInt(v, 10) || 0 })} />
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
        <NumField label="Coats (blank = default)" value={surface.coats?.toString() ?? ''} onChange={(v) => onPatch({ coats: v.trim() === '' ? null : Number.parseInt(v, 10) || 1 })} />
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
