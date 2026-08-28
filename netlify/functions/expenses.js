import { getSession, json, unauthorized } from './lib/auth.js';
import { openStore } from './lib/store.js';
import { getSettings } from './lib/settings.js';

const MAX_AMOUNT = 1_000_000;

async function validateExpense(body) {
  const errors = [];
  const date = String(body.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    errors.push('A valid date is required');
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    errors.push('Amount must be a positive number');
  }

  const description = String(body.description ?? '').trim();
  if (!description) errors.push('A short description is required');
  if (description.length > 200) errors.push('Description must be 200 characters or fewer');

  const notes = String(body.notes ?? '').trim();
  if (notes.length > 1000) errors.push('Notes must be 1000 characters or fewer');

  const person = String(body.person ?? '').trim();
  const providerType = String(body.providerType ?? '').trim();
  const settings = await getSettings();
  if (!settings.persons.some((p) => p.toLowerCase() === person.toLowerCase())) {
    errors.push('Unknown person');
  }
  if (!settings.providerTypes.some((t) => t.toLowerCase() === providerType.toLowerCase())) {
    errors.push('Unknown provider type');
  }

  if (errors.length > 0) return { errors };
  return {
    expense: {
      date,
      person,
      providerType,
      description,
      amount: Math.round(amount * 100) / 100,
      notes,
    },
  };
}

async function listExpenses(store) {
  const { blobs } = await store.list();
  const expenses = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
  return expenses.filter(Boolean);
}

export default async function handler(request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  const { pathname, searchParams } = new URL(request.url);
  const store = openStore('expenses');
  const id = pathname.startsWith('/api/expenses/') ? pathname.slice('/api/expenses/'.length) : null;

  if (request.method === 'GET' && !id) {
    let expenses = await listExpenses(store);
    const year = searchParams.get('year');
    const person = searchParams.get('person');
    const type = searchParams.get('type');
    if (year) expenses = expenses.filter((e) => e.date.startsWith(`${year}-`));
    if (person) expenses = expenses.filter((e) => e.person === person);
    if (type) expenses = expenses.filter((e) => e.providerType === type);
    expenses.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
    return json({ expenses });
  }

  let body = null;
  if (request.method === 'POST' || request.method === 'PUT') {
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid request' }, { status: 400 });
    }
  }

  if (request.method === 'POST' && !id) {
    const result = await validateExpense(body);
    if (result.errors) return json({ errors: result.errors }, { status: 400 });
    const now = new Date().toISOString();
    const expense = {
      id: crypto.randomUUID(),
      ...result.expense,
      createdBy: session.username,
      createdAt: now,
      updatedAt: now,
    };
    await store.setJSON(expense.id, expense);
    return json({ expense }, { status: 201 });
  }

  if (request.method === 'PUT' && id) {
    const existing = await store.get(id, { type: 'json' });
    if (!existing) return json({ error: 'Expense not found' }, { status: 404 });
    const result = await validateExpense(body);
    if (result.errors) return json({ errors: result.errors }, { status: 400 });
    const expense = {
      ...existing,
      ...result.expense,
      updatedAt: new Date().toISOString(),
    };
    await store.setJSON(id, expense);
    return json({ expense });
  }

  if (request.method === 'DELETE' && id) {
    const existing = await store.get(id, { type: 'json' });
    if (!existing) return json({ error: 'Expense not found' }, { status: 404 });
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, { status: 404 });
}

export const config = {
  path: ['/api/expenses', '/api/expenses/:id'],
};
