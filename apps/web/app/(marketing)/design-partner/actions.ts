'use server';

/**
 * Server action backing the `/design-partner` application form.
 *
 * The form posts plain `FormData` from the client island; this action
 * parses it through the shared Zod schema and forwards a JSON POST to
 * the public `/v1/design-partners/apply` endpoint. No bearer token
 * required (the route is in the API's public allow-list — applicants
 * haven't signed up yet).
 *
 * Why a server action instead of a direct browser fetch?
 *
 *   - We keep the API base URL on the server (`API_BASE`); browsers
 *     never need to know it.
 *   - Validation runs through the same Zod schema we use server-side,
 *     so a typo in the regex can't drift between client and server.
 *   - We can stuff structured field-level errors into `FormState` so
 *     the form can highlight the failing input.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { API_BASE } from '@/lib/api';
import {
  DESIGN_PARTNER_ROLES,
  DESIGN_PARTNER_TEAM_SIZES,
  DesignPartnerApplyRequest,
  DesignPartnerApplyResponse,
} from '@aldo-ai/api-contract';

// DesignPartnerFormState + EMPTY_DESIGN_PARTNER_STATE moved to ./state —
// non-async exports from a `'use server'` file collapse to `undefined`
// in client-component import sites and break `useActionState`.
import type { DesignPartnerFormState } from './state';

function strField(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
}

function optStrField(form: FormData, name: string): string | undefined {
  const v = strField(form, name);
  return v === '' ? undefined : v;
}

export async function applyForDesignPartnerAction(
  _prev: DesignPartnerFormState,
  form: FormData,
): Promise<DesignPartnerFormState> {
  // Build the request shape from the form, normalising empty strings
  // to `undefined` so the optional Zod fields accept them.
  const role = optStrField(form, 'role');
  const teamSize = optStrField(form, 'teamSize');
  const candidate = {
    name: strField(form, 'name'),
    email: strField(form, 'email'),
    company: optStrField(form, 'company'),
    role:
      role !== undefined && (DESIGN_PARTNER_ROLES as readonly string[]).includes(role)
        ? role
        : undefined,
    repoUrl: optStrField(form, 'repoUrl'),
    useCase: strField(form, 'useCase'),
    teamSize:
      teamSize !== undefined && (DESIGN_PARTNER_TEAM_SIZES as readonly string[]).includes(teamSize)
        ? teamSize
        : undefined,
  };

  const parsed = DesignPartnerApplyRequest.safeParse(candidate);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      error: 'Please fix the errors below.',
      fieldErrors,
      successId: null,
    };
  }

  let res: Response;
  try {
    res = await fetch(new URL('/v1/design-partners/apply', API_BASE), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
  } catch {
    return {
      error: 'Could not reach our servers. Please try again in a moment, or email info@aldo.tech.',
      fieldErrors: {},
      successId: null,
    };
  }

  if (res.status === 429) {
    return {
      error:
        'We have rate-limited submissions from your network. Try again in an hour, or email info@aldo.tech.',
      fieldErrors: {},
      successId: null,
    };
  }
  if (!res.ok) {
    return {
      error: `The application could not be submitted (HTTP ${res.status}).`,
      fieldErrors: {},
      successId: null,
    };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      error: 'The server response was malformed. Please try again.',
      fieldErrors: {},
      successId: null,
    };
  }
  const body = DesignPartnerApplyResponse.safeParse(json);
  if (!body.success) {
    return {
      error: 'The server response was malformed. Please try again.',
      fieldErrors: {},
      successId: null,
    };
  }
  return { error: null, fieldErrors: {}, successId: body.data.id };
}
