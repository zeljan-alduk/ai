/**
 * MISSING_PIECES §11 / Phase B — ink mount shim.
 *
 * Kept in its own .tsx so the JSX/React import only loads when
 * `aldo code --tui` is actually invoked. Headless callers never pay
 * for the React + ink graph.
 */

import { render } from 'ink';
import React from 'react';
import { App, type AppProps } from './app.js';

export async function mountTui(props: AppProps): Promise<void> {
  const { waitUntilExit } = render(<App {...props} />);
  await waitUntilExit();
}
