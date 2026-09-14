import { useMemo, useState } from 'react';
import { PEP, type Dec } from '../../engine/decimal';
import { parseDecimalField, parseCountField } from '../../engine/parse';
import { grossWallArea, ceilingArea, quickOpeningArea, netWallArea, clampForPreview } from '../../engine/geometry';
import { rawDemandGal, purchasedGallons } from '../../engine/paint';
import { wallOrCeilingHours } from '../../engine/labor';
import { writeInteriorHandoff } from '../../domain/interiorHandoff';

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
  length: '', width: '', height: '8', includeCeiling: false, deductOpenings: true,
  doorCount: '0', windowCount: '0', coats: '2', coverage: '350', wastePercent: '10', pricePerGal: '45',
  calculateLabor: false, hourlyRate: '32', wallThroughput: '150', ceilingThroughput: '120',
};
const FIXTURE_SAMPLE = { length: '20', width: '16', height: '9', doorCount: '2', windowCount: '3', coats: '2', coverage: '350', wastePercent: '10', pricePerGal: '42' };

export default function InteriorCalculator() {
  const [length, setLength] = useState(DEFAULTS.length);
  const [width, setWidth] = useState(DEFAULTS.width);
  const [height, setHeight] = useState(DEFAULTS.height);
  const [includeCeiling, setIncludeCeiling] = useState(DEFAULTS.includeCeiling);
  const [deductOpenings, setDeductOpenings] = useState(DEFAULTS.deductOpenings);
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

  function loadSampleData() {
    setLength(FIXTURE_SAMPLE.length);
    setWidth(FIXTURE_SAMPLE.width);
    setHeight(FIXTURE_SAMPLE.height);
    setIncludeCeiling(false);
    setDeductOpenings(true);
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
    const pDoors = parseCountField(doorCount, { min: 0 });
    const pWindows = parseCountField(windowCount, { min: 0 });
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
    if (pLength.kind === 'invalid' || (pLength.kind === 'valid' && pLength.value.lessThanOrEqualTo(0))) errors.push('Room length must be a positive number.');
    if (pWidth.kind === 'invalid' || (pWidth.kind === 'valid' && pWidth.value.lessThanOrEqualTo(0))) errors.push('Room width must be a positive number.');
    if (pHeight.kind !== 'valid' || pHeight.value.lessThanOrEqualTo(0)) errors.push('Wall height must be a positive number.');
    if (pDoors.kind === 'invalid') errors.push(`Doors: ${pDoors.message}`);
    if (pWindows.kind === 'invalid') errors.push(`Windows: ${pWindows.message}`);
    if (pCoats.kind !== 'valid') errors.push('Coats must be a whole number from 1 to 5.');
    if (pCoverage.kind !== 'valid' || pCoverage.value.lessThanOrEqualTo(0)) errors.push('Coverage must be a positive number.');
    if (pWaste.kind !== 'valid') errors.push('Waste % must be a number.');
    if (pPrice.kind !== 'valid' || pPrice.value.lessThanOrEqualTo(0)) errors.push('Price per gallon must be a positive number.');

    let laborRateErr: string | null = null;
    let wallRateVal: Dec | null = null;
    let ceilingRateVal: Dec | null = null;
    let rateVal: Dec | null = null;
    if (calculateLabor) {
      const pRate = parseDecimalField(hourlyRate);
      const pWallRate = parseDecimalField(wallThroughput);
      const pCeilingRate = parseDecimalField(ceilingThroughput);
      if (pRate.kind !== 'valid') laborRateErr = 'Hourly rate must be a number.';
      else rateVal = pRate.value;
      if (pWallRate.kind !== 'valid' || pWallRate.value.lessThanOrEqualTo(0)) laborRateErr = 'Wall production rate must be positive.';
      else wallRateVal = pWallRate.value;
      if (includeCeiling && (pCeilingRate.kind !== 'valid' || pCeilingRate.value.lessThanOrEqualTo(0))) laborRateErr = 'Ceiling production rate must be positive.';
      else if (pCeilingRate.kind === 'valid') ceilingRateVal = pCeilingRate.value;
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
      pDoors.kind !== 'valid' ||
      pWindows.kind !== 'valid'
    ) {
      return { errors, missing } as const;
    }

    const gross = grossWallArea(pLength.value, pWidth.value, pHeight.value);
    const deduction = deductOpenings ? quickOpeningArea(pDoors.value, new PEP(20), pWindows.value, new PEP(15)) : new PEP(0);
    const net = netWallArea(gross, deduction, deductOpenings);

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
    if (calculateLabor && rateVal && wallRateVal) {
      hours = wallOrCeilingHours(net.area, coatsN, wallRateVal);
      if (includeCeiling && ceilingRateVal) hours = hours.plus(wallOrCeilingHours(ceiling, coatsN, ceilingRateVal));
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
    } as const;
  }, [length, width, height, includeCeiling, deductOpenings, doorCount, windowCount, coats, coverage, wastePercent, pricePerGal, calculateLabor, hourlyRate, wallThroughput, ceilingThroughput]);

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
            <input type="checkbox" checked={includeCeiling} onChange={(e) => setIncludeCeiling(e.target.checked)} /> Include ceiling (same paint)
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={deductOpenings} onChange={(e) => setDeductOpenings(e.target.checked)} /> Deduct doors/windows
          </label>
          {deductOpenings && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Doors (20 ft² each)" value={doorCount} onChange={setDoorCount} />
              <Field label="Windows (15 ft² each)" value={windowCount} onChange={setWindowCount} />
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
              <Field label="Wall sqft/hr/coat" value={wallThroughput} onChange={setWallThroughput} />
              {includeCeiling && <Field label="Ceiling sqft/hr/coat" value={ceilingThroughput} onChange={setCeilingThroughput} />}
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
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Gross wall area" value={`${result.gross!.toFixed(2)} ft²`} />
              <Row label="Opening deduction" value={`${result.deduction!.toFixed(2)} ft²`} />
              <Row label="Net wall area" value={`${result.net!.toFixed(2)} ft²`} />
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
              <p className="pt-2 text-xs text-ink-soft">{result.laborCost ? 'Paint + entered labor estimate; excludes other supplies, overhead, and tax.' : 'Paint materials only.'}</p>
              <button
                type="button"
                className="btn btn-secondary mt-2"
                onClick={() => {
                  writeInteriorHandoff({ lengthFt: length, widthFt: width, heightFt: height, includeCeiling, deductOpenings, doorCount, windowCount, coats, coverageFt2PerGal: coverage, pricePerGal: pricePerGal, wasteRatioPercent: wastePercent });
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
