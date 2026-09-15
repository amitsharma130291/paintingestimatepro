// Independent tools-only RED regressions added during the v5 review.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { settings, variant, service, project, envelope, NOW } from '../audit/fixtures';
import { assembleServiceHealth } from '../../src/domain/serviceHealthAssembly';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { applyFullRestoreResolutions, planFullRestoreMerge, validateBackupEnvelope } from '../../src/domain/backup';
import { sequentialIdSource } from '../../src/domain/ids';
import { createDraftRevision, createDraftFromIssued, issueRevision, supersede } from '../../src/domain/project';
import { createSnapshot } from '../../src/domain/snapshot';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { readFrozenCalculatedOutputs } from '../../src/domain/calculationSnapshot';
import { openAppDb, STORES, writeProjectWithVersionCheck } from '../../src/storage/db';
import type { Surface } from '../../src/domain/entities';

export const wall = (): Surface => ({ id:'wall-1', roomId:null, kind:'wall', enabled:true, measurementMode:'manual', areaFt2:'400', trimLengthFt:null, developedWidthFt:null, doorCount:null, widthFt:null, heightFt:null, paintedSides:null, paintVariantId:'paint-1', coats:2, wasteRatio:'0.10', loadedHourlyRate:null, throughput:null, hoursPerSidePerCoat:null });
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

describe('Independent v5 tools contract review', () => {
  it('V5-01: an invalid 100% target returns structured invalid state instead of crashing service health', () => {
    let result: ReturnType<typeof assembleServiceHealth> | undefined;
    expect(() => { result = assembleServiceHealth(service(), [variant()], {...settings(), targetMarginRatio:'1'}); }).not.toThrow();
    expect(result?.state).toBe('invalid');
  });

  it('V5-02: keeping both paints preserves the LOCAL service reference while remapping the imported service', () => {
    const localService = service();
    const local = {businessSettings:settings(), paintVariants:[variant()], otherMaterials:[], serviceDefinitions:[localService], projects:[]};
    const incoming = envelope([]);
    incoming.paintVariants[0].pricePerGal = '99';
    incoming.serviceDefinitions = [{...service(), id:'incoming-service'}];
    const plan = planFullRestoreMerge(local, incoming);
    const merged = applyFullRestoreResolutions(local, incoming, plan, {'paintVariant:paint-1':'keepBoth'}, {}, sequentialIdSource());
    expect(merged.finalServiceDefinitions.find(s=>s.id===localService.id)?.paintVariantId).toBe('paint-1');
    const importedPaint = merged.finalPaintVariants.find(v=>v.pricePerGal==='99')!;
    expect(merged.finalServiceDefinitions.find(s=>s.id==='incoming-service')?.paintVariantId).toBe(importedPaint.id);
  });

  it('V5-03: upgrading a real v2 database must not reuse a token and accept a stale editor save', async () => {
    const old = await openDB('painting-estimate-pro',2,{upgrade(db) {
      for(const s of Object.values(STORES).filter(s=>s!=='meta')) db.createObjectStore(s,{keyPath:s==='importProvenance'?'copiedProjectId':'id'});
    }});
    const original = project(); // v4's initial committed version is 1
    await old.put('projects',original); old.close();
    const db = await openAppDb();
    try {
      await writeProjectWithVersionCheck(db,{...original,title:'New work after upgrade'},1);
      await expect(writeProjectWithVersionCheck(db,{...original,title:'Stale pre-upgrade work'},1)).rejects.toThrow();
    } finally { db.close(); }
  });

  it('V5-04: a backup remains valid after issuing revision 2 when actuals still belong to revision 1', () => {
    const ids = sequentialIdSource();
    const p = project();
    const doc = (r: typeof p.revisions[0]) => buildCustomerDocument(r,{estimateNumber:'E1',estimateDate:'2026-01-01',projectAddress:'',revisionLabel:String(r.revisionNumber)});
    const issued1 = issueRevision({...p.revisions[0],title:'Original work',proposedPrice:'100',calculationState:'complete'},doc,ids);
    p.revisions = [issued1]; p.activeRevisionId=issued1.id;
    p.actualReviews = [{id:'actual-1',projectId:p.id,baselineIssuedRevisionId:issued1.id,state:'final',materials:{confirmed:true,amount:'10'},labor:{confirmed:true,amount:'20'},otherExpenses:{confirmed:true,amount:'0'},overhead:{confirmed:true,amount:'5',mode:'actualFlat'},updatedAt:NOW}];
    const before = envelope([p]);
    expect(validateBackupEnvelope(before,JSON.stringify(before).length).ok).toBe(true);
    const issued2 = issueRevision(createDraftFromIssued(issued1,ids),doc,ids);
    p.revisions=[supersede(issued1,ids),issued2]; p.activeRevisionId=issued2.id;
    const after = envelope([p]);
    expect(validateBackupEnvelope(after,JSON.stringify(after).length).ok).toBe(true);
  });

  it('V5-05: a new draft includes a configured $50 supplies allowance in material cost', () => {
    const config={...settings(),defaultSuppliesAllowance:{mode:'flat' as const,amount:'50',ratio:'0'}};
    const ids=sequentialIdSource();
    const revision=createDraftRevision('p1',createSnapshot(config,[variant()],[],ids,'c1'),ids);
    revision.surfaces=[wall()];
    const result=assembleProjectEstimate(revision,{priceMode:'suggested',customPriceRaw:''});
    expect(result.calculationState).toBe('complete');
    // Paint: ceil(400*2*1.1/350)=3 gallons; 3*$42+$50 supplies=$176.
    expect(result.materials?.toFixed(2)).toBe('176.00');
  });

  it('V5-06: NaN is not accepted as a frozen historical job cost', () => {
    expect(readFrozenCalculatedOutputs({schemaVersion:1,engineVersion:'2.1.0',jobCost:'NaN',overhead:'0'}).status).not.toBe('frozen');
  });

  it('V5-07: a user-entered selling total with three decimal places is invalid', () => {
    const revision=project().revisions[0]; revision.surfaces=[wall()];
    const result=assembleProjectEstimate(revision,{priceMode:'custom',customPriceRaw:'12.005'});
    expect(result.calculationState).toBe('invalid');
  });
});
