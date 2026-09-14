// Ports every fixture in tests/fixtures/acceptance-fixtures.json (the
// authoritative v2.1 package) against the PRODUCTION engine in src/engine —
// per IMPLEMENTATION_PROMPT.md: "do not merely rerun the supplied Python
// oracle." The Python oracle (verify_reference.py) is a separate,
// independent check; this file is what actually exercises our code.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PEP, toMoneyString, toPercentString, type Dec } from '../../src/engine/decimal';
import { grossWallArea, ceilingArea, quickOpeningArea, netWallArea } from '../../src/engine/geometry';
import { rawDemandGal, aggregateRawDemandByVariant, purchasedGallons } from '../../src/engine/paint';
import { wallOrCeilingHours, trimHours, doorHours } from '../../src/engine/labor';
import { directCost, overheadAmount, estimatedJobCost } from '../../src/engine/cost';
import { evaluatePrice } from '../../src/engine/pricing';
import { computeServiceUnitCost } from '../../src/engine/serviceHealth';
import { computeDocumentTotals } from '../../src/engine/document';
import { evaluateActualReview } from '../../src/engine/actuals';
import { trimPaintableArea, doorPaintableArea } from '../../src/engine/geometry';

const fixturesPath = fileURLToPath(new URL('../fixtures/acceptance-fixtures.json', import.meta.url));
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf-8')) as {
  cases: { id: string; kind: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
};

// The fixtures' own note: "Oracle inputs may use rational strings solely to
// preserve exact expected arithmetic" — e.g. "1/75" instead of a repeating
// decimal. That's a fixture-authoring convenience, not a production input
// format (parse.ts's real UI grammar rejects "/" like any other non-decimal
// character). Handle it here only, when reading fixture JSON.
function d(x: unknown): Dec {
  const s = x as string;
  if (s.includes('/')) {
    const [num, denom] = s.split('/');
    return new PEP(num).dividedBy(new PEP(denom));
  }
  return new PEP(s);
}

function sixDp(x: Dec): string {
  return x.toDecimalPlaces(6, PEP.ROUND_HALF_UP).toFixed(6);
}

describe('NUM fixtures — production engine (acceptance-fixtures.json)', () => {
  for (const c of fixtures.cases) {
    it(`${c.id} (${c.kind})`, () => {
      const i = c.input as Record<string, string | number | null>;

      if (c.kind === 'job') {
        const dc = directCost(d(i.materials), d(i.labor), d(i.expenses));
        const oh = overheadAmount(dc, d(i.overheadRatio));
        const cost = estimatedJobCost(dc, oh);
        expect(toMoneyString(dc)).toBe(c.expected.directCost);
        expect(toMoneyString(oh)).toBe(c.expected.overhead);
        expect(toMoneyString(cost)).toBe(c.expected.cost);
        const priceInput = i.price === null ? null : d(i.price);
        const result = evaluatePrice({ cost, price: priceInput, targetMarginRatio: d(i.targetRatio) });
        expect(toMoneyString(result.approxPrice!)).toBe(c.expected.approxPrice);
        expect(toMoneyString(result.minimumTargetPrice!)).toBe(c.expected.minimumPrice);
        expect(toMoneyString(result.profit!)).toBe(c.expected.profit);
        expect(toPercentString(result.marginRatio!)).toBe(c.expected.marginPercent);
        return;
      }

      if (c.kind === 'price') {
        const cost = d(i.cost);
        const priceInput = i.price === null ? null : d(i.price);
        const result = evaluatePrice({ cost, price: priceInput, targetMarginRatio: d(i.targetRatio) });
        if (c.expected.profit === null) expect(result.profit).toBeNull();
        else expect(toMoneyString(result.profit!)).toBe(c.expected.profit);
        if (c.expected.marginPercent === null) expect(result.marginRatio).toBeNull();
        else expect(toPercentString(result.marginRatio!)).toBe(c.expected.marginPercent);
        expect(toMoneyString(result.approxPrice!)).toBe(c.expected.approxPrice);
        expect(toMoneyString(result.minimumTargetPrice!)).toBe(c.expected.minimumPrice);
        if (c.expected.status) expect(result.status).toBe(c.expected.status);
        return;
      }

      if (c.kind === 'interior') {
        const gross = grossWallArea(d(i.length), d(i.width), d(i.height));
        const deduction = quickOpeningArea(i.doorCount as number, d(i.doorArea), i.windowCount as number, d(i.windowArea));
        const net = netWallArea(gross, deduction, true);
        expect(net.valid).toBe(true);
        const ceiling = i.includeCeiling ? ceilingArea(d(i.length), d(i.width)) : new PEP(0);
        const totalArea = net.area.plus(ceiling);
        const coatArea = totalArea.times(i.coats as number);
        const raw = rawDemandGal(totalArea, i.coats as number, d(i.wasteRatio), d(i.coverage));
        const purchased = purchasedGallons(raw);
        const paintCost = d(i.paintPrice).times(purchased);
        const hours = wallOrCeilingHours(net.area, i.coats as number, d(i.wallRate)).plus(
          i.includeCeiling ? wallOrCeilingHours(ceiling, i.coats as number, d(i.ceilingRate)) : new PEP(0)
        );
        const laborCost = hours.times(d(i.laborRate));

        expect(toMoneyString(gross)).toBe(c.expected.grossArea);
        expect(toMoneyString(deduction)).toBe(c.expected.deduction);
        expect(toMoneyString(net.area)).toBe(c.expected.netWall);
        expect(toMoneyString(totalArea)).toBe(c.expected.totalArea);
        expect(toMoneyString(coatArea)).toBe(c.expected.coatArea);
        expect(sixDp(raw)).toBe(c.expected.rawGallons);
        expect(purchased).toBe(c.expected.purchaseGallons);
        expect(toMoneyString(paintCost)).toBe(c.expected.paintCost);
        expect(sixDp(hours)).toBe(c.expected.hours);
        expect(toMoneyString(laborCost)).toBe(c.expected.laborCost);
        expect(toMoneyString(paintCost.plus(laborCost))).toBe(c.expected.totalCost);
        return;
      }

      if (c.kind === 'document') {
        const lines = (i.lines as unknown as [string, string][]).map(([q, p]) => ({ quantity: d(q), unitSellingPrice: d(p) }));
        const totals = computeDocumentTotals(lines, true, d(i.taxRatio));
        expect(totals.lineTotals.map((t) => t.toFixed(2))).toEqual(c.expected.lines);
        expect(toMoneyString(totals.subtotal)).toBe(c.expected.subtotal);
        expect(toMoneyString(totals.tax)).toBe(c.expected.tax);
        expect(toMoneyString(totals.total)).toBe(c.expected.total);
        return;
      }

      if (c.kind === 'paint') {
        const demands = (i.demands as unknown as [string, string][]).map(([variant, demand]) => ({
          paintVariantId: variant,
          rawGal: d(demand),
        }));
        const totals = aggregateRawDemandByVariant(demands);
        const purchases: Record<string, number> = {};
        let cost = new PEP(0);
        const prices = i.prices as unknown as Record<string, string>;
        for (const [variant, rawGal] of totals) {
          const purchased = purchasedGallons(rawGal);
          purchases[variant] = purchased;
          cost = cost.plus(d(prices[variant]).times(purchased));
        }
        expect(purchases).toEqual(c.expected.purchases);
        expect(toMoneyString(cost)).toBe(c.expected.paintCost);
        return;
      }

      if (c.kind === 'service') {
        const unit = computeServiceUnitCost({
          kind: 'wall',
          areaPerUnit: d(i.areaPerUnit),
          coats: i.coats as number,
          wasteRatio: d(i.wasteRatio),
          coverageFt2PerGal: d(i.coverage),
          pricePerGal: d(i.paintPrice),
          applicationHoursPerUnit: d(i.applicationHours),
          additionalLaborHoursPerUnit: d(i.additionalHours),
          loadedHourlyRate: d(i.laborRate),
          suppliesCostPerUnit: d(i.supplies),
          directExpensePerUnit: d(i.expenses),
          overheadRatio: d(i.overheadRatio),
        });
        expect(sixDp(unit.paintConsumptionCostPerUnit)).toBe(c.expected.paintPerUnit);
        expect(sixDp(unit.laborCostPerUnit)).toBe(c.expected.laborPerUnit);
        expect(sixDp(unit.modeledCostPerUnit)).toBe(c.expected.costPerUnit);
        const result = evaluatePrice({ cost: unit.modeledCostPerUnit, price: d(i.price), targetMarginRatio: d(i.targetRatio) });
        expect(toPercentString(result.marginRatio!)).toBe(c.expected.marginPercent);
        expect(toMoneyString(result.approxPrice!)).toBe(c.expected.approxPrice);
        expect(toMoneyString(result.minimumTargetPrice!)).toBe(c.expected.minimumPrice);
        return;
      }

      if (c.kind === 'surface') {
        let area: Dec;
        let hours: Dec;
        if (i.surfaceKind === 'trim') {
          area = trimPaintableArea(d(i.length), d(i.developedWidth));
          hours = trimHours(d(i.length), i.coats as number, d(i.throughput));
        } else {
          area = doorPaintableArea(i.count as number, d(i.width), d(i.height), i.sides as 1 | 2);
          hours = doorHours(i.count as number, i.sides as 1 | 2, i.coats as number, d(i.hoursPerSidePerCoat));
        }
        const raw = rawDemandGal(area, i.coats as number, d(i.wasteRatio), d(i.coverage));
        const purchased = purchasedGallons(raw);
        const laborCost = hours.times(d(i.laborRate));
        const paintCost = d(i.paintPrice).times(purchased);

        expect(toMoneyString(area)).toBe(c.expected.area);
        expect(sixDp(raw)).toBe(c.expected.rawGallons);
        expect(purchased).toBe(c.expected.purchasedGallons);
        expect(sixDp(hours)).toBe(c.expected.hours);
        expect(toMoneyString(laborCost)).toBe(c.expected.laborCost);
        expect(toMoneyString(paintCost)).toBe(c.expected.paintCost);
        return;
      }

      if (c.kind === 'actual') {
        const result = evaluateActualReview({
          materials: { confirmed: true, amount: d(i.materials) },
          labor: { confirmed: true, amount: d(i.labor) },
          otherExpenses: { confirmed: true, amount: d(i.expenses) },
          overhead: { confirmed: true, amount: d(i.overhead) },
          baselinePrice: d(i.baselinePrice),
          baselineCost: d(i.baselineCost),
        });
        expect(toMoneyString(result.actualCost!)).toBe(c.expected.actualCost);
        expect(toMoneyString(result.profitAgainstOriginalQuote!)).toBe(c.expected.profit);
        if (c.expected.marginPercent === null) expect(result.marginRatio).toBeNull();
        else expect(toPercentString(result.marginRatio!)).toBe(c.expected.marginPercent);
        expect(toMoneyString(result.totalVariance!)).toBe(c.expected.totalVariance);
        return;
      }

      throw new Error(`Unhandled fixture kind: ${c.kind}`);
    });
  }
});
