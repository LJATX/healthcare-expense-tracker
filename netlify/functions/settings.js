import { getSession, json, unauthorized } from './lib/auth.js';
import { getSettings, addCustomEntry } from './lib/settings.js';

export default async function handler(request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  const { pathname } = new URL(request.url);

  if (pathname === '/api/settings' && request.method === 'GET') {
    return json(await getSettings());
  }

  if (request.method === 'POST') {
    const kind =
      pathname === '/api/settings/persons'
        ? 'person'
        : pathname === '/api/settings/provider-types'
          ? 'provider-type'
          : null;
    if (kind) {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid request' }, { status: 400 });
      }
      const result = await addCustomEntry(kind, body.name);
      if (result.error) return json({ error: result.error }, { status: 400 });
      return json(result, { status: result.existed ? 200 : 201 });
    }
  }

  return json({ error: 'Not found' }, { status: 404 });
}

export const config = {
  path: ['/api/settings', '/api/settings/persons', '/api/settings/provider-types'],
};
