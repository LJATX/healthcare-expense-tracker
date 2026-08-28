import {
  verifyCredentials,
  createSessionCookie,
  clearSessionCookie,
  getSession,
  json,
  unauthorized,
} from './lib/auth.js';

export default async function handler(request) {
  const { pathname } = new URL(request.url);

  if (pathname === '/api/auth/login' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid request' }, { status: 400 });
    }
    const user = await verifyCredentials(body.username, body.password);
    if (!user) return json({ error: 'Invalid username or password' }, { status: 401 });
    return json(
      { user },
      { status: 200, headers: { 'set-cookie': await createSessionCookie(user) } },
    );
  }

  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    return json({ ok: true }, { headers: { 'set-cookie': clearSessionCookie() } });
  }

  if (pathname === '/api/auth/me' && request.method === 'GET') {
    const session = await getSession(request);
    if (!session) return unauthorized();
    return json({ user: session });
  }

  return json({ error: 'Not found' }, { status: 404 });
}

export const config = {
  path: ['/api/auth/login', '/api/auth/logout', '/api/auth/me'],
};
