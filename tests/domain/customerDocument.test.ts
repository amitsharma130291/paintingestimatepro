// V6-01: buildCustomerDocument only ever iterated revision.rooms, so any
// enabled standalone surface (roomId===null -- a door-only or trim-only
// job, explicitly supported per tool-specs/05) was priced, issueable, and
// silently absent from its own customer document. Room-generated scope
// also never described coat counts at all. This is the dedicated test file
// for buildCustomerDocument's scope-line content (distinct from the DOC-P01
// allow-list-guard tests in tests/domain/lifecycle.test.ts).
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import { buildCustomerDocument, assertOnlyAllowedFields } from '../../src/domain/customerDocument';
import type { BusinessSettings, PaintVariant, Surface, Room, EstimateRevision } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';
function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}
function variant(): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}
function baseRevision(settingsOverrides: Partial<BusinessSettings> = {}): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(settingsOverrides), [variant()], [], ids, 'rev-1');
  return createDraftRevision('project-1', snap, ids);
}
const meta = { estimateNumber: 'E-1', estimateDate: '2026-01-01', projectAddress: '', revisionLabel: 'Rev 1' };

function doorSurface(overrides: Partial<Surface> = {}): Surface {
  return { id: 'door-1', roomId: null, kind: 'door', enabled: true, measurementMode: 'manual', areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: 2, widthFt: '3', heightFt: '7', paintedSides: 2, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null, ...overrides };
}
function trimSurface(overrides: Partial<Surface> = {}): Surface {
  return { id: 'trim-1', roomId: null, kind: 'trim', enabled: true, measurementMode: 'manual', areaFt2: null, trimLengthFt: '40', developedWidthFt: '0.5', doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null, ...overrides };
}
function room(overrides: Partial<Room> = {}): Room {
  return { id: 'room-1', name: 'Bedroom', lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: false, openingMode: 'quick', quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: ['wall-1'], ...overrides };
}
function wallSurface(overrides: Partial<Surface> = {}): Surface {
  return { id: 'wall-1', roomId: 'room-1', kind: 'wall', enabled: true, measurementMode: 'roomDerived', areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null, ...overrides };
}

describe('V6-01: buildCustomerDocument scope lines include every enabled priced surface', () => {
  it('door-only (standalone, no room)', () => {
    const revision = { ...baseRevision(), surfaces: [doorSurface()] };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines.join(' ')).toMatch(/door/i);
    expect(doc.scopeLines.join(' ')).toMatch(/2\s*coats?/i);
    expect(doc.scopeLines.join(' ')).toMatch(/2\s*doors?/i);
  });

  it('trim-only (standalone, no room)', () => {
    const revision = { ...baseRevision(), surfaces: [trimSurface()] };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines.join(' ')).toMatch(/trim/i);
    expect(doc.scopeLines.join(' ')).toMatch(/2\s*coats?/i);
    expect(doc.scopeLines.join(' ')).toMatch(/40\s*ft/i);
  });

  it('room-only, including coat count', () => {
    const revision = { ...baseRevision(), rooms: [room()], surfaces: [wallSurface({ coats: 3 })] };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines.join(' ')).toMatch(/wall/i);
    expect(doc.scopeLines.join(' ')).toMatch(/3\s*coats?/i);
  });

  it('mixed room and standalone scope', () => {
    const revision = { ...baseRevision(), rooms: [room()], surfaces: [wallSurface(), doorSurface({ id: 'door-2' })] };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines.join(' ')).toMatch(/wall/i);
    expect(doc.scopeLines.join(' ')).toMatch(/door/i);
    expect(doc.scopeLines).toHaveLength(2); // one room line, one standalone line
  });

  it('a room surface with a null coats override displays the snapshot default (2)', () => {
    const revision = { ...baseRevision({ defaultCoats: 2 }), rooms: [room()], surfaces: [wallSurface({ coats: null })] };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines.join(' ')).toMatch(/2\s*coats?/i);
  });

  it('a single coat is described in the singular ("1 coat", not "1 coats")', () => {
    const revision = { ...baseRevision(), surfaces: [doorSurface({ coats: 1 })] };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines.join(' ')).toMatch(/1\s*coat\b/i);
    expect(doc.scopeLines.join(' ')).not.toMatch(/1\s*coats\b/i);
  });

  it('disabled surfaces (room-attached or standalone) never appear in scope', () => {
    const revision = { ...baseRevision(), rooms: [room()], surfaces: [wallSurface(), doorSurface({ id: 'door-disabled', enabled: false })] };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines.join(' ')).not.toMatch(/door/i);
  });

  it('a disabled room surface leaves that room labeled "no surfaces enabled"', () => {
    const revision = { ...baseRevision(), rooms: [room()], surfaces: [wallSurface({ enabled: false })] };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines.join(' ')).toMatch(/no surfaces enabled/i);
  });

  it('never leaks cost, rate, or overhead fields even with a full scope', () => {
    const revision = { ...baseRevision(), rooms: [room()], surfaces: [wallSurface(), doorSurface({ id: 'door-2' })], proposedPrice: '500.00' };
    const doc = buildCustomerDocument(revision, meta);
    expect(() => assertOnlyAllowedFields(doc as unknown as Record<string, unknown>)).not.toThrow();
    expect(JSON.stringify(doc)).not.toMatch(/loadedHourlyRate|overheadRatio|wasteRatio|paintVariantId/i);
  });

  it('long room names and special characters render as literal text, not corrupting the scope structure', () => {
    const revision = { ...baseRevision(), rooms: [room({ name: '<script>alert(1)</script> & "Master" Bedroom'.repeat(2) })], surfaces: [wallSurface()] };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines[0]).toContain('<script>'); // stored as plain text; the RENDERER (not this builder) is responsible for HTML-escaping on display
    expect(doc.scopeLines).toHaveLength(1);
  });
});

describe('DOC-003: an issued price is ONE exact project total, never distributed/invented across multiple scope descriptions', () => {
  it('a multi-room, multi-surface scope (several description lines) still carries exactly one proposedPrice field, set to the full $1000.00', () => {
    const revision = {
      ...baseRevision(),
      rooms: [room({ id: 'room-1', name: 'Bedroom', surfaceIds: ['wall-1'] }), room({ id: 'room-2', name: 'Kitchen', surfaceIds: ['wall-2'] })],
      surfaces: [wallSurface({ id: 'wall-1', roomId: 'room-1' }), wallSurface({ id: 'wall-2', roomId: 'room-2' }), doorSurface({ id: 'door-1' })],
      proposedPrice: '1000.00',
    };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.scopeLines.length).toBeGreaterThan(1); // multiple descriptions
    expect(doc.proposedPrice).toBe('1000.00'); // one exact total, unchanged by how many lines describe the scope
    // CustomerDocumentSnapshot has no per-line price field at all -- a
    // per-description breakdown is structurally impossible to invent here.
    expect(() => assertOnlyAllowedFields(doc as unknown as Record<string, unknown>)).not.toThrow();
    expect('lineItems' in doc || 'perLinePrice' in doc || 'scopePrices' in doc).toBe(false);
  });
});

describe('DOC-006: a Pro customer document always carries a pre-tax notice, and never computes any sales tax', () => {
  it('taxNotice is always the fixed exact disclosure text, regardless of price', () => {
    const revision = { ...baseRevision(), surfaces: [wallSurface()], proposedPrice: '500.00' };
    const doc = buildCustomerDocument(revision, meta);
    expect(doc.taxNotice).toBe('Prices exclude taxes; taxes are not calculated by this tool.');
    // The allow-list proves there is no separate "tax" field anywhere in
    // the customer-facing shape -- proposedPrice IS the final total.
    expect('tax' in doc || 'salesTax' in doc || 'taxAmount' in doc).toBe(false);
  });
});

describe('DOC-011: an issued document snapshot carries no engineVersion field at all, so it cannot be silently re-derived by a version check', () => {
  it('buildCustomerDocument\'s output shape has no engineVersion field -- an engine upgrade has nothing to key a recalculation on', () => {
    const revision = { ...baseRevision(), title: 'Kitchen', surfaces: [wallSurface()], proposedPrice: '750.00', calculationState: 'complete' as const };
    const doc = buildCustomerDocument(revision, meta);
    expect('engineVersion' in doc).toBe(false);
    // The full end-to-end proof that an ISSUED revision's document preview
    // is never recalculated after an engine-version change (ProApp.tsx's
    // previewDocument memo returns the stored customerDocumentSnapshot
    // directly, never re-deriving it) is in
    // tests/browser/issuedDocumentEngineUpgrade.test.tsx.
  });
});
