import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

const ROLES = [
  {
    name: 'owner',
    summary: 'Full control of the tenant.',
    can: [
      'Everything an admin can do',
      'View the audit log',
      'Promote / demote / remove members (including other owners — except the last)',
      'Delete the tenant (future wave)',
    ],
  },
  {
    name: 'admin',
    summary: 'Manage members + API keys + the agent registry.',
    can: [
      'Everything a member can do',
      'Invite / revoke members',
      'Create / revoke API keys',
      'Register / promote agents',
    ],
    cannot: ['Read the audit log', 'Change role assignments', 'Remove other owners'],
  },
  {
    name: 'member',
    summary: 'Read + write on the runtime surfaces.',
    can: [
      'Read all surfaces (runs, agents, secrets, models, observability)',
      'Create runs',
      'Set / delete secrets',
      'Run eval suites',
    ],
    cannot: ['Manage members or API keys', 'Read the audit log', 'Change role assignments'],
  },
  {
    name: 'viewer',
    summary: 'Read-only access.',
    can: ['Read all surfaces (runs, agents, models, observability, eval results)'],
    cannot: [
      'Create runs',
      'Set / delete secrets',
      'Register / promote agents',
      'Manage members or API keys',
    ],
  },
];

export default function RolesPage() {
  return (
    <>
      <PageHeader
        title="Roles"
        description="The 4-role RBAC ladder. Roles are fixed — custom roles are out of scope. Promotion ladder: viewer → member → admin → owner."
      />
      <div className="space-y-4">
        {ROLES.map((r) => (
          <section key={r.name} className="rounded-md border border-slate-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-mono text-sm font-semibold text-slate-900">{r.name}</h3>
              <span className="text-xs text-slate-500">{r.summary}</span>
            </div>
            {r.can ? (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Can
                </div>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-slate-700">
                  {r.can.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {r.cannot ? (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Cannot
                </div>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-slate-500">
                  {r.cannot.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}
