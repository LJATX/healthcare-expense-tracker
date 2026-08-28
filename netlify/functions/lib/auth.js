import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

const COOKIE_NAME = 'hxp_session';
const SESSION_DAYS = 30;

// Hash compared against when the username doesn't exist, so both paths cost
// one bcrypt comparison and can't be told apart by timing.
const DUMMY_HASH = '$2a$12$8MYUB.jycPuVOKFdxdqPCew2tKM2bEosclQHa7PgmLIX2ZAOmeMve';

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

// Accounts come from APP_USERS (JSON array) or APP_USERS_B64 (the same JSON,
// base64-encoded — handy where tooling mangles quotes/$ in env var values).
export function loadUsers() {
  const raw = process.env.APP_USERS
    || (process.env.APP_USERS_B64 && Buffer.from(process.env.APP_USERS_B64, 'base64').toString('utf8'));
  if (!raw) throw new Error('APP_USERS is not configured');
  const users = JSON.parse(raw);
  if (!Array.isArray(users)) throw new Error('APP_USERS must be a JSON array');
  return users;
}

export async function verifyCredentials(username, password) {
  const users = loadUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
  const ok = await bcrypt.compare(String(password), user ? user.passwordHash : DUMMY_HASH);
  return ok && user ? { username: user.username, displayName: user.displayName } : null;
}

export async function createSessionCookie(user) {
  const token = await new SignJWT({ name: user.displayName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.username)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (!process.env.LOCAL_DEV) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie() {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (!process.env.LOCAL_DEV) attrs.push('Secure');
  return attrs.join('; ');
}

export async function getSession(request) {
  const cookies = request.headers.get('cookie') || '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    const { payload } = await jwtVerify(match[1], secretKey());
    return { username: payload.sub, displayName: payload.name };
  } catch {
    return null;
  }
}

export function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });
}

export function unauthorized() {
  return json({ error: 'Not signed in' }, { status: 401 });
}
