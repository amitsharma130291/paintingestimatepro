import { useMemo, useState } from 'react';
import { PEP, type Dec } from '../../engine/decimal';
import { parseDecimalField, parseCountField, MAX_OPENING_COUNT } from '../../engine/parse';
import { grossWallArea, ceilingArea, quickOpeningArea, detailedOpeningArea, netWallArea, clampForPreview } from '../../engine/geometry';
import { rawDemandGal, purchasedGallons } from '../../engine/paint';
import { wallOrCeilingHours } from '../../engine/labor';
import { writeInteriorHandoff } from '../../domain/interiorHandoff';

/** INT-010: a measured opening entry, matching Pro's own OpeningEntry
 * shape (src/domain/entities.ts) field-for-field so the handoff below is
 * a direct, lossless copy rather than a reinterpretation. A local counter
 * is enough for stable ids here — this tool has no IdSource/persistence
 * layer of its own. */
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
  return { id: `opening-${nextOpeningId}`, type, widthFt: '', heightFt: '', count: '1' };
}

/** Free single-room interior calculator (tool-specs/03). Walls + optional
 * ceiling, one shared paint variant, quick openings only — the documented
 * v1 launch reduction. */
// tool-specs/03: "heightFt default 8"; "Quick doorCount/windowCount default
// 0"; length/width have no stated default (required, blank until entered).
// coverage 350 / price 45 are the tool's own labeled SAMPLE assumptions
// (distinct from the 20x16x9/2-door/3-window/$42 worked fixture in the
// spec, which "Load sample data" below reproduces exactly for a user who
// wants to see the tool work before entering their own room).
const DEFAULTS = {
  length: '', width: '', height: '8', includeWalls: true, includeCeiling: false, deductOpenings: true,
  doorCount: '0', windowCount: '0', coats: '2', coverage: '350', wastePercent: '10', pricePerGal: '45',
  calculateLabor: false, hourlyRate: '32', wallThroughput: '150', ceilingThroughput: '120', prepHours: '0',
};
const FIXTURE_SAMPLE = { length: '20', width: '16', height: '9', doorCount: '2', windowCount: '3', coats: '2', coverage: '350', wastePercent: '10', pricePerGal: '42' };

export default function InteriorCalculator() {
  const [length, setLength] = useState(DEFAULTS.length);
  const [width, setWidth] = useState(DEFAULTS.width);
  const [height, setHeight] = useState(DEFAULTS.height);
  const [includeWalls, setIncludeWalls] = useState(DEFAULTS.includeWalls);
  const [includeCeiling, setIncludeCeiling] = useState(DEFAULTS.includeCeiling);
  const [deductOpenings, setDeductOpenings] = useState(DEFAULTS.deductOpenings);
  // INT-010: quick (count x flat area-each) or detailed (measured
  // width/height/count per opening) -- mutually exclusive deduction
  // sources, matching Pro's own Room.openingMode. Detailed entries fully
  // supersede the quick counts; switching modes never mixes the two.
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
  const [ceilingThroughput, setCeilingThroughput] = useState(DEFAULTS.ceilingThroughput);
  const [prepHours, setPrepHours] = useState(DEFAULTS.prepHours);

  function loadSampleData() {
    setLength(FIXTURE_SAMPLE.length);
    setWidth(FIXTURE_SAMPLE.width);
    setHeight(FIXTURE_SAMPLE.height);
    setIncludeWalls(true);
    setIncludeCeiling(false);
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
    const pHeight = parseDecimalField(height);
    // INT-010: quick and detailed are mutually exclusive deduction
    // sources. Only the ACTIVE mode's fields are parsed/validated at
    // all -- an inactive mode's inputs (e.g. leftover quick counts while
    // in detailed mode) never block calculation or contribute area,
    // matching the same "inactive fields don't block the active mode"
    // principle already established for Pro (V6-06).
    const activeMode = includeWalls && deductOpenings ? openingMode : null;
    const pDoors = activeMode === 'quick' ? parseCountField(doorCount, { min: 0, max: MAX_OPENING_COUNT }) : { kind: 'valid' as const, value: 0 };
    const pWindows = activeMode === 'quick' ? parseCountField(windowCount, { min: 0, max: MAX_OPENING_COUNT }) : { kind: 'valid' as const, value: 0 };
    const parsedOpenings = activeMode === 'detailed'
      ? openings.map((o) => ({ id: o.id, type: o.type, widthFt: parseDecimalField(o.widthFt), heightFt: parseDecimalField(o.heightFt), count: parseCountField(o.count, { min: 0, max: MAX_OPENING_COUNT }) }))
      : [];
    const pCoats = parseCountField(coats, { min: 1, max: 5 });
    const pCoverage = parseDecimalField(coverage);
    const pWaste = parseDecimalField(wastePercent);
    const pPrice = parseDecimalField(pricePerGal);

    // Missing (blank) required fields are guidance, not an error — they're
    // expected on first render now that length/width have no default value
    // (tool-specs/03: required, no stated default). Only malformed/
    // non-positive counts as an actual validation error.
    const missing = pLength.kind === 'missing' || pWidth.kind === 'missing';

    const errors: string[] = [];
    // tool-specs/03: "includeWalls default true; includeCeiling default
    // false; at least one enabled" (INT-008/009).
    if (!includeWalls && !includeCeiling) errors.push('Enable at least one surface (walls or ceiling) to calculate paint.');
    if (pLength.kind === 'invalid' || (pLength.kind === 'valid' && pLength.value.lessThanOrEqualTo(0))) errors.push('Room length must be a positive number.');
    if (pWidth.kind === 'invalid' || (pWidth.kind === 'valid' && pWidth.value.lessThanOrEqualTo(0))) errors.push('Room width must be a positive number.');
    if (pHeight.kind !== 'valid' || pHeight.value.lessThanOrEqualTo(0)) errors.push('Wall height must be a positive number.');
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
    let wallRateVal: Dec | null = null;
    let ceilingRateVal: Dec | null = null;
    let rateVal: Dec | null = null;
    let prepHoursVal: Dec | null = null;
    if (calculateLabor) {
      const pRate = parseDecimalField(hourlyRate);
      const pPrep = parseDecimalField(prepHours);
      if (pRate.kind !== 'valid') laborRateErr = 'Hourly rate must be a number.';
      else rateVal = pRate.value;
      if (pPrep.kind === 'invalid' || (pPrep.kind === 'valid' && pPrep.value.isNegative())) laborRateErr = 'Prep/cleanup hours must be zero or positive.';
      else if (pPrep.kind === 'valid') prepHoursVal = pPrep.value;
      else prepHoursVal = new PEP(0); // blank prep hours defaults to 0, not missing (tool-specs/03: "default 0")
      if (includeWalls) {
        const pWallRate = parseDecimalField(wallThroughput);
        if (pWallRate.kind !== 'valid' || pWallRate.value.lessThanOrEqualTo(0)) laborRateErr = 'Wall production rate must be positive.';
        else wallRateVal = pWallRate.value;
      }
      if (includeCeiling) {
        const pCeilingRate = parseDecimalField(ceilingThroughput);
        if (pCeilingRate.kind !== 'valid' || pCeilingRate.value.lessThanOrEqualTo(0)) laborRateErr = 'Ceiling production rate must be positive.';
        else ceilingRateVal = pCeilingRate.value;
      }
    }
    if (laborRateErr) errors.push(laborRateErr);

    if (
      errors.length > 0 ||
      pLength.kind !== 'valid' ||
      pWidth.kind !== 'valid' ||
      pHeight.kind !== 'valid' ||
      pCoverage.kind !== 'valid' ||
      pWaste.kind !== 'valid' ||
      pPrice.kind !== 'valid' ||
      pCoats.kind !== 'valid' ||
      (activeMode === 'quick' && (pDoors.kind !== 'valid' || pWindows.kind !== 'valid')) ||
      (activeMode === 'detailed' && parsedOpenings.some((o) => o.widthFt.kind !== 'valid' || o.heightFt.kind !== 'valid' || o.count.kind !== 'valid'))
    ) {
      return { errors, missing } as const;
    }

    const gross = includeWalls ? grossWallArea(pLength.value, pWidth.value, pHeight.value) : new PEP(0);
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
    const net = includeWalls ? netWallArea(gross, deduction, activeDeduction) : { valid: true as const, area: new PEP(0) };

    if (!net.valid) {
      return { errors: ['Openings exceed the wall area — reduce the door/window count or turn off deductions.'], preview: clampForPreview(net.area) } as const;
    }

    const ceiling = includeCeiling ? ceilingArea(pLength.value, pWidth.value) : new PEP(0);
    const totalArea = net.area.plus(ceiling);
    const coatsN = pCoats.value;
    const raw = rawDemandGal(totalArea, coatsN, pWaste.value.dividedBy(100), pCoverage.value);
    const purchased = purchasedGallons(raw);
    const paintCost = pPrice.value.times(purchased);

    let laborCost: Dec | null = null;
    let hours: Dec | null = null;
    if (calculateLabor && rateVal && (includeWalls ? wallRateVal : true) && (includeCeiling ? ceilingRateVal : true)) {
      hours = new PEP(0);
      if (includeWalls && wallRateVal) hours = hours.plus(wallOrCeilingHours(net.area, coatsN, wallRateVal));
      if (includeCeiling && ceilingRateVal) hours = hours.plus(wallOrCeilingHours(ceiling, coatsN, ceilingRateVal));
      hours = hours.plus(prepHoursVal ?? new PEP(0));
      laborCost = hours.times(rateVal);
    }

    return {
      errors: [] as string[],
      gross,
      deduction,
      net: net.area,
      ceiling,
      totalArea,
      purchased,
      paintCost,
      hours,
      laborCost,
      total: laborCost ? paintCost.plus(laborCost) : paintCost,
      // INT-006: "Allow a labeled zero-rate scenario WITH a warning" -- the
      // calculation itself already tolerated $0/hr (a Decimal zero is a
      // valid, non-throwing divisor operand here since labor cost is a
      // multiplication, not a division), but no warning was ever surfaced.
      zeroRateWarning: calculateLabor && rateVal !== null && rateVal.isZero(),
    } as const;
  }, [length, width, height, includeWalls, includeCeiling, deductOpenings, openingMode, openings, doorCount, windowCount, coats, coverage, wastePercent, pricePerGal, calculateLabor, hourlyRate, wallThroughput, ceilingThroughput, prepHours]);

  return (
    <div className="card p-6 sm:p-7">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-ink">Room</h3>
            <button type="button" className="text-link text-xs" onClick={loadSampleData}>
              Load sample data (20×16×9 room)
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Length (ft)" value={length} onChange={setLength} />
            <Field label="Width (ft)" value={width} onChange={setWidth} />
            <Field label="Height (ft)" value={height} onChange={setHeight} />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={includeWalls} onChange={(e) => setIncludeWalls(e.target.checked)} /> Include walls
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={includeCeiling} onChange={(e) => setIncludeCeiling(e.target.checked)} /> Include ceiling (same paint)
          </label>
          {includeWalls && (
            <>
              <label className="flex items-center gap-2 text-sm text-ink">
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
            </>
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
              {includeWalls && <Field label="Wall sqft/hr/coat" value={wallThroughput} onChange={setWallThroughput} />}
              {includeCeiling && <Field label="Ceiling sqft/hr/coat" value={ceilingThroughput} onChange={setCeilingThroughput} />}
              <Field label="Prep/cleanup hours" value={prepHours} onChange={setPrepHours} />
            </div>
          )}
        </div>

        <div>
          <h3 className="text-base font-semibold text-ink">Result</h3>
          {result.errors.length === 0 && 'missing' in result && result.missing ? (
            <p className="mt-3 text-sm text-ink-soft">Enter the room's length and width to see your estimate — or load the sample room below.</p>
          ) : result.errors.length > 0 ? (
            <div className="mt-3 rounded-[calc(var(--radius-card)-8px)] border border-bad-line bg-bad-soft p-3 text-sm text-bad">
              {result.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          ) : (
            // UX-004: announce recalculated totals to screen readers.
            <dl className="mt-3 space-y-2 text-sm" aria-live="polite" aria-atomic="true">
              {includeWalls && <Row label="Gross wall area" value={`${result.gross!.toFixed(2)} ft²`} />}
              {includeWalls && deductOpenings && <Row label="Opening deduction" value={`${result.deduction!.toFixed(2)} ft²`} />}
              {includeWalls && <Row label="Net wall area" value={`${result.net!.toFixed(2)} ft²`} />}
              {includeCeiling && <Row label="Ceiling area" value={`${result.ceiling!.toFixed(2)} ft²`} />}
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
              <button
                type="button"
                className="btn btn-secondary mt-2"
                onClick={() => {
                  writeInteriorHandoff({
                    lengthFt: length, widthFt: width, heightFt: height, includeWalls, includeCeiling, deductOpenings, doorCount, windowCount, coats,
                    coverageFt2PerGal: coverage, pricePerGal: pricePerGal, wasteRatioPercent: wastePercent, prepHours: calculateLabor ? prepHours : undefined,
                    openingMode: deductOpenings ? openingMode : undefined,
                    openings: deductOpenings && openingMode === 'detailed' ? openings.map(({ type, widthFt, heightFt, count }) => ({ type, widthFt, heightFt, count })) : undefined,
                  });
                  window.open('/app?handoff=interior', '_blank');
                }}
              >
                Continue this room in Pro →
              </button>
              <p className="text-xs text-ink-soft">Opens Pro in a new tab with these room dimensions and paint pre-filled — this result stays right here. Pro access is still required there; nothing here unlocks it.</p>
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
