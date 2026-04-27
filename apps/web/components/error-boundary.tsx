import { ApiClientError } from '@/lib/api';

/**
 * Server-rendered error UI. We never show a stack trace; only the
 * shape of the failure (status, code) and the human message that the
 * server already produced.
 */
export function ErrorView({ error, context }: { error: unknown; context: string }) {
  let title = 'Something went wrong';
  let message = 'The control-plane API returned an unexpected response.';
  let detail: string | undefined;

  if (error instanceof ApiClientError) {
    if (error.kind === 'network') {
      title = 'Cannot reach the control-plane API';
      message =
        'The web app could not connect to the API. Check that apps/api is running and NEXT_PUBLIC_API_BASE points at it.';
    } else if (error.kind === 'http_5xx') {
      title = `Server error while loading ${context}`;
      message = error.message;
      detail = error.code ? `code: ${error.code}` : undefined;
    } else if (error.kind === 'http_4xx') {
      title = `Request rejected while loading ${context}`;
      message = error.message;
      detail = error.code ? `code: ${error.code}` : undefined;
    } else if (error.kind === 'parse' || error.kind === 'envelope') {
      title = `Unexpected response shape for ${context}`;
      message =
        'The API response did not match the api-contract schema. The contract and the server may be out of sync.';
    }
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-semibold text-red-800">{title}</p>
      <p className="mt-1 text-sm text-red-700">{message}</p>
      {detail ? <p className="mt-2 text-xs text-red-600">{detail}</p> : null}
    </div>
  );
}
