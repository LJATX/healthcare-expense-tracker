// Generates the README showcase screenshots with fictional demo data.
// Run with: node dev/screenshots.mjs   → writes docs/screenshots/*.png
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8801;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.data-shots');
const OUT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');

const YEAR = new Date().getFullYear();
const PASSWORD = 'demo-password';

// Fictional family + a year of plausible entries.
const DEMO_EXPENSES = [
  { date: `${YEAR}-01-14`, person: 'Alex',  providerType: 'Doctor visit',        description: 'Annual physical — Dr. Patel',        amount: 240 },
  { date: `${YEAR}-01-27`, person: 'Sam',   providerType: 'Medication/Pharmacy', description: 'Amoxicillin — pharmacy',             amount: 32.49 },
  { date: `${YEAR}-02-09`, person: 'Jamie', providerType: 'Dental',              description: 'Cleaning + x-rays',                  amount: 185.5 },
  { date: `${YEAR}-02-21`, person: 'Alex',  providerType: 'Vision/Eye',          description: 'Eye exam + contact fitting',         amount: 165 },
  { date: `${YEAR}-03-05`, person: 'Jamie', providerType: 'Lab/Imaging',         description: 'Bloodwork panel',                    amount: 118.75 },
  { date: `${YEAR}-03-18`, person: 'Sam',   providerType: 'Doctor visit',        description: 'Pediatric checkup',                  amount: 190 },
  { date: `${YEAR}-04-02`, person: 'Alex',  providerType: 'Therapy/Mental health', description: 'Counseling session',               amount: 130 },
  { date: `${YEAR}-04-22`, person: 'Jamie', providerType: 'Medication/Pharmacy', description: 'Allergy prescription refill',        amount: 48.2 },
  { date: `${YEAR}-05-13`, person: 'Sam',   providerType: 'Dental',              description: 'Sealants',                           amount: 210 },
  { date: `${YEAR}-06-06`, person: 'Jamie', providerType: 'Lab/Imaging',         description: 'MRI — knee',                         amount: 1240 },
  { date: `${YEAR}-06-24`, person: 'Alex',  providerType: 'Doctor visit',        description: 'Dermatology consult',                amount: 225 },
  { date: `${YEAR}-07-15`, person: 'Sam',   providerType: 'Vision/Eye',          description: 'Glasses',                            amount: 289 },
  { date: `${YEAR}-08-08`, person: 'Jamie', providerType: 'Doctor visit',        description: 'Follow-up — orthopedics',            amount: 175 },
  { date: `${YEAR}-08-20`, person: 'Alex',  providerType: 'Medication/Pharmacy', description: 'Prescription refill',                amount: 27.8 },
];

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const users = [
    { username: 'alex', displayName: 'Alex', passwordHash: bcrypt.hashSync(PASSWORD, 10) },
    { username: 'jamie', displayName: 'Jamie', passwordHash: bcrypt.hashSync(PASSWORD, 10) },
  ];
  const server = spawn('node', [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(PORT), LOCAL_BLOBS_DIR: DATA_DIR, LOCAL_DEV: '1',
      JWT_SECRET: 'screenshot-secret', APP_USERS: JSON.stringify(users),
    },
    stdio: 'inherit',
  });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* not up yet */ }
    await settle(250);
  }

  // Seed data through the real API.
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alex', password: PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await fetch(`${BASE}/api/settings/persons`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Sam' }),
  });
  for (const expense of DEMO_EXPENSES) {
    await fetch(`${BASE}/api/expenses`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ...expense, notes: '' }),
    });
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true })
    .catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  try {
    // Login screen (before signing in)
    await page.goto(BASE);
    await page.waitForSelector('#login-view:not([hidden])');
    await settle(600);
    await page.screenshot({ path: path.join(OUT_DIR, 'login.png') });

    await page.fill('[name=username]', 'alex');
    await page.fill('[name=password]', PASSWORD);
    await page.click('#login-btn');
    await page.waitForSelector('#app-view:not([hidden])');
    await page.mouse.move(20, 400); // park the cursor so no chart tooltip is open
    await settle(1200); // let count-up animations and meters finish
    await page.screenshot({ path: path.join(OUT_DIR, 'dashboard.png') });

    await page.click('.tab[data-page=expenses]');
    await settle(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'expenses.png') });

    await page.click('#page-expenses [data-action=add]');
    await page.waitForSelector('.slideover.is-open');
    await settle(600); // slide-over transition fully settled
    await page.screenshot({ path: path.join(OUT_DIR, 'add-expense.png') });
    await page.click('#slideover-close');
    await settle(500);

    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(BASE);
    await mobile.waitForSelector('#app-view:not([hidden])');
    await settle(1200);
    await mobile.screenshot({ path: path.join(OUT_DIR, 'mobile-dashboard.png') });
    await mobile.close();

    console.log('Screenshots written to docs/screenshots/');
  } finally {
    await browser.close();
    server.kill();
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
