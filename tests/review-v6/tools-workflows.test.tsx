// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';
import { settings, variant } from '../audit/fixtures';

beforeEach(async()=>{
  localStorage.clear(); sessionStorage.clear(); const db=await openAppDb();
  try { for(const store of Object.values(STORES)) await db.clear(store); await db.put(STORES.businessSettings,settings()); await db.put(STORES.paintVariants,variant()); }
  finally { db.close(); }
});
afterEach(cleanup);
async function startRoom(complete:boolean) {
  render(<ProApp/>);
  fireEvent.click(await screen.findByRole('button',{name:'+ New project'}));
  fireEvent.change(await screen.findByLabelText('Project title'),{target:{value:'Review working draft'}});
  fireEvent.click(screen.getByRole('button',{name:'+ Add room'}));
  for(const [label,value] of (complete ? [['Length (ft)','10'],['Width (ft)','10'],['Height (ft)','8']] : [['Length (ft)','10']]))
    fireEvent.change(screen.getByLabelText(label),{target:{value}});
}
describe('Independent v6 real-component workflow review',()=>{
  it.each(['unfinished room','blank prep task'])('V6-05: an %s can still be saved as a draft',async(kind)=>{
    await startRoom(kind==='blank prep task');
    if(kind==='blank prep task') {
      expect(screen.getByRole('button',{name:'Save draft'})).toBeTruthy();
      fireEvent.click(screen.getByRole('button',{name:'+ Add task'}));
    }
    const save=screen.queryByRole('button',{name:'Save draft'});
    expect(save,'CORE-028 requires saving incomplete drafts while blocking issue').not.toBeNull();
    fireEvent.click(save!);
    await waitFor(()=>expect(screen.getByText('Draft saved.')).toBeTruthy());
    const db=await openAppDb();
    try { const stored=await db.getAll(STORES.projects); expect(stored[0].revisions[0].rooms[0].lengthFt).toBe('10'); }
    finally { db.close(); }
  });
  it('V6-06: switching allowance to None ignores the now-inactive blank amount',async()=>{
    await startRoom(true);
    expect(screen.getByRole('button',{name:'Save draft'})).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Mode'),{target:{value:'flat'}});
    fireEvent.change(screen.getByLabelText('Amount ($)'),{target:{value:''}});
    fireEvent.change(screen.getByLabelText('Mode'),{target:{value:'none'}});
    expect(screen.queryByLabelText('Amount ($)')).toBeNull();
    expect(screen.queryByRole('button',{name:'Save draft'}),'An inactive allowance value must not block the whole estimate').not.toBeNull();
    expect(screen.getByText('$126.00')).toBeTruthy();
  });
});
