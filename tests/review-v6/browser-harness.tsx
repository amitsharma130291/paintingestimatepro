// Isolated review fixture; not imported by any production page or build entry.
// Synthetic settings only. No payment/auth modules, credentials, or fake paid flags.
import {createRoot} from 'react-dom/client';
import ProApp from '../../src/components/tools/pro/ProApp';
import {openAppDb,STORES} from '../../src/storage/db';
import {settings,variant} from '../audit/fixtures';
const db=await openAppDb();
if(!(await db.get(STORES.businessSettings,'default-settings'))) {
  await db.put(STORES.businessSettings,settings());
  await db.put(STORES.paintVariants,variant());
}
db.close();
createRoot(document.getElementById('root')!).render(<ProApp/>);
