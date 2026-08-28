// End-to-end suite: spawns its own dev server on a scratch data dir and drives
// the real UI with Playwright. Run with `npm run e2e`.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.data-e2e');
const SHOT_DIR = path.join(__dirname, 'screenshots');

const PASS_1 = 'e2e-password-one';
const PASS_2 = 'e2e-password-two';

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const today = new Date();
const recentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 8);
// A date early in the current year, guaranteed outside the last-30-days window.
const earlyDate = new Date(today.getFullYear(), 0, 15);
const inLast30 = (d) => d >= new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29) && d <= today;

let failures = 0;
let checks = 0;
function check(label, ok, extra = '') {
  checks++;
  if (ok) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`); }
}

async function waitFor(fn, what, timeout = 6000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) { last = err; }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timed out waiting for ${what} (last: ${last})`);
}

async function textOf(page, sel) {
  return (await page.textContent(sel))?.trim();
}

async function fillExpense(page, { date, person, newPerson, type, newType, description, amount }) {
  await page.click('#page-dashboard:not([hidden]) [data-action=add], #page-expenses:not([hidden]) [data-action=add]');
  await page.waitForSelector('.slideover.is-open', { state: 'visible' });
  await page.fill('#expense-form [name=date]', date);
  if (newPerson) {
    await page.selectOption('#expense-form [name=person]', '__add');
    await page.waitForSelector('#person-add', { state: 'visible' });
    await page.fill('#person-add-input', newPerson);
    await page.click('#person-add-save');
    await waitFor(async () => (await page.inputValue('#expense-form [name=person]')) === newPerson, 'new person selected');
  } else {
    await page.selectOption('#expense-form [name=person]', person);
  }
  if (newType) {
    await page.selectOption('#expense-form [name=providerType]', '__add');
    await page.waitForSelector('#type-add', { state: 'visible' });
    await page.fill('#type-add-input', newType);
    await page.click('#type-add-save');
    await waitFor(async () => (await page.inputValue('#expense-form [name=providerType]')) === newType, 'new type selected');
  } else {
    await page.selectOption('#expense-form [name=providerType]', type);
  }
  await page.fill('#expense-form [name=description]', description);
  await page.fill('#expense-form [name=amount]', String(amount));
  await page.click('#form-save');
  await page.waitForSelector('.slideover.is-open', { state: 'detached', timeout: 6000 }).catch(() => {});
  await waitFor(() => page.$('.slideover[hidden]'), 'slideover closed');
}

async function main() {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.rm(SHOT_DIR, { recursive: true, force: true });
  await fs.mkdir(SHOT_DIR, { recursive: true });

  const users = [
    { username: 'lance', displayName: 'Lance', passwordHash: bcrypt.hashSync(PASS_1, 10) },
    { username: 'jess', displayName: 'Jess', passwordHash: bcrypt.hashSync(PASS_2, 10) },
  ];
  const server = spawn('node', [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      LOCAL_BLOBS_DIR: DATA_DIR,
      LOCAL_DEV: '1',
      JWT_SECRET: 'e2e-secret',
      APP_USERS: JSON.stringify(users),
    },
    stdio: 'inherit',
  });
  await waitFor(() => fetch(`${BASE}/`).then((r) => r.ok), 'dev server');

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
  }).catch(() => chromium.launch({ headless: true }));

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (err) => { failures++; console.error('FAIL  page JS error —', err.message); });

  try {
    /* ---- login ---- */
    console.log('\n· Login');
    await page.goto(BASE);
    await page.waitForSelector('#login-view:not([hidden])');
    await page.screenshot({ path: path.join(SHOT_DIR, '01-login.png') });

    await page.fill('[name=username]', 'lance');
    await page.fill('[name=password]', 'wrong-password');
    await page.click('#login-btn');
    await page.waitForSelector('#login-error:not([hidden])');
    check('wrong password rejected with message', (await textOf(page, '#login-error')).includes('Invalid'));

    await page.fill('[name=password]', PASS_1);
    await page.click('#login-btn');
    await page.waitForSelector('#app-view:not([hidden])');
    check('login lands on dashboard', !(await page.$('#page-dashboard[hidden]')));
    check('user chip shows display name', (await textOf(page, '#user-chip')) === 'Lance');

    /* ---- empty state ---- */
    await waitFor(async () => (await textOf(page, '#stat-ytd')) === money(0), 'empty YTD');
    check('empty dashboard shows $0.00', true);
    check('empty chart message', (await textOf(page, '#monthly-chart')).includes('No spending'));

    /* ---- add expenses ---- */
    console.log('\n· Add expenses');
    await fillExpense(page, {
      date: iso(earlyDate), person: 'Lance', type: 'Doctor visit',
      description: 'Annual physical — Dr. Patel', amount: 240,
    });
    await fillExpense(page, {
      date: iso(recentDate), newPerson: 'Sam', newType: 'Chiropractor',
      description: 'Adjustment', amount: 90,
    });
    await page.screenshot({ path: path.join(SHOT_DIR, '02-mid-entry.png') });
    await fillExpense(page, {
      date: iso(today), person: 'Jess', type: 'Dental',
      description: 'Cleaning + x-rays', amount: 185.5,
    });

    /* ---- dashboard math ---- */
    console.log('\n· Dashboard math');
    const total = 240 + 90 + 185.5;
    const expected30 = [[recentDate, 90], [earlyDate, 240], [today, 185.5]]
      .filter(([d]) => inLast30(d)).reduce((a, [, v]) => a + v, 0);
    await waitFor(async () => (await textOf(page, '#stat-ytd')) === money(total), `YTD ${money(total)}`);
    check(`YTD total = ${money(total)}`, true);
    check(`last-30-days = ${money(expected30)}`, (await textOf(page, '#stat-30d')) === money(expected30),
      `got ${await textOf(page, '#stat-30d')}`);
    check('entry count = 3', (await textOf(page, '#stat-count')) === '3');

    const byPerson = await textOf(page, '#by-person');
    check('by-person: Lance $240.00', byPerson.includes('Lance') && byPerson.includes(money(240)));
    check('by-person: Jess $185.50', byPerson.includes('Jess') && byPerson.includes(money(185.5)));
    check('by-person: Sam $90.00', byPerson.includes('Sam') && byPerson.includes(money(90)));
    const byType = await textOf(page, '#by-type');
    check('by-type includes custom Chiropractor', byType.includes('Chiropractor'));
    check('by-type includes Dental + Doctor visit', byType.includes('Dental') && byType.includes('Doctor visit'));

    const monthsWithData = new Set([earlyDate, recentDate, today].map((d) => d.getMonth())).size;
    const bars = await page.$$('#monthly-chart .chart-bar');
    check(`chart has ${monthsWithData} bars`, bars.length === monthsWithData, `got ${bars.length}`);
    const recentRows = await page.$$('#recent-list .recent-row');
    check('recent list has 3 rows', recentRows.length === 3);
    await page.screenshot({ path: path.join(SHOT_DIR, '03-dashboard.png') });

    /* ---- expenses page: filters ---- */
    console.log('\n· Expenses table + filters');
    await page.click('.tab[data-page=expenses]');
    await page.waitForSelector('#page-expenses:not([hidden])');
    await waitFor(async () => (await page.$$('#expense-tbody tr')).length === 3, '3 table rows');
    check('table shows 3 rows', true);

    await page.selectOption('#filter-person', 'Sam');
    await waitFor(async () => (await page.$$('#expense-tbody tr')).length === 1, 'filtered to 1 row');
    check('person filter narrows to 1 row', true);
    check('filter total shows $90.00', (await textOf(page, '#filter-total')).includes(money(90)));
    await page.screenshot({ path: path.join(SHOT_DIR, '04-expenses-filtered.png') });
    await page.click('#clear-filters');
    await waitFor(async () => (await page.$$('#expense-tbody tr')).length === 3, 'filters cleared');
    check('clear filters restores 3 rows', true);

    /* ---- CSV export ---- */
    console.log('\n· CSV export');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
    const csv = await fs.readFile(await download.path(), 'utf8');
    check('CSV has header + 3 rows', csv.trim().split(/\r\n/).length === 4, `got ${csv.trim().split(/\r\n/).length} lines`);
    check('CSV includes custom type + amounts', csv.includes('Chiropractor') && csv.includes('185.50'));

    /* ---- edit ---- */
    console.log('\n· Edit');
    const samRow = await waitFor(async () => {
      for (const row of await page.$$('#expense-tbody tr')) {
        if ((await row.textContent()).includes('Sam')) return row;
      }
      return null;
    }, 'Sam row');
    await samRow.hover();
    await (await samRow.$('[data-edit]')).click();
    await page.waitForSelector('.slideover.is-open');
    check('edit prefills description', (await page.inputValue('#expense-form [name=description]')) === 'Adjustment');
    await page.fill('#expense-form [name=amount]', '95');
    await page.click('#form-save');
    await waitFor(async () => (await page.textContent('#expense-tbody')).includes(money(95)), 'edited amount in table');
    check('edited amount appears in table', true);

    /* ---- custom entries persist across reload ---- */
    console.log('\n· Persistence across reload');
    await page.reload();
    await page.waitForSelector('#app-view:not([hidden])');
    await waitFor(async () => (await textOf(page, '#stat-ytd')) === money(total + 5), 'YTD after reload');
    check('session survives reload; dashboard shows updated total', true);
    await page.click('#page-dashboard [data-action=add]');
    await page.waitForSelector('.slideover.is-open');
    const typeOptions = await page.$$eval('#expense-form [name=providerType] option', (os) => os.map((o) => o.value));
    const personOptions = await page.$$eval('#expense-form [name=person] option', (os) => os.map((o) => o.value));
    check('custom provider type persists in dropdown', typeOptions.includes('Chiropractor'));
    check('added person persists in dropdown', personOptions.includes('Sam'));
    await page.screenshot({ path: path.join(SHOT_DIR, '05-slideover.png') });
    await page.click('#slideover-close');
    await waitFor(() => page.$('.slideover[hidden]'), 'slideover closed');

    /* ---- delete ---- */
    console.log('\n· Delete');
    await page.click('.tab[data-page=expenses]');
    const firstRow = (await page.$$('#expense-tbody tr'))[0];
    await firstRow.hover();
    await (await firstRow.$('[data-delete]')).click();
    await page.waitForSelector('.confirm-delete');
    await page.click('.confirm-delete');
    await waitFor(async () => (await page.$$('#expense-tbody tr')).length === 2, '2 rows after delete');
    check('delete removes the row (after confirm)', true);

    /* ---- second user sees shared data ---- */
    console.log('\n· Second account');
    await page.click('#logout-btn');
    await page.waitForSelector('#login-view:not([hidden])');
    check('logout returns to login', true);
    const status = await page.evaluate(() => fetch('/api/expenses').then((r) => r.status));
    check('API returns 401 after logout', status === 401, `got ${status}`);

    await page.fill('[name=username]', 'jess');
    await page.fill('[name=password]', PASS_2);
    await page.click('#login-btn');
    await page.waitForSelector('#app-view:not([hidden])');
    check('second user logs in', (await textOf(page, '#user-chip')) === 'Jess');
    await waitFor(async () => (await textOf(page, '#stat-count')) === '2', 'shared data for second user');
    check('second user sees the shared ledger', true);

    /* ---- mobile layout ---- */
    console.log('\n· Mobile layout');
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(BASE);
    await mobile.waitForSelector('#app-view:not([hidden])');
    await waitFor(async () => ((await mobile.textContent('#stat-ytd')) || '').includes('$'), 'mobile dashboard');
    check('mobile FAB visible', await mobile.$eval('.fab', (el) => getComputedStyle(el).display !== 'none'));
    await mobile.screenshot({ path: path.join(SHOT_DIR, '06-mobile-dashboard.png'), fullPage: true });
    await mobile.click('.tab[data-page=expenses]');
    await mobile.screenshot({ path: path.join(SHOT_DIR, '07-mobile-expenses.png'), fullPage: true });
    await mobile.close();
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
