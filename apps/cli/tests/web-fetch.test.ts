/**
 * /web URL fetch — pure helper. Mocks globalThis.fetch so the test
 * never opens a network connection.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderWebFetchBlock, webFetch, WebFetchError } from '../src/lib/web-fetch.js';

function mockFetch(opts: {
  body: string;
  contentType?: string | null;
  status?: number;
}): typeof globalThis.fetch {
  return (async () => {
    const headers = new Headers();
    if (opts.contentType !== undefined && opts.contentType !== null) {
      headers.set('content-type', opts.contentType);
    }
    return new Response(opts.body, { status: opts.status ?? 200, headers });
  }) as unknown as typeof globalThis.fetch;
}

describe('webFetch', () => {
  it('returns the decoded body when content-type is text/plain', async () => {
    const r = await webFetch('https://example.test/foo', {
      fetch: mockFetch({ body: 'hello world', contentType: 'text/plain' }),
    });
    expect(r.status).toBe(200);
    expect(r.body).toBe('hello world');
    expect(r.truncated).toBe(false);
  });

  it('strips HTML to text on text/html', async () => {
    const html = `
      <html><head><title>x</title><script>alert(1)</script></head>
      <body><h1>Hello</h1><p>World &amp; <b>bold</b>.</p></body></html>
    `;
    const r = await webFetch('https://example.test/index.html', {
      fetch: mockFetch({ body: html, contentType: 'text/html; charset=utf-8' }),
    });
    expect(r.body).not.toContain('<script>');
    expect(r.body).not.toContain('alert(1)');
    expect(r.body).toContain('Hello');
    // The stripper replaces tags with whitespace, so "World &amp; <b>bold</b>."
    // becomes "World & bold ." (with a space before the period). We
    // match the post-decode tokens individually to keep the assertion
    // robust against future whitespace tweaks.
    expect(r.body).toContain('World &');
    expect(r.body).toContain('bold');
  });

  it('truncates oversized bodies', async () => {
    const big = 'a'.repeat(300 * 1024);
    const r = await webFetch('https://example.test/big.txt', {
      maxBytes: 4096,
      fetch: mockFetch({ body: big, contentType: 'text/plain' }),
    });
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBe(4096);
    expect(r.bytes).toBe(big.length);
  });

  it('refuses non-http schemes', async () => {
    await expect(webFetch('file:///etc/passwd')).rejects.toBeInstanceOf(WebFetchError);
    await expect(webFetch('ftp://example.test/x')).rejects.toBeInstanceOf(WebFetchError);
  });

  it('refuses malformed URLs', async () => {
    await expect(webFetch('not-a-url')).rejects.toBeInstanceOf(WebFetchError);
  });

  it('renderWebFetchBlock includes URL, status, content-type, and bytes in the header', async () => {
    const r = await webFetch('https://example.test/x', {
      fetch: mockFetch({ body: 'hi', contentType: 'text/plain' }),
    });
    const block = renderWebFetchBlock(r);
    expect(block).toContain('[WEB] https://example.test/x');
    expect(block).toContain('status=200');
    expect(block).toContain('type=text/plain');
    expect(block).toContain('bytes=2');
    expect(block).toContain('```text\nhi\n```');
  });
});
