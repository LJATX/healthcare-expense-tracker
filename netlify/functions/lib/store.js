import { getStore } from '@netlify/blobs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// On Netlify this is a real Blobs store. When LOCAL_BLOBS_DIR is set (dev
// harness), a filesystem-backed stand-in with the same subset of the API.
export function openStore(name) {
  const localDir = process.env.LOCAL_BLOBS_DIR;
  if (localDir) return localFsStore(path.join(localDir, name));
  return getStore({ name, consistency: 'strong' });
}

const safeKey = (key) => {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) throw new Error(`invalid blob key: ${key}`);
  return key;
};

function localFsStore(dir) {
  const file = (key) => path.join(dir, `${safeKey(key)}.json`);
  return {
    async get(key, opts = {}) {
      try {
        const text = await fs.readFile(file(key), 'utf8');
        return opts.type === 'json' ? JSON.parse(text) : text;
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async setJSON(key, value) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(key), JSON.stringify(value, null, 2));
    },
    async delete(key) {
      try {
        await fs.unlink(file(key));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    },
    async list() {
      let names = [];
      try {
        names = await fs.readdir(dir);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      return { blobs: names.filter((n) => n.endsWith('.json')).map((n) => ({ key: n.slice(0, -5) })) };
    },
  };
}

export async function readJSON(store, key, fallback) {
  const value = await store.get(key, { type: 'json' });
  return value ?? fallback;
}
