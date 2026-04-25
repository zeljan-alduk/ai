// Tool that sleeps forever. Used to test cancel + timeout. We hold an
// interval to keep the event loop alive — `new Promise(() => {})` alone
// lets Node detect no work and exit.
export async function run() {
  const ticker = setInterval(() => {
    /* keep alive */
  }, 1_000);
  try {
    await new Promise(() => {
      /* never */
    });
  } finally {
    clearInterval(ticker);
  }
  return null;
}
