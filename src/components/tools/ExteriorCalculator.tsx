import { useMemo, useState } from 'react';
import { PEP, type Dec } from '../../engine/decimal';
import { parseDecimalField, parseCountField, MAX_OPENING_COUNT } from '../../engine/parse';
import { grossWallArea, quickOpeningArea, detailedOpeningArea, netWallArea, clampForPreview } from '../../engine/geometry';
import { rawDemandGal, purchasedGallons } from '../../engine/paint';
import { wallOrCeilingHours } from '../../engine/labor';

/** A measured opening entry — same shape as the interior calculator's,
 * kept local since this tool has no handoff into Pro (its inputs describe
 * a whole building footprint, not a single Room, so they don't map onto
 * Pro's per-room Surface model the way the interior tool's do). */
interface FreeOpeningEntry {
  id: string;
  type: 'door' | 'window';
  widthFt: string;
  heightFt: string;
  count: string;
}
let nextOpeningId = 0;
function newOpeningEntry(type: 'door' | 'window'): FreeOpeningEntry {
  nextOpeningId += 1;
  return { id: `ext-opening-${nextOpeningId}`, type, widthFt: '', heightFt: '', count: '1' };
}

/** Free exterior painting cost calculator. A rectangular-footprint model —
 * perimeter x total wall height, one shared exterior paint, quick or
 * detailed door/window deductions — deliberately the same simplification
 * as the interior tool's own "v1 launch reduction": no gables, dormers, or
 * roof-line geometry, since a wrong triangular-area formula is worse than
 * an honestly-simple box model. The footnote below says so. */
const DEFAULTS = {
  length: '', width: '', stories: '1', heightPerStory: '9', deductOpenings: true,
  doorCount: '0', windowCount: '0', coats: '2', coverage: '300', wastePercent: '15', pricePerGal: '50',
  calculateLabor: false, hourlyRate: '32', wallThroughput: '130', prepHours: '0',
};
// A plausible single-story ranch footprint: 50x30 ft, 1 story @ 9 ft,
// 3 exterior doors + 8 windows, 2 coats, 300 sqft/gal, 15% waste, $50/gal.
const FIXTURE_SAMPLE = { length: '50', width: '30', stories: '1', heightPerStory: '9', doorCount: '3', windowCount: '8', coats: '2', coverage: '300', wastePercent: '15', pricePerGal: '50' };

export default function ExteriorCalculator() {
  const [length, setLength] = useState(DEFAULTS.length);
  const [width, setWidth] = useState(DEFAULTS.width);
  const [stories, setStories] = useState(DEFAULTS.stories);
  const [heightPerStory, setHeightPerStory] = useState(DEFAULTS.heightPerStory);
  const [deductOpenings, setDeductOpenings] = useState(DEFAULTS.deductOpenings);
  const [openingMode, setOpeningMode] = useState<'quick' | 'detailed'>('quick');
  const [openings, setOpenings] = useState<FreeOpeningEntry[]>([]);
  const [doorCount, setDoorCount] = useState(DEFAULTS.doorCount);
  const [windowCount, setWindowCount] = useState(DEFAULTS.windowCount);
  const [coats, setCoats] = useState(DEFAULTS.coats);
  const [coverage, setCoverage] = useState(DEFAULTS.coverage);
  const [wastePercent, setWastePercent] = useState(DEFAULTS.wastePercent);
  const [pricePerGal, setPricePerGal] = useState(DEFAULTS.pricePerGal);
  const [calculateLabor, setCalculateLabor] = useState(DEFAULTS.calculateLabor);
  const [hourlyRate, setHourlyRate] = useState(DEFAULTS.hourlyRate);
  const [wallThroughput, setWallThroughput] = useState(DEFAULTS.wallThroughput);
  const [prepHours, setPrepHours] = useState(DEFAULTS.prepHours);

  function loadSampleData() {
    setLength(FIXTURE_SAMPLE.length);
    setWidth(FIXTURE_SAMPLE.width);
    setStories(FIXTURE_SAMPLE.stories);
    setHeightPerStory(FIXTURE_SAMPLE.heightPerStory);
    setDeductOpenings(true);
    setOpeningMode('quick');
    setOpenings([]);
    setDoorCount(FIXTURE_SAMPLE.doorCount);
    setWindowCount(FIXTURE_SAMPLE.windowCount);
    setCoats(FIXTURE_SAMPLE.coats);
    setCoverage(FIXTURE_SAMPLE.coverage);
    setWastePercent(FIXTURE_SAMPLE.wastePercent);
    setPricePerGal(FIXTURE_SAMPLE.pricePerGal);
  }

  const result = useMemo(() => {
    const pLength = parseDecimalField(length);
    const pWidth = parseDecimalField(width);
    const pStories = parseCountField(stories, { min: 1, max: 10 });
    const pHeightPerStory = parseDecimalField(heightPerStory);
    const activeMode = deductOpenings ? openingMode : null;
    const pDoors = activeMode === 'quick' ? parseCountField(doorCount, { min: 0, max: MAX_OPENING_COUNT }) : { kind: 'valid' as const, value: 0 };
    const pWindows = activeMode === 'quick' ? parseCountField(windowCount, { min: 0, max: MAX_OPENING_COUNT }) : { kind: 'valid' as const, value: 0 };
    const parsedOpenings = activeMode === 'detailed'
      ? openings.map((o) => ({ id: o.id, type: o.type, widthFt: parseDecimalField(o.widthFt), heightFt: parseDecimalField(o.heightFt), count: parseCountField(o.count, { min: 0, max: MAX_OPENING_COUNT }) }))
      : [];
    const pCoats = parseCountField(coats, { min: 1, max: 5 });
    const pCoverage = parseDecimalField(coverage);
    const pWaste = parseDecimalField(wastePercent);
    const pPrice = parseDecimalField(pricePerGal);

    // Missing (blank) required fields are guidance, not an error -- same
    // "missing vs invalid" distinction the interior calculator uses.
    const missing = pLength.kind === 'missing' || pWidth.kind === 'missing';

    const errors: string[] = [];
    if (pLength.kind === 'invalid' || (pLength.kind === 'valid' && pLength.value.lessThanOrEqualTo(0))) errors.push('House length must be a positive number.');
    if (pWidth.kind === 'invalid' || (pWidth.kind === 'valid' && pWidth.value.lessThanOrEqualTo(0))) errors.push('House width must be a positive number.');
    if (pStories.kind !== 'valid') errors.push('Stories must be a whole number from 1 to 10.');
    if (pHeightPerStory.kind !== 'valid' || pHeightPerStory.value.lessThanOrEqualTo(0)) errors.push('Wall height per story must be a positive number.');
    if (activeMode === 'quick' && pDoors.kind === 'invalid') errors.push(`Doors: ${pDoors.message}`);
    if (activeMode === 'quick' && pWindows.kind === 'invalid') errors.push(`Windows: ${pWindows.message}`);
    if (activeMode === 'detailed') {
      if (openings.length === 0) errors.push('Add at least one measured opening, or switch back to quick mode.');
      for (const o of parsedOpenings) {
        if (o.widthFt.kind !== 'valid' || o.widthFt.value.lessThanOrEqualTo(0)) errors.push(`${o.type === 'door' ? 'Door' : 'Window'} width must be a positive number.`);
        if (o.heightFt.kind !== 'valid' || o.heightFt.value.lessThanOrEqualTo(0)) errors.push(`${o.type === 'door' ? 'Door' : 'Window'} height must be a positive number.`);
        if (o.count.kind === 'invalid') errors.push(`${o.type === 'door' ? 'Door' : 'Window'} count: ${o.count.message}`);
      }
    }
    if (pCoats.kind !== 'valid') errors.push('Coats must be a whole number from 1 to 5.');
    if (pCoverage.kind !== 'valid' || pCoverage.value.lessThanOrEqualTo(0)) errors.push('Coverage must be a positive number.');
    if (pWaste.kind !== 'valid') errors.push('Waste % must be a number.');
    if (pPrice.kind !== 'valid' || pPrice.value.lessThanOrEqualTo(0)) errors.push('Price per gallon must be a positive number.');

    let laborRateErr: string | null = null;
    let rateVal: Dec | null = null;
    let wallRateVal: Dec | null = null;
    let prepHoursVal: Dec | null = null;
    if (calculateLabor) {
      const pRate = parseDecimalField(hourlyRate);
      const pPrep = parseDecimalField(prepHours);
      const pWallRate = parseDecimalField(wallThroughput);
      if (pRate.kind !== 'valid') laborRateErr = 'Hourly rate must be a number.';
      else rateVal = pRate.value;
      if (pWallRate.kind !== 'valid' || pWallRate.value.lessThanOrEqualTo(0)) laborRateErr = 'Production rate must be positive.';
      else wallRateVal = pWallRate.value;
      if (pPrep.kind === 'invalid' || (pPrep.kind === 'valid' && pPrep.value.isNegative())) laborRateErr = 'Prep / power-wash hours must be zero or positive.';
      else if (pPrep.kind === 'valid') prepHoursVal = pPrep.value;
      else prepHoursVal = new PEP(0);
    }
    if (laborRateErr) errors.push(laborRateErr);

    if (
      errors.length > 0 ||
      pLength.kind !== 'valid' ||
      pWidth.kind !== 'valid' ||
      pStories.kind !== 'valid' ||
      pHeightPerStory.kind !== 'valid' ||
      pCoverage.kind !== 'valid' ||
      pWaste.kind !== 'valid' ||
      pPrice.kind !== 'valid' ||
      pCoats.kind !== 'valid' ||
      (activeMode === 'quick' && (pDoors.kind !== 'valid' || pWindows.kind !== 'valid')) ||
      (activeMode === 'detailed' && parsedOpenings.some((o) => o.widthFt.kind !== 'valid' || o.heightFt.kind !== 'valid' || o.count.kind !== 'valid'))
    ) {
      return { errors, missing } as const;
    }

    const totalHeight = pHeightPerStory.value.times(pStories.value);
    const gross = grossWallArea(pLength.value, pWidth.value, totalHeight);
    const activeDeduction = activeMode !== null;
    const deduction =
      activeMode === 'quick' && pDoors.kind === 'valid' && pWindows.kind === 'valid'
        ? quickOpeningArea(pDoors.value, new PEP(20), pWindows.value, new PEP(15))
        : activeMode === 'detailed'
          ? detailedOpeningArea(
              parsedOpenings.map((o) => ({
                widthFt: (o.widthFt as { kind: 'valid'; value: Dec }).value,
                heightFt: (o.heightFt as { kind: 'valid'; value: Dec }).value,
                count: (o.count as { kind: 'valid'; value: number }).value,
              }))
            )
          : new PEP(0);
    const net = netWallArea(gross, deduction, activeDeduction);

    if (!net.valid) {
      return { errors: ['Openings exceed the exterior wall area — reduce the door/window count or turn off deductions.'], preview: clampForPreview(net.area) } as const;
    }

    const coatsN = pCoats.value;
    const raw = rawDemandGal(net.area, coatsN, pWaste.value.dividedBy(100), pCoverage.value);
    const purchased = purchasedGallons(raw);
    const paintCost = pPrice.value.times(purchased);

    let laborCost: Dec | null = null;
    let hours: Dec | null = null;
    if (calculateLabor && rateVal && wallRateVal) {
      hours = wallOrCeilingHours(net.area, coatsN, wallRateVal).plus(prepHoursVal ?? new PEP(0));
      laborCost = hours.times(rateVal);
    }

    return {
      errors: [] as string[],
      gross,
      deduction,
      totalArea: net.area,
      purchased,
      paintCost,
      hours,
      laborCost,
      total: laborCost ? paintCost.plus(laborCost) : paintCost,
      zeroRateWarning: calculateLabor && rateVal !== null && rateVal.isZero(),
    } as const;
  }, [length, width, stories, heightPerStory, deductOpenings, openingMode, openings, doorCount, windowCount, coats, coverage, wastePercent, pricePerGal, calculateLabor, hourlyRate, wallThroughput, prepHours]);

  return (
    <div className="card p-6 sm:p-7">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-ink">House</h3>
            <button type="button" className="text-link text-xs" onClick={loadSampleData}>
              Load sample data (50×30, 1 story)
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Length (ft)" value={length} onChange={setLength} />
            <Field label="Width (ft)" value={width} onChange={setWidth} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Stories" value={stories} onChange={setStories} />
            <Field label="Height per story (ft)" value={heightPerStory} onChange={setHeightPerStory} />
          </div>

          <label className="flex items-center gap-2 pt-2 text-sm text-ink">
            <input type="checkbox" checked={deductOpenings} onChange={(e) => setDeductOpenings(e.target.checked)} /> Deduct doors/windows
          </label>
          {deductOpenings && (
            <div className="space-y-2">
              <label className="block text-sm">
                <span className="font-medium text-ink-soft">Opening entry</span>
                <select
                  className="mt-1 w-full rounded-btn border border-line bg-card px-2 py-2 text-sm"
                  value={openingMode}
                  onChange={(e) => setOpeningMode(e.target.value as 'quick' | 'detailed')}
                >
                  <option value="quick">Quick (count x flat area each)</option>
                  <option value="detailed">Detailed (measured width x height)</option>
                </select>
              </label>
              {openingMode === 'quick' && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Doors (20 ft² each)" value={doorCount} onChange={setDoorCount} />
                  <Field label="Windows (15 ft² each)" value={windowCount} onChange={setWindowCount} />
                </div>
              )}
              {openingMode === 'detailed' && (
                <div className="space-y-2">
                  {openings.map((o) => (
                    <div key={o.id} className="grid grid-cols-1 items-end gap-2 rounded-btn border border-line p-2 sm:grid-cols-[auto_1fr_1fr_auto_auto]">
                      <label className="block text-sm">
                        <span className="font-medium text-ink-soft">Type</span>
                        <select
                          className="mt-1 rounded-btn border border-line bg-card px-2 py-2 text-sm"
                          value={o.type}
                          onChange={(e) => setOpenings((os) => os.map((x) => (x.id === o.id ? { ...x, type: e.target.value as 'door' | 'window' } : x)))}
                        >
                          <option value="door">Door</option>
                          <option value="window">Window</option>
                        </select>
                      </label>
                      <Field label="Width (ft)" value={o.widthFt} onChange={(v) => setOpenings((os) => os.map((x) => (x.id === o.id ? { ...x, widthFt: v } : x)))} />
                      <Field label="Height (ft)" value={o.heightFt} onChange={(v) => setOpenings((os) => os.map((x) => (x.id === o.id ? { ...x, heightFt: v } : x)))} />
                      <Field label="Count" value={o.count} onChange={(v) => setOpenings((os) => os.map((x) => (x.id === o.id ? { ...x, count: v } : x)))} />
                      <button type="button" className="text-link text-xs text-bad" onClick={() => setOpenings((os) => os.filter((x) => x.id !== o.id))}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-secondary" onClick={() => setOpenings((os) => [...os, newOpeningEntry('door')])}>
                      + Add door
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setOpenings((os) => [...os, newOpeningEntry('window')])}>
                      + Add window
                    </button>
                  </div>
                  {openings.length === 0 && <p className="text-xs text-ink-soft">Add at least one measured opening.</p>}
                </div>
              )}
            </div>
          )}

          <h3 className="pt-2 text-base font-semibold text-ink">Paint</h3>
          <p className="text-xs text-ink-soft">Coverage and price below start as labeled sample values — edit them for your actual product.</p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Coats" value={coats} onChange={setCoats} />
            <Field label="Coverage (sqft/gal, sample)" value={coverage} onChange={setCoverage} />
            <Field label="Waste %" value={wastePercent} onChange={setWastePercent} />
          </div>
          <Field label="Price per gallon ($, sample)" value={pricePerGal} onChange={setPricePerGal} />

          <label className="flex items-center gap-2 pt-2 text-sm text-ink">
            <input type="checkbox" checked={calculateLabor} onChange={(e) => setCalculateLabor(e.target.checked)} /> Estimate labor
          </label>
          {calculateLabor && (
            <div className="grid grid-cols-3 gap-2">
              <Field label="$/hour" value={hourlyRate} onChange={setHourlyRate} />
              <Field label="Siding sqft/hr/coat" value={wallThroughput} onChange={setWallThroughput} />
              <Field label="Prep / power-wash hours" value={prepHours} onChange={setPrepHours} />
            </div>
          )}
        </div>

        <div>
          <h3 className="text-base font-semibold text-ink">Result</h3>
          {result.errors.length === 0 && 'missing' in result && result.missing ? (
            <p className="mt-3 text-sm text-ink-soft">Enter the house's length and width to see your estimate — or load the sample house below.</p>
          ) : result.errors.length > 0 ? (
            <div role="alert" className="mt-3 rounded-[calc(var(--radius-card)-8px)] border border-bad-line bg-bad-soft p-3 text-sm text-bad">
              {result.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          ) : (
            <dl className="mt-3 space-y-2 text-sm" aria-live="polite" aria-atomic="true">
              <Row label="Gross wall area" value={`${result.gross!.toFixed(2)} ft²`} />
              {deductOpenings && <Row label="Opening deduction" value={`${result.deduction!.toFixed(2)} ft²`} />}
              <Row label="Total paintable area" value={`${result.totalArea!.toFixed(2)} ft²`} />
              <Row label="Paint needed" value={`${result.purchased} gal`} />
              <Row label="Paint cost" value={`$${result.paintCost!.toFixed(2)}`} />
              {result.laborCost && (
                <>
                  <Row label="Labor hours (approx.)" value={result.hours!.toDecimalPlaces(2).toFixed(2)} />
                  <Row label="Labor cost" value={`$${result.laborCost.toFixed(2)}`} />
                </>
              )}
              <Row label="Total" value={`$${result.total!.toFixed(2)}`} strong />
              {result.zeroRateWarning && (
                <p className="pt-1 text-xs text-warn">An hourly rate of $0 produces a $0 labor cost — double-check this is an intentional free/self-labor scenario, not a blank rate.</p>
              )}
              <p className="pt-2 text-xs text-ink-soft">{result.laborCost ? 'Paint + entered labor estimate; excludes other supplies, overhead, and tax.' : 'Paint materials only.'}</p>
              <p className="pt-2 text-xs text-ink-soft">
                Simplified box-shaped footprint (perimeter × total wall height) — doesn't model gables, dormers, or roof lines. For an unusual shape, measure and total each wall section separately.
              </p>
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-ink-soft">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-btn border border-line bg-card px-3 py-2 text-ink tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      />
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
