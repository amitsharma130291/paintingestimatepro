// DATA_CONTRACT.md — persisted entity shapes (schemaVersion 2). Decimal
// scalars are plain strings at rest (canonical decimal text); convert with
// `new PEP(x)` at the engine boundary, never store a `Decimal` instance or
// a binary float here.

export type ID = string;

export interface BusinessSettings {
  id: ID;
  loadedHourlyRate: string | null; // nullable until configured
  overheadRatio: string;
  targetMarginRatio: string;
  defaultCoats: number;
  defaultWasteRatio: string;
  wallThroughput: string | null;
  ceilingThroughput: string | null;
  trimThroughput: string | null;
  doorHoursPerSidePerCoat: string | null;
  defaultTravelAmount: string; // = "0" by default
  defaultSuppliesAllowance: { mode: 'none' | 'flat' | 'paintPercent'; amount: string; ratio: string };
  sampleAssumptionsConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaintVariant {
  id: ID;
  name: string;
  color: string; // may be 'unspecified' only if explicitly chosen
  sheen: string;
  pricePerGal: string;
  coverageFt2PerGal: string;
  purchaseIncrementGal: '1';
  createdAt: string;
  updatedAt: string;
}

export interface OtherMaterial {
  id: ID;
  name: string;
  unit: string;
  unitCost: string;
  createdAt: string;
  updatedAt: string;
}

export type ServiceKind = 'wall' | 'ceiling' | 'trim' | 'door';

export interface ServiceDefinition {
  id: ID;
  name: string;
  unit: 'ft2' | 'linearFt' | 'door';
  kind: ServiceKind;
  paintVariantId: ID | null;
  coats: number | null;
  wasteRatio: string | null;
  loadedHourlyRate: string | null;
  throughput: string | null; // wall/ceiling/trim only
  hoursPerSidePerCoat: string | null; // door only
  developedWidthFt: string | null; // trim only
  widthFt: string | null; // door only
  heightFt: string | null; // door only
  paintedSides: 1 | 2 | null; // door only
  additionalLaborHoursPerUnit: string;
  suppliesCostPerUnit: string;
  directExpensePerUnit: string;
  currentSellingPrice: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpeningEntry {
  id: ID;
  type: 'door' | 'window';
  widthFt: string;
  heightFt: string;
  count: number;
}

export interface Room {
  id: ID;
  name: string;
  lengthFt: string | null;
  widthFt: string | null;
  heightFt: string | null;
  deductionEnabled: boolean;
  openingMode: 'quick' | 'detailed';
  quick: { doorCount: number; windowCount: number; doorAreaEach: string; windowAreaEach: string };
  openings: OpeningEntry[];
  surfaceIds: ID[];
}

export interface Surface {
  id: ID;
  roomId: ID | null; // null = standalone (door-only/trim-only job)
  kind: ServiceKind;
  enabled: boolean;
  measurementMode: 'roomDerived' | 'manual';
  areaFt2: string | null; // manual wall/ceiling
  trimLengthFt: string | null;
  developedWidthFt: string | null;
  doorCount: number | null;
  widthFt: string | null;
  heightFt: string | null;
  paintedSides: 1 | 2 | null;
  paintVariantId: ID | null;
  coats: number | null;
  wasteRatio: string | null;
  loadedHourlyRate: string | null;
  throughput: string | null;
  hoursPerSidePerCoat: string | null;
}

export interface RateSnapshot {
  id: ID;
  capturedAt: string;
  sourceSettingsId: ID;
  sourceCatalogRevision: string;
  engineVersion: string;
  businessSettings: BusinessSettings;
  paintVariants: PaintVariant[];
  otherMaterials: OtherMaterial[];
  serviceAssumptionsUsed: Record<string, unknown>;
}

export interface AdditionalLaborLine {
  id: ID;
  description: string;
  hours: string;
  loadedHourlyRate: string;
}

export interface OtherMaterialLine {
  id: ID;
  description: string;
  sourceMaterialId: ID | null;
  unit: string;
  quantity: string;
  unitCost: string; // snapshot at time added
}

export interface ExpenseLine {
  id: ID;
  description: string;
  amount: string;
}

export type RevisionState = 'draft' | 'issued' | 'superseded';
export type PriceMode = 'suggested' | 'custom';

export interface CustomerDocumentSnapshot {
  estimateNumber: string;
  estimateDate: string;
  businessInfo: { name: string; contact: string; address: string; logo?: string };
  customerInfo: { name: string; address: string; contact: string };
  projectTitle: string;
  projectAddress: string;
  scopeLines: string[];
  proposedPrice: string;
  notes: string;
  terms: string;
  revisionLabel: string;
  taxNotice: string;
  status: 'draft' | 'issued';
}

export interface EstimateRevision {
  id: ID;
  projectId: ID;
  revisionNumber: number;
  state: RevisionState;
  title: string;
  businessInfo: { name: string; contact: string; address: string; logo?: string };
  customerInfo: { name: string; address: string; contact: string };
  rooms: Room[];
  surfaces: Surface[];
  activeRateSnapshot: RateSnapshot;
  additionalLabor: AdditionalLaborLine[];
  otherMaterialLines: OtherMaterialLine[];
  suppliesAllowance: { mode: 'none' | 'flat' | 'paintPercent'; amount: string; ratio: string };
  otherExpenses: ExpenseLine[];
  priceMode: PriceMode;
  proposedPrice: string | null;
  notes: string;
  terms: string;
  calculationState: 'complete' | 'incomplete' | 'invalid';
  engineVersion: string;
  rawCalculatedOutputs: Record<string, unknown> | null;
  customerDocumentSnapshot: CustomerDocumentSnapshot | null; // set on issue
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: ID;
  title: string;
  revisions: EstimateRevision[];
  activeRevisionId: ID;
  actualReviews: ActualReview[];
  createdAt: string;
  updatedAt: string;
  /** Monotonically increasing optimistic-concurrency token, checked and
   * incremented inside the same storage transaction as every write (see
   * storage/db.ts's writeProjectWithVersionCheck). A brand-new project
   * starts at 1. Deliberately NOT derived from a timestamp — two saves in
   * the same millisecond must still conflict, which an updatedAt-based
   * check cannot guarantee. */
  version: number;
}

export interface ActualCategoryRecord {
  confirmed: boolean;
  amount: string | null;
}

export interface ActualReview {
  id: ID;
  projectId: ID;
  baselineIssuedRevisionId: ID;
  state: 'inProgress' | 'final';
  materials: ActualCategoryRecord;
  labor: ActualCategoryRecord;
  otherExpenses: ActualCategoryRecord;
  laborBreakdown?: { mode: 'direct' | 'hoursRate'; hours?: string; rate?: string };
  overhead: ActualCategoryRecord & { mode: 'baselineAllocation' | 'actualFlat' };
  updatedAt: string;
}

export interface ImportProvenanceRecord {
  exportId: string;
  sourceProjectId: ID;
  copiedProjectId: ID;
  importedAt: string;
}

export interface BackupEnvelope {
  schemaVersion: 2;
  exportId: string;
  exportedAt: string;
  installationId: string;
  engineVersion: string;
  businessSettings: BusinessSettings;
  paintVariants: PaintVariant[];
  otherMaterials: OtherMaterial[];
  serviceDefinitions: ServiceDefinition[];
  projects: Project[];
  importProvenance: ImportProvenanceRecord[];
}

export const ENGINE_VERSION = '2.1.0';
export const SCHEMA_VERSION = 2 as const;
