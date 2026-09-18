import { useMemo } from 'react';
import { FolderKanban, FileText, DollarSign, TrendingUp, Activity } from 'lucide-react';
import { PEP, toMoneyString, toPercentString } from '../../../../engine/decimal';
import { assembleServiceHealth } from '../../../../domain/serviceHealthAssembly';
import type { Project, ServiceDefinition, PaintVariant, BusinessSettings } from '../../../../domain/entities';
import Card from './Card';
import Button from './Button';
import Badge from './Badge';
import MetricCard from './MetricCard';
import EmptyState from './EmptyState';

interface OverviewPanelProps {
  projects: Project[];
  serviceDefinitions: ServiceDefinition[];
  catalog: PaintVariant[];
  settings: BusinessSettings;
  searchQuery: string;
  onCreateEstimate: () => void;
  onOpenProject: (projectId: string) => void;
  onGoTo: (tab: 'catalog' | 'settings' | 'health' | 'backup' | 'projects') => void;
}

const STATE_LABEL: Record<string, string> = { draft: 'Draft', issued: 'Issued', superseded: 'Superseded' };
const STATE_BADGE: Record<string, 'neutral' | 'primary' | 'warn'> = { draft: 'neutral', issued: 'primary', superseded: 'warn' };

const GETTING_STARTED_STEPS: { title: string; body: string; goTo?: 'catalog' | 'settings' }[] = [
  { title: 'Add your paint products', body: 'Open Paint & Materials and add each paint you actually buy — name, price per gallon, coverage, and sheen.', goTo: 'catalog' },
  { title: 'Check your business settings', body: 'Business Settings holds your loaded hourly rate, overhead, target margin, and production throughputs.', goTo: 'settings' },
  { title: 'Create your first project', body: 'Add each room (length, width, height, doors/windows) or a standalone trim/door surface — the estimate summary fills in live.' },
  { title: 'Review the estimate summary', body: 'Materials, labor, overhead, job cost, and a suggested price with your target margin — switch to a custom price any time.' },
  { title: 'Issue it to your customer', body: 'Freezes this revision and produces a clean customer-facing document, ready to print or save as a PDF.' },
];

function activeRevisionOf(p: Project) {
  return p.revisions.find((r) => r.id === p.activeRevisionId) ?? p.revisions[p.revisions.length - 1];
}

/**
 * The Overview dashboard. Every number here is derived by reading fields
 * ProApp's existing save/issue flow already computes and stores —
 * `revision.proposedPrice` (set on every save, see saveDraft/issueEstimate)
 * and `revision.rawCalculatedOutputs.marginRatio` (frozen once, at issue,
 * by domain/calculationSnapshot.ts's freezeCalculatedOutputs). Nothing here
 * recalculates a price or margin; it only reads and formats what's already
 * on disk, the same way the customer document and Price Book Health tab do.
 */
export default function OverviewPanel({ projects, serviceDefinitions, catalog, settings, searchQuery, onCreateEstimate, onOpenProject, onGoTo }: OverviewPanelProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
    let estimatesThisMonth = 0;
    let revenue = new PEP(0);
    let marginSum = new PEP(0);
    let marginCount = 0;

    const rows = projects
      .map((p) => {
        const rev = activeRevisionOf(p);
        const createdMonth = new Date(rev.createdAt);
        if (createdMonth.getUTCFullYear() * 12 + createdMonth.getUTCMonth() === thisMonth) estimatesThisMonth += 1;

        let marginLabel = '—';
        if (rev.state === 'issued' && rev.rawCalculatedOutputs) {
          const raw = rev.rawCalculatedOutputs as Record<string, unknown>;
          if (typeof raw.marginRatio === 'string') {
            const m = new PEP(raw.marginRatio);
            marginSum = marginSum.plus(m);
            marginCount += 1;
            marginLabel = `${toPercentString(m)}%`;
          }
          if (typeof rev.proposedPrice === 'string' && rev.proposedPrice.trim() !== '') {
            revenue = revenue.plus(new PEP(rev.proposedPrice));
          }
        }

        return {
          id: p.id,
          title: p.title,
          state: rev.state,
          value: rev.proposedPrice ? `$${toMoneyString(new PEP(rev.proposedPrice))}` : '—',
          margin: marginLabel,
          updated: rev.updatedAt,
        };
      })
      .sort((a, b) => (a.updated < b.updated ? 1 : -1));

    const healthResults = serviceDefinitions.map((s) => assembleServiceHealth(s, catalog, settings));
    const priced = healthResults.filter((r) => r.state === 'ok' && r.row.price && r.row.price.status !== 'unpriced');
    const atOrAboveTarget = priced.filter((r) => r.state === 'ok' && (r.row.price!.status === 'at_target' || r.row.price!.status === 'above_target'));
    const healthScore = priced.length > 0 ? Math.round((atOrAboveTarget.length / priced.length) * 100) : null;

    return {
      activeCount: projects.length,
      estimatesThisMonth,
      revenue,
      avgMargin: marginCount > 0 ? marginSum.dividedBy(marginCount) : null,
      rows,
      healthScore,
      pricedCount: priced.length,
      totalServices: serviceDefinitions.length,
    };
  }, [projects, serviceDefinitions, catalog, settings]);

  const isEmpty = projects.length === 0;
  const filteredRows = stats.rows.filter((r) => r.title.toLowerCase().includes(searchQuery.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Good morning</h2>
          <p className="mt-1 text-sm text-ink-soft">Here's how your estimating business is performing.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => onGoTo('projects')}>Add project</Button>
          <Button variant="primary" onClick={onCreateEstimate} disabled={catalog.length === 0}>Create estimate</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Active projects" value={String(stats.activeCount)} icon={<FolderKanban size={16} strokeWidth={2} />} />
        <MetricCard label="Estimates this month" value={String(stats.estimatesThisMonth)} icon={<FileText size={16} strokeWidth={2} />} />
        <MetricCard
          label="Estimated revenue"
          value={stats.revenue.isZero() ? '—' : `$${toMoneyString(stats.revenue)}`}
          detail="From issued estimates"
          icon={<DollarSign size={16} strokeWidth={2} />}
        />
        <MetricCard
          label="Average gross margin"
          value={stats.avgMargin ? `${toPercentString(stats.avgMargin)}%` : '—'}
          detail={stats.avgMargin ? 'Across issued estimates' : 'Issue an estimate to see this'}
          icon={<TrendingUp size={16} strokeWidth={2} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card padding={isEmpty ? 'lg' : 'none'} className="overflow-hidden lg:col-span-2">
          {isEmpty ? (
            <EmptyState
              heading="Create your first profitable project"
              description="Set up a project once and PaintingPricing Calculator handles the math — materials, labor, overhead, and a price that protects your margin."
              primaryAction={<Button variant="primary" disabled={catalog.length === 0} onClick={onCreateEstimate}>Create first project</Button>}
              secondaryAction={<a href="/app/welcome" target="_blank" rel="noopener noreferrer" className="text-link text-sm">Explore a sample project</a>}
              steps={[{ label: 'Add project details' }, { label: 'Build the estimate' }, { label: 'Review profit' }]}
            />
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <h3 className="text-base font-semibold tracking-tight text-ink">Recent projects</h3>
                <button type="button" onClick={() => onGoTo('projects')} className="text-link text-xs">
                  View all
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-ink-soft">
                      <th className="px-5 py-2 font-medium">Project</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                      <th className="px-5 py-2 font-medium">Estimate</th>
                      <th className="px-5 py-2 font-medium">Margin</th>
                      <th className="px-5 py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 6).map((row) => (
                      <tr key={row.id} className="border-t border-line-soft hover:bg-surface-sage/40">
                        <td className="px-5 py-3">
                          <button type="button" onClick={() => onOpenProject(row.id)} className="font-medium text-ink hover:text-primary-dark">
                            {row.title}
                          </button>
                        </td>
                        <td className="px-5 py-3">
                          <Badge variant={STATE_BADGE[row.state]}>{STATE_LABEL[row.state] ?? row.state}</Badge>
                        </td>
                        <td className="px-5 py-3 tabular-nums">{row.value}</td>
                        <td className="px-5 py-3 tabular-nums">{row.margin}</td>
                        <td className="px-5 py-3 text-ink-soft">{new Date(row.updated).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        <Card padding="md" className="flex flex-col gap-3">
          <h3 className="text-base font-semibold tracking-tight text-ink">Quick actions</h3>
          <button type="button" onClick={onCreateEstimate} className="text-left text-sm font-medium text-primary-dark hover:underline">
            Start a new estimate
          </button>
          <button type="button" onClick={() => onGoTo('catalog')} className="text-left text-sm font-medium text-primary-dark hover:underline">
            Add a paint product
          </button>
          <button type="button" onClick={() => onGoTo('settings')} className="text-left text-sm font-medium text-primary-dark hover:underline">
            Update labor rates
          </button>
          <button type="button" onClick={() => onGoTo('backup')} className="text-left text-sm font-medium text-primary-dark hover:underline">
            Import data
          </button>
          <button type="button" onClick={() => onGoTo('health')} className="text-left text-sm font-medium text-primary-dark hover:underline">
            Review price book
          </button>
        </Card>
      </div>

      <Card padding="md" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-surface-sage text-lg font-semibold text-primary-dark">
            {stats.healthScore ?? '—'}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <Activity size={16} strokeWidth={2} className="text-primary-dark" />
              <h3 className="text-base font-semibold tracking-tight text-ink">Price Book Health</h3>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {stats.pricedCount > 0
                ? `${stats.pricedCount} of ${stats.totalServices} priced services are at or above your target margin.`
                : 'Add pricing to your services to see a health score.'}
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => onGoTo('health')}>
          Review recommendation
        </Button>
      </Card>

      {isEmpty && (
        <Card padding="lg">
          <h3 className="text-lg font-semibold tracking-tight text-ink">How to get started</h3>
          <p className="mt-1 text-sm text-ink-soft">Five steps from an empty workspace to your first issued estimate.</p>
          <ol className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {GETTING_STARTED_STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-2 rounded-btn border border-line p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-ink">{i + 1}</span>
                {step.goTo ? (
                  <button type="button" onClick={() => onGoTo(step.goTo!)} className="text-left text-sm font-semibold text-primary-dark hover:underline">
                    {step.title}
                  </button>
                ) : (
                  <p className="text-sm font-semibold text-ink">{step.title}</p>
                )}
                <p className="text-xs leading-relaxed text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
