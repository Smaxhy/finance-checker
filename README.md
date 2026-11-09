# Command Centre

A private, self-hosted command centre for your money, subscriptions, inbox and plans — built for a Belgian/EU user.
It connects (read-only) to Gmail, Google Calendar and your bank, organises everything automatically, and leaves every decision to you.

> **Nothing is invented.** Until you connect a source, import a CSV or explicitly load demo data, the app shows empty states and "requires setup" cards. Demo data is generated on request, marked **DEMO** everywhere, and removable in one click.

---

## What's inside

| Area | What it does |
| --- | --- |
| **Overview** | Spent / income this month (vs the same days last month), available balance, recurring per month, last 7 days; daily / weekly / monthly spending charts; spending pace vs last month; upcoming payments, renewals, trials, bills, bookings and tasks; category breakdown; recent transactions; newly detected subscriptions; important emails; computed insights. |
| **Finances** | Transactions (search, filters, inline categorisation with "apply to all from this merchant" rules, notes, own-transfer marking, manual entries, **bank CSV import** with column auto-detection, CSV export), Spending Analytics (by category and merchant with drill-down, averages, biggest purchases, recurring costs, month-over-month table, yearly overview), Income (sources, refunds, savings rate), Budgets (monthly limits with pace marker). Transfers between your own accounts are never counted as income or spending. |
| **Subscriptions** | Detected from recurring bank charges *and* subscription/trial/renewal emails. Monthly & yearly totals, price-increase detection, similar-service overlaps (e.g. Spotify + Deezer), trials, renewals, possibly-forgotten services, charges after cancellation. Each subscription has history, related emails and a **cancellation workflow**: official cancellation page + step-by-step guide (incl. Belgian Easy Switch / energy-switch rules), deadline tracking, "I've requested cancellation" → pending, and "confirmed" only after you explicitly confirm you received proof. Opening a cancellation link never changes anything. |
| **Emails** | Gmail sync (read-only) extracting receipts, purchases, orders, shipping, subscriptions, trials, renewals, cancellations, bills (with due dates), bookings, travel and appointments — in Dutch, French and English. Searchable, with structured answers: spent at a store this year (email receipts and bank transactions shown separately), last purchase, subscriptions signed up for, upcoming payments, trials expiring, appointments. Only extracted facts and Gmail's snippet are stored — never full bodies. |
| **Calendar** | Month view, 60-day upcoming timeline with expected-expense totals, weekly overview + daily agenda, tasks & reminders. Combines Google Calendar (read-only), events detected in email (flights, hotels with pay-at-property balances, restaurants, appointments, deliveries), subscription renewals, bill due dates and manual events. |
| **Insights** | Deterministic insights computed from your data (e.g. *"Restaurant spending increased by 32% compared to last month"*, *"You might be paying for two similar services"*), Spending Patterns, printable monthly Reports, and an **AI Assistant** (Claude) that answers questions by calling tools over *your* data only. |
| **Notifications** | Upcoming payments, trials ending, new/unexpected recurring payments, price increases, large purchases, bills, events in the next 48 h, unusual spending, charges after cancellation, cancellation emails, expiring bank consent — each configurable. |
| **Settings** | Connected accounts (connect / sync / disconnect with optional data deletion), Privacy & Security (AI opt-in, email retention, GDPR export, delete all data, delete account, security activity log), Preferences (profile, theme, notification rules, custom categories & rules, demo data). |

Keyboard: **⌘K / Ctrl+K** opens the command palette (navigate, search transactions/emails, ask the assistant, quick-add).

---

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions, Turbopack), **React 19**, **TypeScript**, **Tailwind CSS v4**
- **Supabase** — Postgres + Auth (email/password and magic link), row-level security on every table
- **Recharts** for charts (colour palette validated for colour-vision deficiency and contrast)
- **Integrations:** Gmail API, Google Calendar API, **Enable Banking** (PSD2 AIS) for Belgian/EU banks, **Anthropic Claude API**
- **Vitest** unit tests; Playwright for end-to-end checks

```
src/
  app/
    (auth)/            login, signup
    (app)/             every signed-in page (overview, finances, subscriptions, emails, calendar, insights, notifications, settings)
    actions/           server actions (zod-validated, user-scoped)
    api/               sync, cron, OAuth/PSD2 callbacks, assistant (streaming), exports
  components/          ui primitives, shell (sidebar, ⌘K, bell), charts, per-section components
  lib/
    finance/           merchant catalogue, categoriser, transfer pairing, recurring detection, CSV parser
    email/             MIME parsing, classifier, rule extraction, optional AI extraction, retention
    calendar/          timezone helpers, event-kind inference, charge projection, Google sync
    engines/           pipeline, insights, notifications, upcoming timeline
    integrations/      Google OAuth, Gmail, Calendar, Enable Banking, encrypted connection store
    ai/                Claude client, assistant tools, rate limit
    sync/              sync dispatcher (gmail / calendar / bank)
    demo/              demo-data generator
supabase/migrations/   schema, RLS policies, analytics functions
```

---

## Quick start (local)

Requirements: **Node.js 20.9+** and **Docker** (for the local Supabase stack).

```bash
npm install
```

```bash
npx supabase init
```

```bash
npx supabase start
```

`supabase start` applies the migrations in `supabase/migrations` and prints the API URL, anon key and service-role key.

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — from `supabase start`
- `TOKEN_ENCRYPTION_KEY` — `openssl rand -base64 32`
- `CRON_SECRET` — `openssl rand -hex 24`

```bash
npm run dev
```

Open http://localhost:3000, create an account, then either import a bank CSV, connect an integration, or load demo data from the Overview.

### Using a hosted Supabase project instead

1. Create a project at supabase.com (choose an EU region, e.g. Frankfurt, for GDPR).
2. Apply the schema: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. Authentication → URL configuration: set **Site URL** to your app URL and add `<APP_URL>/auth/callback` to the redirect URLs.
4. Put the project URL, anon key and service-role key in your environment.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | yes | Public URL of the app (used for OAuth redirect URIs). |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase project (the publishable `sb_publishable_…` key also works via `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server-only.** Token storage, background sync, account deletion. Never expose it. |
| `TOKEN_ENCRYPTION_KEY` | for integrations | 32 random bytes (base64). Encrypts OAuth refresh tokens and bank sessions (AES-256-GCM). |
| `CRON_SECRET` | for daily sync | Bearer secret for `/api/cron/daily`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Gmail/Calendar | Google OAuth web client. |
| `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY` | for bank sync | Enable Banking application id and its private key (PEM; `\n` escapes allowed). |
| `ENABLE_BANKING_COUNTRY` | optional | Default `BE`. |
| `ANTHROPIC_API_KEY` | for AI | Claude API key. |
| `AI_MODEL`, `AI_EXTRACTION_MODEL` | optional | Default `claude-opus-5-5`. |

Any integration without its variables simply shows a **"requires setup"** card listing exactly what's missing.

---

## Integrations — what you need and what it costs

### Gmail + Google Calendar (free)

1. Google Cloud Console → new project → enable **Gmail API** and **Google Calendar API**.
2. OAuth consent screen: *External*, add your own Google account as a **test user**, add the scopes `gmail.readonly` and `calendar.readonly`.
3. Credentials → OAuth client ID → *Web application* → authorised redirect URI: `<APP_URL>/api/integrations/google/callback`.
4. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, then Settings → Connected Accounts → Connect Gmail / Calendar.

Notes:
- Only **read-only** scopes are requested; the app cannot send, delete, label or modify mail or events.
- `gmail.readonly` is a Google *restricted* scope. For personal use keep the app in **Testing** mode with yourself as a test user. Google expires refresh tokens of apps in Testing after **7 days**, so you'll be asked to reconnect weekly. Publishing the app removes that limit but requires Google's verification (and a security assessment for restricted scopes).

### Belgian / EU bank accounts — Enable Banking (PSD2)

The app uses **[Enable Banking](https://enablebanking.com)**, a licensed PSD2 account-information provider covering KBC/CBC, BNP Paribas Fortis, Belfius, ING Belgium, Argenta, Crelan and many more.

1. Sign up at enablebanking.com and register an application (start with the **sandbox**).
2. Set the redirect URL to `<APP_URL>/api/integrations/enablebanking/callback`.
3. Copy the application id and the generated private key into `ENABLE_BANKING_APP_ID` / `ENABLE_BANKING_PRIVATE_KEY`.
4. To read your **own real accounts**, activate the application by linking your accounts in the Enable Banking control panel. Check Enable Banking's current pricing/terms for personal use before relying on it.

How it behaves:
- Read-only account information only — no payment initiation exists in the code.
- You authorise at your own bank (itsme / bank app); your banking credentials never reach this app.
- PSD2 consent lasts up to 180 days; the app warns you before it expires and offers "Renew access".
- First sync backfills up to 12 months (many banks only return 90 days), later syncs overlap by 10 days; only **booked** transactions are imported (pending ones often change id when they book).

Alternatives if you prefer another aggregator: GoCardless Bank Account Data (formerly Nordigen) stopped accepting new customers in 2025; Tink, Salt Edge, Yapily and Ponto (Isabel) are paid business offerings. The provider code is isolated in `src/lib/integrations/enablebanking.ts` + `src/lib/sync/bank.ts`.

### No API keys at all: bank CSV import

Every Belgian bank lets you export transactions as CSV. **Finances → Transactions → Import CSV** detects Dutch/French/English headers, `;` separators, comma decimals, debit/credit columns and preamble lines, shows a preview with editable column mapping, and imports idempotently (re-importing the same file never duplicates).

### AI assistant and AI email extraction — Anthropic (paid, usage-based)

Set `ANTHROPIC_API_KEY`, then **opt in** under Settings → Privacy & Security. Both switches are off by default.

- **Assistant:** your question and the specific figures the assistant looks up (via tools over your own data: totals, matching transactions, subscriptions, upcoming items, extracted email fields — never email bodies) are sent to Anthropic. Conversations are not stored by the app. Rate limited per user.
- **AI email extraction:** the text of likely receipts/bills/bookings (capped at 12 000 characters each) is sent to improve extraction; without it, extraction uses the on-server rules only.
- Server-side refusal fallback (`fallbacks: "default"`) is enabled on Claude requests.
- All dashboard insights work without AI — they are computed deterministically from your data.

### Daily background sync

`/api/cron/daily` syncs every connection, re-runs detection and notifications, purges email data past your retention period and warns about expiring bank consent.
On Vercel, `vercel.json` already schedules it (Vercel sends `Authorization: Bearer $CRON_SECRET`). Elsewhere, call it once a day:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.example/api/cron/daily
```

---

## Security & privacy design (GDPR)

- **No passwords stored** — OAuth (Google, with PKCE + state) and PSD2 redirect consent only.
- **Least privilege** — `gmail.readonly`, `calendar.readonly`, PSD2 account information. The code has no endpoint that sends mail, writes calendars, initiates payments or cancels subscriptions.
- **Encryption** — refresh tokens and bank session ids are AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY` and stored in `connection_secrets`, a table with RLS enabled and *no* policies and revoked grants, so no browser session can read it, even its owner. IBANs used for own-transfer matching are stored as keyed hashes plus a masked display form. TLS in transit; HSTS in production.
- **Isolation** — row-level security on every table (`user_id = auth.uid()`); anonymous access is revoked entirely. Server code that must use the service role (sync, cron) filters by user id on every query.
- **Data minimisation** — no email bodies stored; configurable email retention with automatic purge.
- **User rights** — JSON export of everything (Art. 20), delete all data, delete account (Art. 17), disconnect with optional data deletion (tokens revoked at Google / bank session deleted at Enable Banking), security activity log.
- **Hardening** — strict security headers (CSP, `frame-ancestors 'none'`, `nosniff`, referrer and permissions policies), zod validation on every action and route, same-origin server actions, open-redirect-safe auth redirects, CSV-injection-safe exports, timing-safe secret comparisons.
- **No automatic decisions** — nothing is ever marked cancelled because you clicked a link; detected subscriptions start as "to review"; cancellation emails are surfaced as evidence for you to accept.

---

## Testing

```bash
npm test
```

There are 109 unit tests. They cover the categoriser, transfer pairing, recurring and price-change detection, the CSV parser across bank layouts, Enable Banking mapping and JWT signing, email MIME parsing, classification and extraction (nl/fr/en fixtures), the Gmail sync against mocked API responses, the calendar sync against mocked responses, timezone/DST handling, subscription helpers, report helpers, assistant tools, and the assistant loop against a mocked streaming API.

```bash
npx tsc --noEmit && npm run lint && npm run build
```

End-to-end flows were exercised with Playwright against a local Supabase stack: sign-up, CSV import (and re-import without duplicates), recategorisation rules, manual entries, exports, demo data, every page, the full cancellation flow, notifications, the RLS isolation checks, and delete-all-data.

---

## Known limitations / next steps

- Live Google, Enable Banking and Claude calls need your credentials; in development they were verified against mocked API responses, not live accounts.
- Outlook / Microsoft 365 mail isn't supported yet; the email pipeline (`src/lib/email`) is provider-agnostic, so a Microsoft Graph client is the main missing piece.
- Notifications are in-app only (no email or push delivery yet).
- Amounts in other currencies are displayed as-is (no FX conversion).
- "Today" boundaries for month/week totals are computed in the server's timezone; display is always in Europe/Brussels. On a UTC server that shifts day boundaries by 1–2 hours.
- The assistant's rate limiter is in-memory (per server instance).
