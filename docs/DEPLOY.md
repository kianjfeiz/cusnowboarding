# Deploying cusnowboarding.com

A single pass, in order. Steps 1 and 2 start clocks that run while you do the
rest, so do them first even though nothing depends on them yet.

---

## 1. Push the code

Vercel builds from GitHub, and `src/env.ts` has to be pushed before the Neon
integration works without hand-copied variables.

```bash
git add -A
git commit -m "deploy prep"
git push
```

## 2. Resend (start now - DNS takes time)

1. Sign up at resend.com with any email. The login has nothing to do with what
   the app sends from.
2. **Domains → Add Domain** → `cusnowboarding.com` (the apex, not a subdomain).
3. Add the DNS records it shows you, wherever `cusnowboarding.com`'s DNS lives.
4. **API Keys → Create API Key**, permission **Sending access** only. Copy it
   now; it is shown once.

`noreply@cusnowboarding.com` does **not** need to be a real mailbox. Domain
verification is what makes the mail deliverable, not an inbox.

## 3. Generate four secrets

```bash
for k in AUTH_SECRET MEMBER_JWT_SECRET VERIFY_PEPPER CRON_SECRET; do
  echo "$k=$(openssl rand -base64 32)"
done
```

Fresh ones. Do not reuse the local values: sharing them means anything leaking
from a laptop mints valid production claim cookies.

## 4. Clean the Vercel project's variables

In the project → **Settings → Environment Variables**, delete:

- `DATABASE_URL` - the Neon integration creates it, and refuses to install
  while a manual one exists
- `DIRECT_DATABASE_URL` - the integration supplies `DATABASE_URL_UNPOOLED`
  instead, which `src/env.ts` reads as a fallback
- `ALLOW_DEV_LOGIN`, if present

## 5. Install Neon

**Storage → Create Database → Neon**, region **AWS `us-east-1`** (this is what
Vercel calls `iad1`, where the claim route is pinned).

On the Install Integration dialog:

| Field | Value |
| --- | --- |
| Project | cusnowboarding |
| Environments | Production ✓, Preview ✓, Development ✗ |
| Create database branch | Production ✗, **Preview ✓** |
| Custom Prefix | **leave empty** |
| Sensitive | on |

The empty prefix matters: it produces `DATABASE_URL` and
`DATABASE_URL_UNPOOLED`, the names the app actually reads. Development stays
unchecked so local work keeps using Docker Postgres through PgBouncer.

## 6. Set the remaining variables

Production scope:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_BASE_URL` | `https://cusnowboarding.com` |
| `AUTH_SECRET` | from step 3 |
| `MEMBER_JWT_SECRET` | from step 3 |
| `VERIFY_PEPPER` | from step 3 |
| `CRON_SECRET` | from step 3 |
| `AUTH_GOOGLE_ID` | same as local |
| `AUTH_GOOGLE_SECRET` | same as local |
| `RESEND_API_KEY` | from step 2 |
| `EMAIL_FROM` | `CU Snowboarding <noreply@cusnowboarding.com>` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | same as local |
| `NEXT_PUBLIC_PAYMENT_URL` | the club's Fusion link |

Leave `UPSTASH_*` unset. Nothing requires it, and it only throttles photo
uploads and verification starts - the claim route deliberately does no rate
limiting at all.

`NEXT_PUBLIC_BASE_URL` is baked in at build time and is what every email link
is built from. Wrong here means members get pay links pointing at the wrong
host, and it needs a redeploy to fix, not a restart.

## 7. Domain

**Settings → Domains → Add** `cusnowboarding.com`, then add the DNS records
Vercel gives you. Add `www.cusnowboarding.com` too and let Vercel redirect it.

## 8. Google OAuth

Cloud Console → your OAuth client. Add, keeping the localhost pair:

| Field | Value |
| --- | --- |
| Authorized JavaScript origin | `https://cusnowboarding.com` |
| Authorized redirect URI | `https://cusnowboarding.com/api/auth/callback/google` |

Redirect URIs match character for character - a trailing slash breaks it - and
origins carry no path.

Then check the **consent screen**. If it is still *External + Testing*, only
listed test users can sign in and everyone else is blocked. Publish it to
**Production**. The app only asks for `openid`, `profile` and `email`, which
are non-sensitive, so this needs no Google review.

## 9. R2 CORS

Cloudflare → R2 → your bucket → **Settings → CORS Policy**. Paste
`docs/r2-cors.json`. Uploads fail without it while everything else looks fine.

## 10. Deploy

**Deployments → Redeploy** (the earlier build failed on missing variables).

## 11. Create the database, from your laptop

The admin is gated on `board_users`, and the only UI that writes to it lives
inside the admin - so a fresh database has nobody who can let anybody in.

Copy the **direct** connection string from the Neon console (Vercel marks its
copies sensitive, so they cannot be read back) and run:

```bash
DIRECT_DATABASE_URL="postgresql://...neon.tech/neondb" npm run db:migrate
DIRECT_DATABASE_URL="postgresql://...neon.tech/neondb" \
  npm run board:bootstrap -- kife1762@colorado.edu "Kian Feiz"
```

## 12. Verify

1. Open `https://cusnowboarding.com` - you should be redirected to sign-in.
2. Sign in with your CU Google account. First sign-in asks for your name.
3. You should land on the board. Create a trip, archive it, delete it from the
   archive.
4. Check email actually sends - the drop-reminder or a results email.
5. `npm run storage:check` against production R2 to prove uploads work.

## 13. Scheduled jobs

Vercel Hobby allows one cron run per day, and a `*/15` schedule in
`vercel.json` is a hard **build failure**, not a warning. So `vercel.json` now
declares daily runs as a floor, and `.github/workflows/cron.yml` provides the
real cadence every 30 minutes - no extra platform, no cost.

Add two repository secrets under **GitHub → Settings → Secrets and variables →
Actions**:

| Secret | Value |
| --- | --- |
| `CRON_BASE_URL` | `https://cusnowboarding.com` |
| `CRON_SECRET` | the same value set in Vercel |

Then run it once by hand from the **Actions** tab to prove the auth works. A
401 fails the run loudly, which is the point - a scheduled job that has been
quietly failing for a month is the thing to design against.

On Pro, delete the workflow and set `vercel.json` back to `*/15 * * * *` for
expire-holds and `0 * * * *` for the two reminder jobs.

## Afterwards
- Before the season's first real drop, run `RACE_ITERATIONS=200` against a
  preview deployment on a Neon branch. Local Postgres over loopback is ~0.1ms;
  Vercel-to-Neon is 1-3ms, and only the deployed test shows the true tail.
