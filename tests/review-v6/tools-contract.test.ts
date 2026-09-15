import { describe, it, expect } from 'vitest';
import { project, envelope, settings, variant, NOW } from '../audit/fixtures';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { checkIssueGate, issueRevision, upsertRevision } from '../../src/domain/project';
import { applyRateRefresh, undoRateRefresh } from '../../src/domain/rateRefresh';
import { planImportAsCopies, validateBackupEnvelope } from '../../src/domain/backup';
import { createSnapshot } from '../../src/domain/snapshot';
import { freezeCalculatedOutputs } from '../../src/domain/calculationSnapshot';
import type { Surface, Room } from '../../src/domain/entities';

const priceOptions = { priceMode: 'suggested' as const, customPriceRaw: '' };
function ids() { let n=0; return { nextId:()=>`review-copy-${++n}`, now:()=>NOW }; }
function wall(): Surface {
  return {id:'wall-1',roomId:null,kind:'wall',enabled:true,measurementMode:'manual',areaFt2:'320',trimLengthFt:null,developedWidthFt:null,doorCount:null,widthFt:null,heightFt:null,paintedSides:null,paintVariantId:'paint-1',coats:2,wasteRatio:'0.1',loadedHourlyRate:null,throughput:null,hoursPerSidePerCoat:null};
}
function measuredRoom(): Room {
  return {id:'room-1',name:'Bedroom',lengthFt:'20',widthFt:'16',heightFt:'9',deductionEnabled:true,openingMode:'detailed',quick:{doorCount:0,windowCount:0,doorAreaEach:'20',windowAreaEach:'15'},openings:[{id:'opening-1',type:'door',widthFt:'3',heightFt:'6.67',count:1}],surfaceIds:['wall-1']};
}

describe('Independent v6 tools contract review',()=>{
  it('CONTROL: full additional-cost math and exact measured-opening labor agree with independent calculations',()=>{
    const r=project().revisions[0]; r.surfaces=[wall()];
    r.additionalLabor=[{id:'prep',description:'Prep',hours:'2',loadedHourlyRate:'32'}];
    r.otherMaterialLines=[{id:'caulk',description:'Caulk',sourceMaterialId:null,unit:'tube',quantity:'3',unitCost:'6.50'}];
    r.suppliesAllowance={mode:'flat',amount:'25',ratio:'0'};
    r.otherExpenses=[{id:'travel',description:'Travel',amount:'40'}];
    const result=assembleProjectEstimate(r,priceOptions);
    expect(result.calculationState).toBe('complete');
    expect(result.materials?.toFixed(2)).toBe('170.50');
    expect(result.laborCost?.toFixed(2)).toBe('200.53');
    expect(result.directCost?.toFixed(2)).toBe('411.03');
    expect(result.overhead?.toFixed(3)).toBe('61.655');
    expect(result.jobCost?.toFixed(5)).toBe('472.68833');
    expect(result.effectivePrice?.toFixed(2)).toBe('727.22');
    const measured=project().revisions[0]; measured.rooms=[measuredRoom()];
    measured.surfaces=[{...wall(),roomId:'room-1',measurementMode:'roomDerived',areaFt2:null}];
    // 648 - 3*6.67 = 627.99; labor = 627.99*2/150*32 = 267.9424.
    expect(assembleProjectEstimate(measured,priceOptions).laborCost?.toFixed(4)).toBe('267.9424');
  });

  it('V6-01: issued standalone door work appears in customer scope with its coats',()=>{
    const r=project().revisions[0]; r.title='Two doors';
    r.surfaces=[{...wall(),id:'door-1',kind:'door',areaFt2:null,doorCount:2,widthFt:'3',heightFt:'7',paintedSides:2}];
    const result=assembleProjectEstimate(r,priceOptions);
    expect(result.calculationState).toBe('complete');
    r.calculationState='complete'; r.proposedPrice=result.effectivePrice!.toFixed(2);
    r.rawCalculatedOutputs=freezeCalculatedOutputs(result,r.engineVersion);
    expect(checkIssueGate(r,{sampleAssumptionsConfirmed:true,zeroPriceConfirmed:false}).canIssue).toBe(true);
    const issued=issueRevision(r,(rev)=>buildCustomerDocument(rev,{estimateNumber:'TEST-1',estimateDate:'2026-01-01',projectAddress:'',revisionLabel:'1'}),ids());
    expect(issued.customerDocumentSnapshot!.scopeLines.join(' ')).toMatch(/door/i);
    expect(issued.customerDocumentSnapshot!.scopeLines.join(' ')).toMatch(/2\s*coats?/i);
  });

  it('V6-02: import rejects an incomplete recovery checkpoint before Undo can activate it',()=>{
    const backup=envelope();
    expect(validateBackupEnvelope(backup,JSON.stringify(backup).length).ok).toBe(true);
    const r=backup.projects[0].revisions[0];
    r.preRefreshCheckpoint={id:r.id} as typeof r;
    // Demonstrate this is executable state, not inert metadata.
    expect(()=>assembleProjectEstimate(undoRateRefresh(r)!,priceOptions)).toThrow();
    expect(validateBackupEnvelope(backup,JSON.stringify(backup).length).ok).toBe(false);
  });

  it('V6-03: importing as a copy then undoing refresh keeps the copied project/revision identities',()=>{
    const p=project(); p.revisions[0].surfaces=[wall()]; const idSource=ids();
    p.revisions[0]=applyRateRefresh(p.revisions[0],createSnapshot(settings(),[{...variant(),pricePerGal:'50'}],[],idSource,'new-catalog'),[],idSource);
    const backup=envelope([p]);
    expect(validateBackupEnvelope(backup,JSON.stringify(backup).length).ok).toBe(true);
    const copy=planImportAsCopies([p],'copy-export',new Set(),idSource).projects[0];
    const active=copy.revisions[0]; const undone=undoRateRefresh(active)!;
    expect.soft({projectId:undone.projectId,revisionId:undone.id}).toEqual({projectId:copy.id,revisionId:active.id});
    const after=envelope([upsertRevision(copy,undone)]);
    expect(validateBackupEnvelope(after,JSON.stringify(after).length).ok).toBe(true);
  });

  it.each(['quick','detailed'] as const)('V6-04: negative %s opening count blocks pricing instead of adding wall area',(mode)=>{
    const r=project().revisions[0]; const room=measuredRoom(); room.openingMode=mode;
    room.quick.doorCount=-1; room.openings[0].count=-1;
    r.rooms=[room]; r.surfaces=[{...wall(),roomId:room.id,measurementMode:'roomDerived',areaFt2:null}];
    const result=assembleProjectEstimate(r,priceOptions);
    console.info('V6-04 observed result',JSON.stringify({mode,count:-1,state:result.calculationState,laborCost:result.laborCost?.toString(),suggestedPrice:result.effectivePrice?.toFixed(2)}));
    expect(result.calculationState).toBe('invalid');
    expect(result.effectivePrice).toBeNull();
  });
});
