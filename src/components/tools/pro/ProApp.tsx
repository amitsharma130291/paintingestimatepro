import { useEffect, useMemo, useState } from 'react';
import { PEP, type Dec } from '../../../engine/decimal';
import { grossWallArea, ceilingArea, netWallArea } from '../../../engine/geometry';
import { rawDemandGal, aggregateRawDemandByVariant, purchasedGallons } from '../../../engine/paint';
import { wallOrCeilingHours } from '../../../engine/labor';
import { directCost, overheadAmount, estimatedJobCost, materialsTotal } from '../../../engine/cost';
import { evaluatePrice } from '../../../engine/pricing';
import { evaluateActualReview, type ActualCategory } from '../../../engine/actuals';
import { computeServiceUnitCost, evaluateServiceHealth } from '../../../engine/serviceHealth';
import { statusBadge, money } from '../shared';
import type { BusinessSettings, PaintVariant, Project } from '../../../domain/entities';
import { createSnapshot } from '../../../domain/snapshot';
import { createDraftRevision, issueRevision, checkIssueGate } from '../../../domain/project';
import { buildCustomerDocument } from '../../../domain/customerDocument';
import { exportBackup, validateBackupEnvelope } from '../../../domain/backup';
import { defaultIdSource } from '../../../domain/ids';
import { loadSnapshot, saveBusinessSettings, savePaintVariants, saveProjects } from './proStore';

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

interface SimpleRoomInput {
  id: string;
  name: string;
  length: string;
  width: string;
  height: string;
  includeCeiling: boolean;
  doorCount: string;
  windowCount: string;
  coats: string;
  paintVariantId: string;
}

type Tab = 'settings' | 'catalog' | 'project' | 'summary' | 'health' | 'actuals' | 'backup';

export default function ProApp() {
  const [tab, setTab] = useState<Tab>('settings');
  const [loading, setLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [settings, setSettings] = useState<BusinessSettings>(defaultSettings());
  const [catalog, setCatalog] = useState<PaintVariant[]>([]);
  const [rooms, setRooms] = useState<SimpleRoomInput[]>([]);
  const [priceMode, setPriceMode] = useState<'suggested' | 'custom'>('suggested');
  const [customPrice, setCustomPrice] = useState('');
  const [issuedRevisionId, setIssuedRevisionId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
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

  function addRoom() {
    setRooms((rs) => [
      ...rs,
      { id: ids.nextId(), name: `Room ${rs.length + 1}`, length: '', width: '', height: String(settings.defaultCoats ? 8 : 8), includeCeiling: false, doorCount: '0', windowCount: '0', coats: String(settings.defaultCoats), paintVariantId: catalog[0]?.id ?? '' },
    ]);
  }

  // ---- Estimate summary calculation (the calculation engine, wired live) ----
  const summary = useMemo(() => {
    if (catalog.length === 0 || rooms.length === 0) return null;
    const overheadRatio = new PEP(settings.overheadRatio);
    const targetRatio = new PEP(settings.targetMarginRatio);
    const hourlyRate = settings.loadedHourlyRate ? new PEP(settings.loadedHourlyRate) : null;
    if (!hourlyRate) return null;

    const demandsByRoom: { paintVariantId: string; rawGal: Dec }[] = [];
    let laborHours = new PEP(0);
    const roomBreakdown: { room: SimpleRoomInput; netWall: Dec; ceiling: Dec; valid: boolean }[] = [];

    for (const r of rooms) {
      const length = new PEP(r.length || '0');
      const width = new PEP(r.width || '0');
      const height = new PEP(r.height || '0');
      if (length.lessThanOrEqualTo(0) || width.lessThanOrEqualTo(0) || height.lessThanOrEqualTo(0)) {
        roomBreakdown.push({ room: r, netWall: new PEP(0), ceiling: new PEP(0), valid: false });
        continue;
      }
      const gross = grossWallArea(length, width, height);
      const openingArea = new PEP(r.doorCount || '0').times(20).plus(new PEP(r.windowCount || '0').times(15));
      const net = netWallArea(gross, openingArea, true);
      if (!net.valid) {
        roomBreakdown.push({ room: r, netWall: new PEP(0), ceiling: new PEP(0), valid: false });
        continue;
      }
      const ceiling = r.includeCeiling ? ceilingArea(length, width) : new PEP(0);
      const coats = Number.parseInt(r.coats, 10) || 2;
      const wasteRatio = new PEP(settings.defaultWasteRatio);
      const wallThroughput = new PEP(settings.wallThroughput ?? '150');
      const ceilingThroughput = new PEP(settings.ceilingThroughput ?? '120');

      const variant = catalog.find((v) => v.id === r.paintVariantId);
      const coverage = variant ? new PEP(variant.coverageFt2PerGal) : new PEP(350);
      demandsByRoom.push({ paintVariantId: r.paintVariantId, rawGal: rawDemandGal(net.area, coats, wasteRatio, coverage) });
      if (r.includeCeiling) {
        demandsByRoom.push({ paintVariantId: r.paintVariantId, rawGal: rawDemandGal(ceiling, coats, wasteRatio, coverage) });
      }

      laborHours = laborHours.plus(wallOrCeilingHours(net.area, coats, wallThroughput));
      if (r.includeCeiling) laborHours = laborHours.plus(wallOrCeilingHours(ceiling, coats, ceilingThroughput));

      roomBreakdown.push({ room: r, netWall: net.area, ceiling, valid: true });
    }

    if (roomBreakdown.some((r) => !r.valid)) {
      return { incomplete: true, roomBreakdown } as const;
    }

    const priceByVariant = new Map(catalog.map((v) => [v.id, new PEP(v.pricePerGal)]));
    const totals = aggregateRawDemandByVariant(demandsByRoom);
    let materials = new PEP(0);
    const purchases: { variant: PaintVariant | undefined; rawGal: Dec; purchasedGal: number; cost: Dec }[] = [];
    for (const [variantId, rawGal] of totals) {
      const purchasedGal = purchasedGallons(rawGal);
      const price = priceByVariant.get(variantId) ?? new PEP(0);
      const cost = price.times(purchasedGal);
      materials = materials.plus(cost);
      purchases.push({ variant: catalog.find((v) => v.id === variantId), rawGal, purchasedGal, cost });
    }
    const materialsWithAllowance = materialsTotal(materials, new PEP(0), new PEP(0));
    const labor = laborHours.times(hourlyRate);
    const dc = directCost(materialsWithAllowance, labor, new PEP(0));
    const oh = overheadAmount(dc, overheadRatio);
    const jobCost = estimatedJobCost(dc, oh);

    const priceInput = priceMode === 'custom' ? (customPrice.trim() === '' ? null : new PEP(customPrice)) : null;
    const price = evaluatePrice({ cost: jobCost, price: priceInput, targetMarginRatio: targetRatio });
    const effectivePrice = priceMode === 'suggested' ? price.minimumTargetPrice : priceInput;
    const finalPrice = effectivePrice ? evaluatePrice({ cost: jobCost, price: effectivePrice, targetMarginRatio: targetRatio }) : price;

    return {
      incomplete: false,
      roomBreakdown,
      purchases,
      materials: materialsWithAllowance,
      labor,
      laborHours,
      directCost: dc,
      overhead: oh,
      jobCost,
      suggestedPrice: price.minimumTargetPrice,
      effectivePrice,
      price: finalPrice,
    } as const;
  }, [catalog, rooms, settings, priceMode, customPrice]);

  const issueGate = useMemo(() => {
    if (!summary || summary.incomplete) return { canIssue: false, reasons: ['Complete every room before issuing.'] };
    return checkIssueGate(
      {
        calculationState: 'complete',
        title: 'Project',
        surfaces: [{ enabled: true } as never],
        proposedPrice: summary.effectivePrice ? summary.effectivePrice.toFixed(2) : null,
      } as never,
      { sampleAssumptionsConfirmed: settings.sampleAssumptionsConfirmed, zeroPriceConfirmed: false }
    );
  }, [summary, settings.sampleAssumptionsConfirmed]);

  async function issueEstimate() {
    if (!summary || summary.incomplete) return;
    const snapshot = createSnapshot(settings, catalog, [], ids, 'live');
    let revision = createDraftRevision('project-1', snapshot, ids);
    revision = { ...revision, title: 'Painting project', proposedPrice: summary.effectivePrice?.toFixed(2) ?? null, calculationState: 'complete' };
    const issued = issueRevision(revision, (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: now().slice(0, 10), projectAddress: '', revisionLabel: 'Rev 1' }), ids);
    const project: Project = { id: 'project-1', title: 'Painting project', revisions: [issued], activeRevisionId: issued.id, actualReviews: [], createdAt: now(), updatedAt: now() };
    const nextProjects = [project];
    setProjects(nextProjects);
    setIssuedRevisionId(issued.id);
    try {
      await saveProjects(nextProjects);
      setSaveMessage('Estimate issued and saved.');
    } catch {
      setSaveMessage('Issued locally, but saving failed — your previous data was not changed.');
    }
  }

  const issuedRevision = projects[0]?.revisions.find((r) => r.id === issuedRevisionId) ?? null;

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

  // ---- Actuals ----
  const actualResult = useMemo(() => {
    if (!issuedRevision || !issuedRevision.proposedPrice) return null;
    const toCategory = (c: { confirmed: boolean; amount: string }): ActualCategory => ({ confirmed: c.confirmed, amount: c.confirmed && c.amount.trim() !== '' ? new PEP(c.amount) : null });
    const storedJobCost = (issuedRevision.rawCalculatedOutputs as { jobCost?: string } | null)?.jobCost;
    const baselineCost = storedJobCost ?? (summary && !summary.incomplete ? summary.jobCost.toString() : '0');
    return evaluateActualReview({
      materials: toCategory(actuals.materials),
      labor: toCategory(actuals.labor),
      otherExpenses: toCategory(actuals.otherExpenses),
      overhead: toCategory(actuals.overhead),
      baselinePrice: new PEP(issuedRevision.proposedPrice),
      baselineCost: new PEP(baselineCost),
    });
  }, [issuedRevision, actuals, summary]);

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
        {(['settings', 'catalog', 'project', 'summary', 'health', 'actuals', 'backup'] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`btn ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
            {t === 'settings' ? 'Business settings' : t === 'catalog' ? 'Paint catalog' : t === 'project' ? 'Project' : t === 'summary' ? 'Estimate summary' : t === 'health' ? 'Price Book Health' : t === 'actuals' ? 'Actual review' : 'Backup'}
          </button>
        ))}
      </div>
      {saveMessage && <p className="mt-3 text-xs text-ink-soft">{saveMessage}</p>}

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
            <NumField label="Waste ratio (e.g. 0.10)" value={settings.defaultWasteRatio} onChange={(v) => persistSettings({ ...settings, defaultWasteRatio: v })} />
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

        {tab === 'project' && (
          <div className="card p-6">
            <button type="button" className="btn btn-secondary" disabled={catalog.length === 0} onClick={addRoom}>
              + Add room
            </button>
            {catalog.length === 0 && <p className="mt-2 text-sm text-warn">Add a paint product in the catalog first.</p>}
            <div className="mt-4 space-y-4">
              {rooms.map((r) => (
                <div key={r.id} className="rounded-btn border border-line p-4">
                  <TextField label="Room name" value={r.name} onChange={(v) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, name: v } : x)))} />
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <NumField label="Length (ft)" value={r.length} onChange={(v) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, length: v } : x)))} />
                    <NumField label="Width (ft)" value={r.width} onChange={(v) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, width: v } : x)))} />
                    <NumField label="Height (ft)" value={r.height} onChange={(v) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, height: v } : x)))} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <NumField label="Doors" value={r.doorCount} onChange={(v) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, doorCount: v } : x)))} />
                    <NumField label="Windows" value={r.windowCount} onChange={(v) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, windowCount: v } : x)))} />
                    <NumField label="Coats" value={r.coats} onChange={(v) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, coats: v } : x)))} />
                    <label className="flex items-center gap-2 pt-5 text-sm">
                      <input type="checkbox" checked={r.includeCeiling} onChange={(e) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, includeCeiling: e.target.checked } : x)))} /> Ceiling
                    </label>
                  </div>
                  <label className="mt-2 block text-sm">
                    <span className="font-medium text-ink-soft">Paint variant</span>
                    <select className="mt-1 w-full rounded-btn border border-line px-3 py-2" value={r.paintVariantId} onChange={(e) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, paintVariantId: e.target.value } : x)))}>
                      {catalog.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="text-link mt-2 text-xs" onClick={() => setRooms((rs) => rs.filter((x) => x.id !== r.id))}>
                    Remove room
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'summary' && (
          <div className="card p-6">
            {!summary && <p className="text-sm text-ink-soft">Add a paint variant and at least one room first.</p>}
            {summary && summary.incomplete && <p className="text-sm text-bad">One or more rooms have incomplete or invalid geometry — the project cannot be priced until every room is valid.</p>}
            {summary && !summary.incomplete && (
              <>
                <dl className="space-y-2 text-sm">
                  <Row label="Materials" value={money(summary.materials)} />
                  <Row label="Labor" value={money(summary.labor)} />
                  <Row label="Direct cost" value={money(summary.directCost)} />
                  <Row label="Overhead" value={money(summary.overhead)} />
                  <Row label="Estimated job cost" value={money(summary.jobCost)} strong />
                </dl>

                <div className="mt-4 flex gap-2">
                  <button type="button" className={`btn ${priceMode === 'suggested' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPriceMode('suggested')}>
                    Suggested price
                  </button>
                  <button type="button" className={`btn ${priceMode === 'custom' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPriceMode('custom')}>
                    Custom price
                  </button>
                </div>
                {priceMode === 'custom' && <NumField label="Your price ($)" value={customPrice} onChange={setCustomPrice} className="mt-2 max-w-xs" />}

                <dl className="mt-4 space-y-2 text-sm">
                  <Row label="Proposed price" value={summary.effectivePrice ? money(summary.effectivePrice) : '—'} strong />
                  <Row label="Profit" value={summary.price.profit ? money(summary.price.profit) : '—'} />
                  <Row label="Margin" value={summary.price.marginRatio ? `${summary.price.marginRatio.times(100).toFixed(1)}%` : '—'} />
                  <div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge(summary.price).className}`}>{statusBadge(summary.price).label}</span>
                  </div>
                </dl>

                {!issuedRevisionId ? (
                  <>
                    <button type="button" className="btn btn-primary mt-4" disabled={!issueGate.canIssue} onClick={issueEstimate}>
                      Issue estimate
                    </button>
                    {!issueGate.canIssue && (
                      <ul className="mt-2 text-xs text-warn">
                        {issueGate.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="mt-4 text-sm text-primary-dark">Issued. See the customer document below.</p>
                )}

                {issuedRevision?.customerDocumentSnapshot && (
                  <div className="mt-6 rounded-btn border border-line p-4">
                    <p className="tag-preview mb-2 inline-block">Customer-facing document</p>
                    <p className="font-semibold">{issuedRevision.customerDocumentSnapshot.projectTitle}</p>
                    <p className="text-sm text-ink-soft">Estimate {issuedRevision.customerDocumentSnapshot.estimateNumber} — {issuedRevision.customerDocumentSnapshot.estimateDate}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">${issuedRevision.customerDocumentSnapshot.proposedPrice}</p>
                    <p className="text-xs text-ink-soft">{issuedRevision.customerDocumentSnapshot.taxNotice}</p>
                    <p className="mt-2 text-xs text-ink-soft italic">No cost, overhead, or margin figures appear on this document — verified by allow-list, see IMPLEMENTATION_DECISIONS.md.</p>
                  </div>
                )}
              </>
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
            {!issuedRevision && <p className="text-sm text-ink-soft">Issue an estimate first — actuals are recorded against an issued baseline.</p>}
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
