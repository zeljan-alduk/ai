'use client';

/**
 * Client-side wizard for the custom-domain settings page.
 *
 * Owns the form state for "add domain" + "verify" + "remove" so the
 * page-level server component stays a pure render.
 *
 * Verification UX:
 *   - "Verify" button calls POST /v1/domains/:hostname/verify; on
 *     422 we render the API's `reason` field inline so the user
 *     knows whether the TXT record is missing or wrong.
 *   - On success, the row flips to a green "Verified" badge with the
 *     next-step CNAME instructions.
 */

import { type DomainEntry, createDomain, deleteDomain, verifyDomain } from '@/lib/api-admin';
import { useState, useTransition } from 'react';

interface Props {
  readonly initialDomain: DomainEntry | null;
  readonly flyApiHost: string;
  readonly vercelWebHost: string;
}

export function DomainActions(props: Props) {
  const [domain, setDomain] = useState<DomainEntry | null>(props.initialDomain);
  const [hostnameInput, setHostnameInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onAdd = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await createDomain(hostnameInput.trim());
        setDomain(res.domain);
        setHostnameInput('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to add domain');
      }
    });
  };

  const onVerify = () => {
    if (domain === null) return;
    setVerifyMsg(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await verifyDomain(domain.hostname);
        if (res.verified) {
          setDomain({ ...domain, verifiedAt: res.verifiedAt });
          setVerifyMsg('Verified.');
        } else {
          setVerifyMsg(res.reason ?? 'Verification failed');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'verification failed');
      }
    });
  };

  const onRemove = () => {
    if (domain === null) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteDomain(domain.hostname);
        setDomain(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to remove');
      }
    });
  };

  if (domain === null) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Add a custom domain</h3>
          <p className="mt-1 text-sm text-slate-500">
            Enter the hostname you want to serve the API on (e.g.{' '}
            <code className="rounded bg-slate-100 px-1">agents.acme-corp.com</code>).
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              className="aldo-input flex-1"
              placeholder="agents.acme-corp.com"
              value={hostnameInput}
              onChange={(e) => setHostnameInput(e.target.value)}
              disabled={pending}
            />
            <button
              type="button"
              className="aldo-button-primary"
              disabled={pending || hostnameInput.trim().length === 0}
              onClick={onAdd}
            >
              Add
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  const verified = domain.verifiedAt !== null;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{domain.hostname}</h3>
            <p className="mt-1 text-xs text-slate-500">
              Added {new Date(domain.createdAt).toLocaleString()}
            </p>
          </div>
          <span
            className={
              verified
                ? 'inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700'
                : 'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700'
            }
          >
            {verified ? 'Verified' : 'Pending verification'}
          </span>
        </div>

        {!verified && (
          <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium">1. Add this TXT record at your DNS provider:</p>
            <table className="mt-2 w-full text-xs">
              <tbody>
                <tr>
                  <td className="py-1 pr-4 text-slate-500">Type</td>
                  <td className="py-1 font-mono">TXT</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 text-slate-500">Name</td>
                  <td className="py-1 font-mono">{domain.txtRecordName}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 text-slate-500">Value</td>
                  <td className="py-1 font-mono">{domain.txtRecordValue}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 font-medium">2. Click Verify once the record has propagated.</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="aldo-button-primary"
                disabled={pending}
                onClick={onVerify}
              >
                Verify
              </button>
              {verifyMsg && <span className="text-sm text-slate-700">{verifyMsg}</span>}
            </div>
          </div>
        )}

        {verified && (
          <div className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-slate-700">
            <p className="font-medium">Next step: create a CNAME so traffic actually reaches us.</p>
            <table className="mt-2 w-full text-xs">
              <tbody>
                <tr>
                  <td className="py-1 pr-4 text-slate-500">For the API</td>
                  <td className="py-1 font-mono">
                    {domain.hostname} → {props.flyApiHost}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 text-slate-500">For the web app</td>
                  <td className="py-1 font-mono">
                    {domain.hostname} → {props.vercelWebHost}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500">
              SSL: <span className="font-medium">{domain.sslStatus}</span>. Fly + Vercel issue
              certificates automatically once the CNAME resolves.
            </p>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="text-sm text-red-600 hover:underline"
            disabled={pending}
            onClick={onRemove}
          >
            Remove domain
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
