'use server';

/**
 * Server actions backing the admin review surface for the
 * design-partner program.
 *
 * Single action: `updateDesignPartnerApplicationAction` — invoked by
 * the inline editor inside `<ApplicationCard />`. Takes raw
 * `FormData`, builds the typed PATCH body, calls the API, and
 * `revalidatePath`s the list so the next navigation re-fetches.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import '@/lib/api-server-init';

import { ApiClientError, updateDesignPartnerApplication } from '@/lib/api';
import {
  DESIGN_PARTNER_STATUSES,
  type UpdateDesignPartnerApplicationRequest,
} from '@aldo-ai/api-contract';
import { revalidatePath } from 'next/cache';

export interface UpdateApplicationFormState {
  readonly error: string | null;
  /**
   * Stamp incremented on each successful save so the client island
   * can show a transient "saved" toast even when the underlying row
   * data didn't change. (`useFormState` re-renders only when the
   * returned object's identity changes.)
   */
  readonly savedAt: string | null;
}

export const EMPTY_UPDATE_STATE: UpdateApplicationFormState = {
  error: null,
  savedAt: null,
};

function strField(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

export async function updateDesignPartnerApplicationAction(
  _prev: UpdateApplicationFormState,
  form: FormData,
): Promise<UpdateApplicationFormState> {
  const id = strField(form, 'id');
  if (id.length === 0) {
    return { error: 'Missing application id.', savedAt: null };
  }

  const status = strField(form, 'status');
  const adminNotes = strField(form, 'adminNotes');

  const body: UpdateDesignPartnerApplicationRequest = {};
  if ((DESIGN_PARTNER_STATUSES as readonly string[]).includes(status)) {
    body.status = status as UpdateDesignPartnerApplicationRequest['status'];
  }
  // Always include adminNotes when the form sends it — the empty
  // string is a legitimate "clear the notes" intent. We only skip
  // when the field wasn't in the form at all (FormData.get returns
  // null for absent fields, which `strField` collapses to '').
  if (form.has('adminNotes')) {
    body.adminNotes = adminNotes;
  }

  if (body.status === undefined && body.adminNotes === undefined) {
    return { error: 'No changes to save.', savedAt: null };
  }

  try {
    await updateDesignPartnerApplication(id, body);
  } catch (err) {
    if (err instanceof ApiClientError) {
      if (err.status === 403) {
        return { error: 'You no longer have admin access for this surface.', savedAt: null };
      }
      if (err.status === 404) {
        return { error: 'Application not found — it may have been deleted.', savedAt: null };
      }
      return { error: err.message, savedAt: null };
    }
    return { error: 'Save failed. Please try again.', savedAt: null };
  }

  revalidatePath('/admin/design-partners');
  return { error: null, savedAt: new Date().toISOString() };
}
