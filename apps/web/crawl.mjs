import { chromium } from 'playwright';

const URL = 'https://ai.aldo.tech';
const API = 'https://ai.aldo.tech';
const EMAIL = process.env.EMAIL ?? 'admin@aldo.tech';
const PASS = process.env.PASS;

if (!PASS) {
  console.error('PASS env required');
  process.exit(1);
}

// Routes to visit (logged-in shell)
const ROUTES = [
  '/',
  '/pricing',
  '/about',
  '/security',
  '/design-partner',
  '/docs',
  '/docs/quickstart',
  '/docs/concepts/multi-agent-orchestration',
  '/api/docs',
  '/api/redoc',
  '/runs',
  '/agents',
  '/models',
  '/eval',
  '/eval/sweeps',
  '/observability',
  '/playground',
  '/dashboards',
  '/billing',
  '/notifications',
  '/activity',
  '/welcome',
  '/settings',
  '/settings/api-keys',
  '/settings/members',
  '/settings/audit',
  '/settings/alerts',
  '/settings/integrations',
  '/settings/roles',
  '/admin/design-partners',
  '/datasets',
  '/evaluators',
];

console.log(`==> login as ${EMAIL}`);
const loginRes = await fetch(`${API}/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
if (!loginRes.ok) {
  console.error('login failed', loginRes.status);
  process.exit(1);
}
const { token } = await loginRes.json();
console.log(`    token: ${token.slice(0, 24)}...`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  ignoreHTTPSErrors: true,
});
// Set cookie before any navigation
await ctx.addCookies([
  {
    name: 'aldo_session',
    value: token,
    url: URL,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  },
]);

const issues = [];
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push({ route: page.url(), text: msg.text() });
});
const failedReqs = [];
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('favicon')) {
    failedReqs.push({ route: page.url(), url: r.url(), status: r.status() });
  }
});

for (const route of ROUTES) {
  process.stdout.write(`${route.padEnd(48)} `);
  try {
    const resp = await page.goto(URL + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const status = resp?.status() ?? 0;
    // wait briefly for hydration
    await page.waitForTimeout(500);
    // Did the page render an error boundary?
    const errorText = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      // Common error markers
      if (t.includes('Application error: a client-side exception')) return 'client-side exception';
      if (t.includes('Internal Server Error')) return 'ISE';
      if (t.includes('This page could not be found')) return 'next 404';
      if (t.match(/^\s*4\d\d\b/)) return `short-form ${t.slice(0, 50)}`;
      return null;
    });
    const final = page.url().replace(URL, '');
    const tag =
      `${status} ${final !== route ? `→ ${final}` : ''} ${errorText ? `[${errorText}]` : ''}`.trim();
    console.log(tag);
    if (status >= 400 || errorText) issues.push({ route, status, final, errorText });
  } catch (err) {
    console.log(`ERROR ${err.message.slice(0, 80)}`);
    issues.push({ route, error: err.message.slice(0, 200) });
  }
}

console.log('\n==> issues:');
for (const i of issues) console.log(' ', JSON.stringify(i));
console.log('\n==> console errors:');
for (const e of consoleErrors.slice(0, 20))
  console.log(' ', e.route.replace(URL, ''), '|', e.text.slice(0, 200));
console.log('\n==> failed requests:');
const seen = new Set();
for (const f of failedReqs) {
  const key = `${f.status} ${f.url}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(' ', f.status, f.url.replace(URL, '').replace(API, 'API'));
  if (seen.size >= 30) break;
}

await browser.close();
