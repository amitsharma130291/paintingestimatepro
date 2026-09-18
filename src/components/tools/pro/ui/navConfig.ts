import {
  LayoutDashboard, FolderKanban, Paintbrush, Activity, Receipt, Settings as SettingsIcon,
  Database, HelpCircle, Compass, type LucideIcon,
} from 'lucide-react';

export type NavKey = 'overview' | 'projects' | 'catalog' | 'health' | 'actuals' | 'settings';

export interface NavItem {
  key: NavKey;
  label: string;
  icon: LucideIcon;
}

/** Primary sidebar navigation, top to bottom — the same six existing
 * workspace sections plus the new Overview landing screen. Order and
 * copy match the redesign spec; each key maps 1:1 to an existing `Tab`
 * value in ProApp.tsx (nothing here changes what a tab shows or does). */
export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'projects', label: 'Projects', icon: FolderKanban },
  { key: 'catalog', label: 'Paint & Materials', icon: Paintbrush },
  { key: 'health', label: 'Price Book Health', icon: Activity },
  { key: 'actuals', label: 'Actual Costs', icon: Receipt },
  { key: 'settings', label: 'Business Settings', icon: SettingsIcon },
];

export const NAV_LABELS: Record<NavKey, string> = NAV_ITEMS.reduce(
  (acc, item) => ({ ...acc, [item.key]: item.label }),
  {} as Record<NavKey, string>,
);

export const BACKUP_ICON: LucideIcon = Database;
export const HELP_ICON: LucideIcon = HelpCircle;
export const GETTING_STARTED_ICON: LucideIcon = Compass;
