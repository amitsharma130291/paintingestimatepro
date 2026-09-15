import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import { exportBackup } from '../../src/domain/backup';
import type { BusinessSettings, PaintVariant, Project, ServiceDefinition } from '../../src/domain/entities';
export const NOW = '2026-01-01T00:00:00.000Z';
export function settings(): BusinessSettings {
  return { id: 'default-settings', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0', defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW };
}
export function variant(): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}
export function project(): Project {
  const ids = sequentialIdSource();
  const revision = createDraftRevision('p1', createSnapshot(settings(), [variant()], [], ids, 'catalog-1'), ids);
  return { id: 'p1', title: 'Audit project', revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1 };
}
export function envelope(projects: Project[] = [project()]) {
  return exportBackup('audit-install', settings(), [variant()], [], [], projects, sequentialIdSource());
}
export function service(): ServiceDefinition {
  return { id: 'service-1', name: 'Custom wall service', unit: 'ft2', kind: 'wall', paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: '32', throughput: '150', hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null, paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: '1.80', createdAt: NOW, updatedAt: NOW };
}
