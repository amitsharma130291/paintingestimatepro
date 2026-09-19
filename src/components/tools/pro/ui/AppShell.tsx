import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu, X, Search, Bell, ChevronDown, Lock, Plus, Database, HelpCircle, Compass } from 'lucide-react';
import { NAV_ITEMS, NAV_LABELS, type NavKey } from './navConfig';

interface AppShellProps {
  active: NavKey | 'backup';
  onNavigate: (key: NavKey | 'backup') => void;
  onCreateEstimate: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  testMode: boolean;
  onLockBrowser?: () => void;
  children: ReactNode;
}

const PAGE_TITLE: Record<NavKey | 'backup', string> = {
  ...NAV_LABELS,
  backup: 'Backup & Data',
};

/**
 * The Pro workspace's app chrome — persistent desktop sidebar + compact top
 * bar, collapsible drawer on mobile. Pure navigation/layout: every item here
 * calls back into ProApp's existing `setTab`/action handlers, so which
 * screen renders and what it does is unchanged — only how you get there.
 */
export default function AppShell({
  active,
  onNavigate,
  onCreateEstimate,
  searchQuery,
  onSearchChange,
  testMode,
  onLockBrowser,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function navigate(key: NavKey | 'backup') {
    onNavigate(key);
    setDrawerOpen(false);
  }

  const navList = (
    <nav aria-label="Pro workspace" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.key;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => navigate(item.key)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150 ${
              isActive ? 'bg-surface-sage text-primary-dark' : 'text-ink-soft hover:bg-surface-sage/60 hover:text-ink'
            }`}
          >
            <Icon size={18} strokeWidth={2} aria-hidden="true" className={isActive ? 'text-primary-dark' : 'text-ink-soft'} />
            {item.label}
            {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );

  const bottomList = (
    <div className="flex flex-col gap-1 border-t border-line px-3 pb-3 pt-3">
      <button
        type="button"
        onClick={() => navigate('backup')}
        aria-current={active === 'backup' ? 'page' : undefined}
        className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150 ${
          active === 'backup' ? 'bg-surface-sage text-primary-dark' : 'text-ink-soft hover:bg-surface-sage/60 hover:text-ink'
        }`}
      >
        <Database size={18} strokeWidth={2} aria-hidden="true" />
        Backup & Data
      </button>
      {/* Getting started / Help Center live on marketing-styled pages
          outside this app shell (shared with logged-out visitors), so they
          open in a new tab — the workspace and its sidebar stay exactly as
          you left them instead of navigating you away from it. */}
      <a
        href="/app/welcome"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors duration-150 hover:bg-surface-sage/60 hover:text-ink"
      >
        <Compass size={18} strokeWidth={2} aria-hidden="true" />
        Getting started
      </a>
      <a
        href="/help"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors duration-150 hover:bg-surface-sage/60 hover:text-ink"
      >
        <HelpCircle size={18} strokeWidth={2} aria-hidden="true" />
        Help &amp; guide
      </a>
    </div>
  );

  return (
    <div className="flex min-h-[calc(100vh-0px)] bg-paper">
      {/* Desktop sidebar */}
      {/* sticky + self-contained h-screen so the sidebar always fits within
          one viewport (nav scrolls internally via overflow-y-auto if it
          ever overflows) instead of stretching to match the main column's
          height, which pushed the bottom links off-screen on tall pages. */}
      <aside className="sticky top-0 hidden h-screen w-[250px] shrink-0 flex-col border-r border-line bg-card lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <a href="/" className="flex items-center gap-2">
            <img src="/brand/logo-primary-512.png" alt="PaintingPricing Calculator" width={512} height={130} className="h-8 w-auto" />
          </a>
          <span className="status-pill-brass status-pill">PRO</span>
        </div>
        {navList}
        {bottomList}
        <div className="border-t border-line p-3" ref={accountRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((v) => !v)}
              aria-expanded={accountOpen}
              className="flex w-full items-center gap-3 rounded-btn px-3 py-2.5 text-left text-sm font-medium text-ink-soft transition-colors duration-150 hover:bg-surface-sage/60 hover:text-ink"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-ink">A</span>
              Account
              <ChevronDown size={16} strokeWidth={2} aria-hidden="true" className="ml-auto" />
            </button>
            {accountOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-full rounded-card border border-line bg-card p-1.5 shadow-lg">
                {testMode && (
                  <p className="px-2.5 py-1.5 text-xs text-ink-soft">Test mode is on for this browser.</p>
                )}
                {onLockBrowser ? (
                  <button
                    type="button"
                    onClick={() => {
                      onLockBrowser();
                      setAccountOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-btn px-2.5 py-2 text-left text-sm text-ink-soft hover:bg-surface-sage hover:text-ink"
                  >
                    <Lock size={16} strokeWidth={2} aria-hidden="true" />
                    Lock this browser
                  </button>
                ) : (
                  <p className="px-2.5 py-1.5 text-xs text-ink-soft">No account needed — Pro unlocks per browser.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card shadow-lg">
            <div className="flex items-center justify-between gap-2 px-4 py-4">
              <div className="flex items-center gap-2">
                <a href="/" className="flex items-center gap-2">
                  <img src="/brand/logo-primary-512.png" alt="PaintingPricing Calculator" width={512} height={130} className="h-7 w-auto" />
                </a>
                <span className="status-pill-brass status-pill">PRO</span>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="rounded-btn p-2 text-ink-soft hover:bg-surface-sage">
                <X size={20} strokeWidth={2} />
              </button>
            </div>
            {navList}
            {bottomList}
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="rounded-btn p-2 text-ink-soft hover:bg-surface-sage lg:hidden"
          >
            <Menu size={20} strokeWidth={2} />
          </button>
          <h1 className="text-base font-semibold tracking-tight text-ink sm:text-lg">{PAGE_TITLE[active]}</h1>
          {testMode && <span className="status-pill status-pill-warn hidden sm:inline-flex">Test mode</span>}

          <div className="ml-auto flex items-center gap-2">
            <div className="relative hidden md:block">
              <Search size={16} strokeWidth={2} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search projects and estimates"
                aria-label="Search projects and estimates"
                className="w-64 rounded-btn border border-line bg-card py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-soft focus-visible:border-primary"
              />
            </div>
            <a
              href="/help"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Help & guide (opens in a new tab)"
              className="rounded-btn p-2 text-ink-soft hover:bg-surface-sage"
              title="Help & guide"
            >
              <HelpCircle size={18} strokeWidth={2} />
            </a>
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                aria-expanded={notifOpen}
                aria-label="Notifications"
                className="rounded-btn p-2 text-ink-soft hover:bg-surface-sage"
              >
                <Bell size={18} strokeWidth={2} />
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-card border border-line bg-card p-4 text-sm text-ink-soft shadow-lg">
                  You're all caught up — no new notifications.
                </div>
              )}
            </div>
            <button type="button" onClick={onCreateEstimate} className="btn btn-primary btn-sm">
              <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
              <span className="hidden sm:inline">Create estimate</span>
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
