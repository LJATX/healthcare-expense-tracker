# CareLedger — family healthcare expense tracker

A private web app for logging every healthcare expense through the year (doctor,
dental, vision, pharmacy, …) per family member, with a dashboard that totals
spending by person, provider type, and month — so at year-end you can judge
whether health insurance makes sense next year.

## Stack

- **Frontend** — static single-page app (`public/`), vanilla JS, no build step.
- **Backend** — Netlify Functions (`netlify/functions/`): `auth`, `expenses`, `settings`.
- **Storage** — Netlify Blobs: one blob per expense in the `expenses` store;
  user-added persons/provider types in the `settings` store.
- **Auth** — username/password (bcrypt hashes in the `APP_USERS` env var), JWT
  session in an httpOnly cookie. No public signup — only the configured accounts.

## Configuration (Netlify environment variables)

| Variable | Purpose |
|---|---|
| `APP_USERS` | JSON array of accounts: `[{"username":"lance","displayName":"Lance","passwordHash":"$2a$12$…"}, …]` |
| `APP_USERS_B64` | Alternative to `APP_USERS`: the same JSON, base64-encoded (`APP_USERS` wins if both are set) |
| `JWT_SECRET` | Long random string used to sign session cookies |

To change a password (or add an account), generate a hash and update `APP_USERS`
in the Netlify dashboard (Site configuration → Environment variables), then
redeploy:

```sh
npm install
node scripts/hash-password.mjs "the-new-password"
```

Person names in the app come from account `displayName`s plus any people added
in the app's "Add someone…" option. Provider types are the built-in list
(Doctor visit, Dental, Vision/Eye, Medication/Pharmacy, Lab/Imaging,
Therapy/Mental health) plus anything added via "Other / add your own…".

## Local development

```sh
npm install
JWT_SECRET=dev-secret \
APP_USERS='[{"username":"dev","displayName":"Dev","passwordHash":"<hash>"}]' \
npm run dev            # http://localhost:8788
```

The dev harness (`dev/server.js`) serves `public/` and runs the same function
handlers with Blobs backed by `dev/.data/` on disk. `npm run e2e` runs the
Playwright end-to-end suite against a scratch data directory.

## Deploying

Hosted on Netlify: publish directory `public`, functions in
`netlify/functions` (see `netlify.toml`). Connect the GitHub repo to the
Netlify project so pushes to `main` auto-deploy, and set the two environment
variables above.
