import { openStore, readJSON } from './store.js';
import { loadUsers } from './auth.js';

export const DEFAULT_PROVIDER_TYPES = [
  'Doctor visit',
  'Dental',
  'Vision/Eye',
  'Medication/Pharmacy',
  'Lab/Imaging',
  'Therapy/Mental health',
];

const CUSTOM_PERSONS_KEY = 'custom-persons';
const CUSTOM_TYPES_KEY = 'custom-provider-types';

function union(base, extra) {
  const seen = new Set(base.map((v) => v.toLowerCase()));
  const merged = [...base];
  for (const value of extra) {
    if (!seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      merged.push(value);
    }
  }
  return merged;
}

// The stored lists hold only user-added entries; account holders and the
// default provider types are always present without needing a seed write.
export async function getSettings() {
  const store = openStore('settings');
  const [customPersons, customTypes] = await Promise.all([
    readJSON(store, CUSTOM_PERSONS_KEY, []),
    readJSON(store, CUSTOM_TYPES_KEY, []),
  ]);
  const accountNames = loadUsers().map((u) => u.displayName);
  return {
    persons: union(accountNames, customPersons),
    providerTypes: union(DEFAULT_PROVIDER_TYPES, customTypes),
  };
}

export async function addCustomEntry(kind, name) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { error: 'Name is required' };
  if (trimmed.length > 40) return { error: 'Name must be 40 characters or fewer' };

  const store = openStore('settings');
  const key = kind === 'person' ? CUSTOM_PERSONS_KEY : CUSTOM_TYPES_KEY;
  const custom = await readJSON(store, key, []);
  const settings = await getSettings();
  const existing = kind === 'person' ? settings.persons : settings.providerTypes;
  if (existing.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
    return { value: trimmed, existed: true };
  }
  custom.push(trimmed);
  await store.setJSON(key, custom);
  return { value: trimmed, existed: false };
}
