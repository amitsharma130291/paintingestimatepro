// @vitest-environment jsdom
// Independent tools-only workflow regressions, asserting approved behavior.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import InteriorCalculator from '../../src/components/tools/InteriorCalculator';
import { settings, variant, project } from '../audit/fixtures';
import { openAppDb, STORES, writeProjectWithVersionCheck } from '../../src/storage/db';
import { buildProjectFromInteriorHandoff, readInteriorHandoff } from '../../src/domain/interiorHandoff';
import { createSnapshot } from '../../src/domain/snapshot';
import { sequentialIdSource } from '../../src/domain/ids';
import type { Surface } from '../../src/domain/entities';

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  const db=await openAppDb();
  try {
    for(const store of Object.values(STORES)) await db.clear(store);
    await db.put(STORES.businessSettings,settings());
    await db.put(STORES.paintVariants,variant());
  } finally { db.close(); }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Independent v5 tools workflows', () => {
  it('V5-08: pre-refresh recovery is still available after saving and reopening', async () => {
    const p=project();
    const wall:Surface={id:'wall1',roomId:null,kind:'wall',enabled:true,measurementMode:'manual',areaFt2:'400',trimLengthFt:null,developedWidthFt:null,doorCount:null,widthFt:null,heightFt:null,paintedSides:null,paintVariantId:'paint-1',coats:2,wasteRatio:'0.1',loadedHourlyRate:null,throughput:null,hoursPerSidePerCoat:null};
    p.revisions[0].title='Audit project';p.revisions[0].surfaces=[wall];
    const db=await openAppDb();
    try { await writeProjectWithVersionCheck(db,p,null); } finally { db.close(); }
    const first=render(<ProApp />);
    await waitFor(()=>expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'Projects'}));
    fireEvent.click(await screen.findByRole('button',{name:/^Audit project/}));
    expect(await screen.findByText('$126.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Paint & Materials'}));
    fireEvent.change(screen.getByLabelText('Price/gal ($)'),{target:{value:'49'}});
    fireEvent.click(screen.getByRole('button',{name:'Projects'}));
    fireEvent.click(screen.getByRole('button',{name:'Check for rate updates'}));
    fireEvent.click(await screen.findByRole('button',{name:'Confirm refresh'}));
    expect(await screen.findByText('$147.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
    await screen.findByText('Draft saved.');
    first.unmount();
    render(<ProApp />);
    await waitFor(()=>expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'Projects'}));
    fireEvent.click(await screen.findByRole('button',{name:/^Audit project/}));
    expect(screen.queryByRole('button',{name:/undo refresh|recover.*refresh|restore.*refresh/i})).not.toBeNull();
  });

  it('V5-09: free-calculator prep hours are transferred to Pro or explicitly listed as omitted', () => {
    vi.spyOn(window,'open').mockImplementation(()=>null);
    render(<InteriorCalculator />);
    fireEvent.click(screen.getByRole('button',{name:/Load sample data/}));
    fireEvent.click(screen.getByRole('checkbox',{name:'Estimate labor'}));
    fireEvent.change(screen.getByLabelText('Prep/cleanup hours'),{target:{value:'3'}});
    fireEvent.click(screen.getByRole('button',{name:/Continue this room in Pro/}));
    const payload=readInteriorHandoff();
    expect(payload).not.toBeNull();
    const ids=sequentialIdSource();
    const imported=buildProjectFromInteriorHandoff(payload!,createSnapshot(settings(),[variant()],[],ids,'live'),ids);
    const preserved=imported.revision.additionalLabor.some(line=>line.hours==='3');
    const disclosed=imported.unsupportedFieldNotes.some(n=>/prep|cleanup/i.test(n.field+' '+n.note));
    expect(preserved||disclosed).toBe(true);
  });

  it('V5-10: a new trim service requires an explicit developed width instead of inventing 4 feet', async () => {
    render(<ProApp />);
    await waitFor(()=>expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'Price Book Health'}));
    fireEvent.click(screen.getByRole('button',{name:'+ trim service'}));
    const width=await screen.findByLabelText(/Developed width/);
    expect((width as HTMLInputElement).value).toBe('');
  });

  it('V5-11: baseline overhead with more than ten fractional digits remains confirmable', async () => {
    const db=await openAppDb();
    try { await db.put(STORES.businessSettings,{...settings(),wallThroughput:'137'}); } finally { db.close(); }
    render(<ProApp />);
    await waitFor(()=>expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'+ New project'}));
    fireEvent.change(await screen.findByLabelText('Project title'),{target:{value:'137 throughput job'}});
    fireEvent.click(screen.getByRole('button',{name:'+ Add room'}));
    for(const [label,value] of [['Length (ft)','10'],['Width (ft)','10'],['Height (ft)','8']]) fireEvent.change(screen.getByLabelText(label),{target:{value}});
    fireEvent.click(screen.getByRole('button',{name:'Issue estimate'}));
    await screen.findByText('Estimate issued and saved.');
    fireEvent.click(screen.getByRole('button',{name:'Actual Costs'}));
    expect(screen.getByRole('radio',{name:/baseline allocation/i})).toHaveProperty('checked',true);
    fireEvent.click(screen.getByRole('checkbox',{name:'overhead'}));
    expect(screen.getByRole('button',{name:'Save actuals'})).toHaveProperty('disabled',false);
  });
});
