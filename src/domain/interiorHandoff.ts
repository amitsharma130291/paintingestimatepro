// UX-013: "Follow Pro invitation... compatible input handoff retains
// values/units; purchase not silently granted." The free interior
// calculator's inputs map closely onto Pro's Room + wall/ceiling Surface
// model — this is the one free tool whose fields genuinely correspond
// 1:1, so it's the one this session implements a handoff for (the
// estimate template's line items and the job-cost calculator's cost
// buckets don't map onto Pro's per-surface geometry model the same way).
//
// The handoff payload is written to sessionStorage by the free tool and
// read by the Pro app — never applied automatically, and never treated as
// proof of entitlement. Building the Room/Surface/Project objects here is
// pure and independent of whether the visitor is actually unlocked; the
// caller (ProApp) only ever invokes it after its own real entitlement
// check has already passed.
import type { PaintVariant, Room, Surface, EstimateRevision, RateSnapshot } from './entities';
import type { IdSource } from './ids';
import { createDraftRevision } from './project';
import { parseDecimalField } from '../engine/parse';

export const INTERIOR_HANDOFF_STORAGE_KEY = 'pep_interior_handoff_v1';

export interface InteriorHandoffPayload {
  lengthFt: string;
  widthFt: string;
  heightFt: string;
  // Optional, defaulting to true, for backward compatibility with payloads
  // written before the free calculator had an includeWalls toggle
  // (INT-008/009) — every wall was always enabled before this field existed.
  includeWalls?: boolean;
  includeCeiling: boolean;
  deductOpenings: boolean;
  doorCount: string;
  windowCount: string;
  coats: string;
  coverageFt2PerGal: string;
  pricePerGal: string;
  wasteRatioPercent: string;
  // V5-09: optional, for backward compatibility with payloads written
  // before the free calculator had a prep/cleanup hours field (INT-014).
  prepHours?: string;
  // INT-010: optional, for backward compatibility with payloads written
  // before the free calculator had detailed measured openings — every
  // payload before this field existed used quick counts only. When
  // present and 'detailed', `openings` carries the exact measured
  // entries and doorCount/windowCount above are ignored on the Pro side
  // (matching Room.openingMode's own quick/detailed exclusivity).
  openingMode?: 'quick' | 'detailed';
  openings?: { type: 'door' | 'window'; widthFt: string; heightFt: string; count: string }[];
}

export function writeInteriorHandoff(payload: InteriorHandoffPayload): void {
  try {
    sessionStorage.setItem(INTERIOR_HANDOFF_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* sessionStorage unavailable — handoff simply won't be offered on the Pro side */
  }
}

export function readInteriorHandoff(): InteriorHandoffPayload | null {
  try {
    const raw = sessionStorage.getItem(INTERIOR_HANDOFF_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearInteriorHandoff(): void {
  try {
    sessionStorage.removeItem(INTERIOR_HANDOFF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export interface HandoffFieldNote {
  field: string;
  note: string;
}

export interface BuiltHandoffResult {
  variant: PaintVariant;
  room: Room;
  surfaces: Surface[];
  revision: EstimateRevision;
  /** Fields the free tool collected that do NOT carry over, and why —
   * shown to the user so nothing is silently dropped or silently
   * defaulted. */
  unsupportedFieldNotes: HandoffFieldNote[];
}

/**
 * Converts a completed free interior-calculator entry into a new Pro draft
 * revision (one room, a wall surface, and a ceiling surface if the free
 * tool had it enabled) plus a new paint catalog variant carrying over the
 * free tool's coverage/price. Never silently invents or drops a value:
 * every free-tool field either has a direct home in the Pro model or is
 * listed in `unsupportedFieldNotes`.
 */
export function buildProjectFromInteriorHandoff(payload: InteriorHandoffPayload, snapshot: RateSnapshot, ids: IdSource): BuiltHandoffResult {
  const now = ids.now();
  const variant: PaintVariant = {
    id: ids.nextId(),
    name: 'From free calculator',
    color: 'unspecified',
    sheen: 'unspecified',
    pricePerGal: payload.pricePerGal,
    coverageFt2PerGal: payload.coverageFt2PerGal,
    purchaseIncrementGal: '1',
    createdAt: now,
    updatedAt: now,
  };

  const roomId = ids.nextId();
  const wallSurfaceId = ids.nextId();
  const wallSurface: Surface = {
    id: wallSurfaceId,
    roomId,
    kind: 'wall',
    enabled: payload.includeWalls !== false,
    measurementMode: 'roomDerived',
    areaFt2: null,
    trimLengthFt: null,
    developedWidthFt: null,
    doorCount: null,
    widthFt: null,
    heightFt: null,
    paintedSides: null,
    paintVariantId: variant.id,
    coats: Number.parseInt(payload.coats, 10) || null,
    wasteRatio: payload.wasteRatioPercent ? String(Number(payload.wasteRatioPercent) / 100) : null,
    loadedHourlyRate: null,
    throughput: null,
    hoursPerSidePerCoat: null,
  };

  const surfaces: Surface[] = [wallSurface];
  const surfaceIds = [wallSurfaceId];

  if (payload.includeCeiling) {
    const ceilingSurfaceId = ids.nextId();
    surfaces.push({
      ...wallSurface,
      id: ceilingSurfaceId,
      kind: 'ceiling',
      enabled: true, // independent of the wall surface's own enabled state (INT-008/009: ceiling-only rooms disable the wall, never the ceiling)
    });
    surfaceIds.push(ceilingSurfaceId);
  }

  // INT-010: a detailed-mode handoff carries its measured openings
  // through EXACTLY (same width/height/count text, no transformation --
  // matching CALCULATION_SPEC's detailedOpeningArea, which both tools
  // call), each stamped with a fresh Pro-side id. Quick mode still maps
  // straight onto Room.quick as before.
  const isDetailed = payload.openingMode === 'detailed' && payload.openings && payload.openings.length > 0;
  const room: Room = {
    id: roomId,
    name: 'Room (from free calculator)',
    lengthFt: payload.lengthFt || null,
    widthFt: payload.widthFt || null,
    heightFt: payload.heightFt || null,
    deductionEnabled: payload.deductOpenings,
    openingMode: isDetailed ? 'detailed' : 'quick',
    quick: {
      doorCount: Number.parseInt(payload.doorCount, 10) || 0,
      windowCount: Number.parseInt(payload.windowCount, 10) || 0,
      doorAreaEach: '20',
      windowAreaEach: '15',
    },
    openings: isDetailed
      ? payload.openings!.map((o) => ({ id: ids.nextId(), type: o.type, widthFt: o.widthFt, heightFt: o.heightFt, count: Number.parseInt(o.count, 10) || 0 }))
      : [],
    surfaceIds,
  };

  let revision = { ...createDraftRevision(ids.nextId(), snapshot, ids), rooms: [room], surfaces };

  const unsupportedFieldNotes: HandoffFieldNote[] = [
    { field: 'Labor rate / production throughput', note: "Not transferred — Pro uses your business settings' rates instead of the free calculator's, so estimates stay consistent across every project." },
  ];

  // V5-09: the free calculator's own hourly rate is intentionally never
  // transferred (see the note above — Pro uses its own consistent
  // business rate instead), but the ENTERED HOURS themselves are a real
  // scope input that must not simply vanish. Preserve them as a named
  // additionalLabor line costed at the destination Pro business's own
  // loaded rate; if that rate isn't configured yet, disclose the omission
  // explicitly instead of inventing a rate or silently dropping the hours.
  const prepHoursField = payload.prepHours ? parseDecimalField(payload.prepHours) : { kind: 'missing' as const };
  if (prepHoursField.kind === 'valid' && prepHoursField.value.greaterThan(0)) {
    const destinationRate = snapshot.businessSettings.loadedHourlyRate;
    if (destinationRate) {
      revision = {
        ...revision,
        additionalLabor: [...revision.additionalLabor, { id: ids.nextId(), description: 'Prep/cleanup (from free calculator)', hours: payload.prepHours!, loadedHourlyRate: destinationRate }],
      };
    } else {
      unsupportedFieldNotes.push({ field: 'Prep/cleanup hours', note: `Entered as ${payload.prepHours} hours in the free calculator, but not transferred — set a loaded hourly rate in Business settings, then add this as an additional labor line yourself.` });
    }
  }

  return { variant, room, surfaces, revision, unsupportedFieldNotes };
}
