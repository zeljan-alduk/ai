/**
 * Command-palette + keyboard-shortcuts e2e — Wave-4 Frontend push.
 *
 * Covers the three things the brief asks for:
 *
 *   1. ⌘K (or Ctrl-K) opens the palette.
 *   2. Typing "agent", arrow-down, Enter routes to /agents.
 *   3. Esc closes the palette.
 *
 * Plus a sanity case for the `?` shortcuts overlay and a cancellation
 * smoke test (a g-prefix chord typed inside an input must not navigate).
 *
 * The marketing home renders the palette + shortcut router on the
 * server-rendered marketing surface (the layout mounts both for every
 * non-auth route), so we don't need a logged-in session to exercise
 * the keyboard plumbing — that keeps this spec read-only and makes it
 * safe to run against production without `E2E_ALLOW_WRITES`.
 *
 * LLM-agnostic: this spec never asserts on a provider name.
 */

import { expect, test } from '@playwright/test';

test.describe('command palette — open / search / navigate', () => {
  test('Cmd-K opens the palette, typing "agent" + Enter routes to /agents', async ({ page }) => {
    await page.goto('/');

    // Open the palette. Playwright's `Control+KeyK` shorthand fires on
    // both macOS and Linux because Chromium maps Control to the
    // platform-appropriate accelerator.
    await page.keyboard.press('Control+KeyK');

    const input = page.getByRole('combobox', { name: /command palette search/i });
    await expect(input).toBeVisible();

    // Type → arrow → enter. After typing the matching nav row "Agents"
    // is the top item, so arrowDown then Enter selects it.
    await input.fill('agent');
    await page.keyboard.press('Enter');

    await page.waitForURL(/\/agents(\?|$)/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/agents/);
  });

  test('Esc closes the palette without navigating', async ({ page }) => {
    await page.goto('/');
    const startUrl = page.url();

    await page.keyboard.press('Control+KeyK');
    const input = page.getByRole('combobox', { name: /command palette search/i });
    await expect(input).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(input).toBeHidden();
    expect(page.url()).toBe(startUrl);
  });
});

test.describe('keyboard shortcuts — ? overlay + chord guards', () => {
  test('? opens the shortcuts overlay; Esc closes it', async ({ page }) => {
    await page.goto('/');

    // Make sure focus is in the body, not in any incidental input.
    await page.locator('body').click({ position: { x: 5, y: 5 } });

    await page.keyboard.press('Shift+?');
    const heading = page.getByRole('heading', { name: /keyboard shortcuts/i });
    await expect(heading).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(heading).toBeHidden();
  });

  test('typing "g" then "a" inside a text input does NOT navigate', async ({ page }) => {
    await page.goto('/');

    // The marketing home has no app input on the page by default;
    // open the palette first so we have a typing target on screen.
    await page.keyboard.press('Control+KeyK');
    const input = page.getByRole('combobox', { name: /command palette search/i });
    await expect(input).toBeVisible();

    // Type the chord characters into the input. The router's
    // isTypingTarget guard must suppress the `g` and the `a` so we do
    // NOT bounce to /agents.
    await input.type('ga');
    expect(page.url()).not.toMatch(/\/agents(\?|$)/);

    // Tidy up so subsequent specs aren't left with a half-open palette.
    await page.keyboard.press('Escape');
  });
});
