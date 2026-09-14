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

export const INTERIOR_HANDOFF_STORAGE_KEY = 'pep_interior_handoff_v1';

export interface InteriorHandoffPayload {
  lengthFt: string;
  widthFt: string;
  heightFt: string;
  includeCeiling: boolean;
  deductOpenings: boolean;
  doorCount: string;
  windowCount: string;
  coats: string;
  coverageFt2PerGal: string;
  pricePerGal: string;
  wasteRatioPercent: string;
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
    enabled: true,
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
    });
    surfaceIds.push(ceilingSurfaceId);
  }

  const room: Room = {
    id: roomId,
    name: 'Room (from free calculator)',
    lengthFt: payload.lengthFt || null,
    widthFt: payload.widthFt || null,
    heightFt: payload.heightFt || null,
    deductionEnabled: payload.deductOpenings,
    openingMode: 'quick',
    quick: {
      doorCount: Number.parseInt(payload.doorCount, 10) || 0,
      windowCount: Number.parseInt(payload.windowCount, 10) || 0,
      doorAreaEach: '20',
      windowAreaEach: '15',
    },
    openings: [],
    surfaceIds,
  };

  const revision = { ...createDraftRevision(ids.nextId(), snapshot, ids), rooms: [room], surfaces };

  const unsupportedFieldNotes: HandoffFieldNote[] = [
    { field: 'Labor rate / production throughput', note: "Not transferred — Pro uses your business settings' rates instead of the free calculator's, so estimates stay consistent across every project." },
  ];

  return { variant, room, surfaces, revision, unsupportedFieldNotes };
}
