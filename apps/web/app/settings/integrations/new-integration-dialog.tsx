'use client';

/**
 * Wave-14C — "New integration" dialog.
 *
 * Owners + admins only. Picks a kind, fills in per-kind config, picks
 * the event subscription list, and submits. On success we refresh the
 * server component via `router.refresh()` so the table picks up the
 * new row without a full page reload.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createIntegration } from '@/lib/api-admin';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const KINDS = [
  { value: 'slack', label: 'Slack' },
  { value: 'github', label: 'GitHub' },
  { value: 'discord', label: 'Discord' },
  { value: 'webhook', label: 'Webhook' },
] as const;

const ALL_EVENTS = [
  { value: 'run_completed', label: 'Run completed' },
  { value: 'run_failed', label: 'Run failed' },
  { value: 'sweep_completed', label: 'Sweep completed' },
  { value: 'guards_blocked', label: 'Guards blocked' },
  { value: 'budget_threshold', label: 'Budget threshold' },
  { value: 'invitation_received', label: 'Invitation received' },
] as const;

type Kind = (typeof KINDS)[number]['value'];
type EventName = (typeof ALL_EVENTS)[number]['value'];

export function NewIntegrationDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('webhook');
  const [name, setName] = useState('');
  // Per-kind fields stored as a flat record so the form can stay
  // ergonomic; we serialise the relevant subset into the `config`
  // payload at submit time.
  const [slackUrl, setSlackUrl] = useState('');
  const [discordUrl, setDiscordUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [githubIssue, setGithubIssue] = useState('');
  const [events, setEvents] = useState<Set<EventName>>(new Set(['run_failed']));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setKind('webhook');
    setName('');
    setSlackUrl('');
    setDiscordUrl('');
    setWebhookUrl('');
    setSigningSecret('');
    setGithubRepo('');
    setGithubToken('');
    setGithubIssue('');
    setEvents(new Set(['run_failed']));
    setError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let config: Record<string, unknown>;
      switch (kind) {
        case 'slack':
          config = { webhookUrl: slackUrl };
          break;
        case 'discord':
          config = { webhookUrl: discordUrl };
          break;
        case 'webhook':
          config = { url: webhookUrl, signingSecret };
          break;
        case 'github':
          config = {
            repo: githubRepo,
            token: githubToken,
            issueNumber: Number.parseInt(githubIssue, 10) || 0,
          };
          break;
      }
      await createIntegration({
        kind,
        name: name.trim(),
        config,
        events: Array.from(events),
        enabled: true,
      });
      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create integration');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New integration</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New integration</DialogTitle>
          <DialogDescription>
            Forward platform events to a chat workspace, repository, or generic webhook. Use the
            "Test" button after creating to verify delivery.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <label htmlFor="int-kind" className="block text-xs font-medium text-slate-700">
              Kind
            </label>
            <select
              id="int-kind"
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="int-name" className="block text-xs font-medium text-slate-700">
              Name
            </label>
            <Input
              id="int-name"
              className="mt-1"
              placeholder="e.g. #ops alerts"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {kind === 'slack' && (
            <div>
              <label htmlFor="int-slack" className="block text-xs font-medium text-slate-700">
                Slack incoming webhook URL (must be on hooks.slack.com)
              </label>
              <Input
                id="int-slack"
                className="mt-1"
                placeholder="https://hooks.slack.com/services/T.../B.../..."
                value={slackUrl}
                onChange={(e) => setSlackUrl(e.target.value)}
              />
            </div>
          )}
          {kind === 'discord' && (
            <div>
              <label htmlFor="int-discord" className="block text-xs font-medium text-slate-700">
                Discord webhook URL
              </label>
              <Input
                id="int-discord"
                className="mt-1"
                placeholder="https://discord.com/api/webhooks/..."
                value={discordUrl}
                onChange={(e) => setDiscordUrl(e.target.value)}
              />
            </div>
          )}
          {kind === 'webhook' && (
            <>
              <div>
                <label htmlFor="int-wh-url" className="block text-xs font-medium text-slate-700">
                  Webhook URL
                </label>
                <Input
                  id="int-wh-url"
                  className="mt-1"
                  placeholder="https://your-receiver.example.com/aldo"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="int-wh-secret" className="block text-xs font-medium text-slate-700">
                  HMAC signing secret (8+ chars)
                </label>
                <Input
                  id="int-wh-secret"
                  className="mt-1"
                  type="password"
                  placeholder="long-random-string"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                />
                <span className="mt-1 block text-[11px] font-normal text-slate-500">
                  Verify on your end via{' '}
                  <code className="font-mono">X-Aldo-Signature: sha256=&lt;hex&gt;</code>.
                </span>
              </div>
            </>
          )}
          {kind === 'github' && (
            <>
              <div>
                <label htmlFor="int-gh-repo" className="block text-xs font-medium text-slate-700">
                  Repository (owner/repo)
                </label>
                <Input
                  id="int-gh-repo"
                  className="mt-1"
                  placeholder="aldo-tech-labs/aldo"
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="int-gh-token" className="block text-xs font-medium text-slate-700">
                  Personal access token
                </label>
                <Input
                  id="int-gh-token"
                  className="mt-1"
                  type="password"
                  placeholder="ghp_..."
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                />
                <span className="mt-1 block text-[11px] font-normal text-slate-500">
                  Stored encrypted at rest. Needs <code className="font-mono">issues:write</code>{' '}
                  scope.
                </span>
              </div>
              <div>
                <label htmlFor="int-gh-issue" className="block text-xs font-medium text-slate-700">
                  Issue / PR number
                </label>
                <Input
                  id="int-gh-issue"
                  className="mt-1"
                  placeholder="42"
                  value={githubIssue}
                  onChange={(e) => setGithubIssue(e.target.value)}
                />
              </div>
            </>
          )}
          <fieldset className="rounded border border-slate-200 p-3">
            <legend className="px-1 text-xs font-medium text-slate-700">Events</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {ALL_EVENTS.map((e) => (
                <label key={e.value} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={events.has(e.value)}
                    onChange={(ev) => {
                      const next = new Set(events);
                      if (ev.target.checked) next.add(e.value);
                      else next.delete(e.value);
                      setEvents(next);
                    }}
                  />
                  {e.label}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || name.trim().length === 0 || events.size === 0}
          >
            {submitting ? 'Creating…' : 'Create integration'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
