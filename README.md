# Command Centre

A private, self-hosted command centre for your money, subscriptions, inbox and plans — built for a Belgian/EU user.
It connects (read-only) to Gmail, Google Calendar and your bank, organises everything automatically, and leaves every decision to you.

> **Nothing is invented.** Until you connect a source, import a CSV or explicitly load demo data, the app shows empty states and "requires setup" cards. Demo data is generated on request, marked **DEMO** everywhere, and removable in one click.

> **Don't want to run a server?** Use the [GitHub Pages edition](#easiest-github-pages-edition-no-server-no-accounts). It runs entirely in your browser, with no accounts or keys to set up.

---

## What's inside

| Area | What it does |
| --- | --- |
| **Overview** | Spent / income this month (vs the same days last month), available balance, recurring per month, last 7 days; daily / weekly / monthly spending charts; spending pace vs last month; upcoming payments, renewals, trials, bills, bookings and tasks; category breakdown; recent transactions; newly detected subscriptions; important emails; computed insights. |
| **Finances** | Transactions (search, filters, inline categorisation with "apply to all from this merchant" rules, notes, own-transfer marking, manual entries, **bank CSV import** with column auto-detection, CSV export), Spending Analytics (by category and merchant with drill-down, averages, biggest purchases, recurring costs, month-over-month table, yearly overview), Income (sources, refunds, savings rate), Budgets (monthly limits with pace marker). Transfers between your own accounts are never counted as income or spending. |
| **Subscriptions** | Detected from recurring bank charges *and* subscription/trial/renewal emails. Monthly & yearly totals, price-increase detection, similar-service overlaps (e.g. Spotify + Deezer), trials, renewals, possibly-forgotten services, charges after cancellation. Each subscription has history, related emails and a **cancellation workflow**: official cancellation page + step-by-step guide (incl. Belgian Easy Switch / energy-switch rules), deadline tracking, "I've requested cancellation" → pending, and "confirmed" only after you explicitly confirm you received proof. Opening a cancellation link never changes anything. |
| **Emails** | Gmail sync (read-only) for **as many Google accounts as you connect** - shown together, labelled by mailbox, filterable per mailbox - extracting receipts, purchases, orders, shipping, subscriptions, trials, renewals, cancellations, bills (with due dates), bookings, travel and appointments — in Dutch, French and English. Searchable, with structured answers: spent at a store this year (email receipts and bank transactions shown separately), last purchase, subscriptions signed up for, upcoming payments, trials expiring, appointments. Only extracted facts and Gmail's snippet are stored — never full bodies. |
| **Calendar** | Month view, 60-day upcoming timeline with expected-expense totals, weekly overview + daily agenda, tasks & reminders. Combines Google Calendar (read-only), events detected in email (flights, hotels with pay-at-property balances, restaurants, appointments, deliveries), subscription renewals, bill due dates and manual events. |
| **Insights** | Deterministic insights computed from your data (e.g. *"Restaurant spending increased by 32% compared to last month"*, *"You might be paying for two similar services"*), Spending Patterns, printable monthly Reports, and the **Assistant**. It always works: a **built-in assistant** (no AI, no key, nothing sent anywhere) understands everyday questions about spending, income, subscriptions, budgets, upcoming payments, email and your calendar, handles periods ("last month", "in October", "the last 90 days") and follow-ups ("and last month?"), and runs a **full check-up** of everything in one go. Optionally **Claude** takes over for free-form questions and deeper analysis, using 19 read-only tools over *your* data only. Every answer comes with charts and tables drawn directly from the data, follow-up suggestions, and (for Claude) what the answer cost. |
| **Notifications** | Upcoming payments, trials ending, new/unexpected recurring payments, price increases, large purchases, bills, events in the next 48 h, unusual spending, charges after cancellation, cancellation emails, expiring bank consent — each configurable. |
| **Settings** | Connected accounts (connect / sync / disconnect with optional data deletion), Privacy & Security (AI opt-in, email retention, GDPR export, delete all data, delete account, security activity log), Preferences (profile, theme, notification rules, custom categories & rules, demo data). |

Keyboard: **⌘K / Ctrl+K** opens the command palette (navigate, search transactions/emails, ask the assistant, quick-add).

**On your phone:** the layout adapts below 1024px. It has a bottom tab bar (Overview, Money, Subscriptions, Calendar, More), bottom-sheet dialogs, tappable list layouts instead of wide tables, a day strip for the week view, and 16px form fields so iOS never zooms in. Safe-area insets are respected on notched iPhones. The app is installable: in Safari use *Share → Add to Home Screen*, in Chrome use *Install app*. It then opens full-screen with its own icon and shortcuts (add transaction, upcoming, subscriptions).

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

## Easiest: GitHub Pages edition (no server, no accounts)

If you just want to use it, skip Supabase and Vercel entirely. The same app is also built as a static site that runs **completely in your browser**. There is no login, and your data is stored on your device (IndexedDB), never on a server.

**One-time setup** (about 1 minute):

1. On GitHub, open the repo's **Settings → Pages**.
2. Under *Build and deployment → Source*, choose **GitHub Actions**.
3. Push to the default branch, or run the **Deploy to GitHub Pages** workflow from the *Actions* tab.

The site appears at `https://<your-username>.github.io/<repo-name>/` (for this repo: `https://smaxhy.github.io/finance-checker/`). The workflow (`.github/workflows/pages.yml`) runs the unit tests and rebuilds the site on every push.

**What works straight away, with no setup:**
- Bank CSV import, with column auto-detection and no duplicates on re-import.
- Categories and rules, manual transactions, and budgets.
- Recurring and subscription detection, and the cancellation workflow.
- Calendar events and tasks, the insights, notifications, reports, and charts.
- The **assistant**: the built-in one answers questions and runs full check-ups in your browser. Nothing is sent anywhere.
- Demo data, CSV and JSON export, delete-all, and the phone layout.

**What works after a one-time setup (both optional):**
- **Gmail and Google Calendar, for several Google accounts** (read-only). Needs a free Google "client ID", about 10 minutes, once - see below. The app walks you through it under *Settings → Connected Accounts*.
- **Claude** for free-form questions and deeper analysis, with your own Anthropic API key (pay-as-you-go, typically a few cents per question). Paste it under *Settings → Connected Accounts → AI provider*.

**What doesn't:**
- Live bank connections (PSD2). They need a private server for the bank credentials. Use CSV import.
- Checking anything while the app is closed. There is no server, so mail is checked while the app is open.

**Things to know:**
- Your data lives only in the browser you use it in. A different browser, a different device, or clearing site data starts empty.
- To move or back up your data, use *Settings → Privacy & Security → Download export*.
- The site is public, but the data isn't: every visitor gets their own empty, private copy in their own browser.
- Adding the app to your phone's home screen works the same way as in the full edition.

### Email and calendar in the Pages edition

Google only lets an app read mail if the app has its own client ID. You create it once (free), then connect as many Google accounts as you like. *Settings → Connected Accounts* shows these steps with the exact values to copy for your site:

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com/projectcreate).
2. Enable the **Gmail API** and the **Google Calendar API** for it.
3. Open **Google Auth Platform**, fill in an app name and your email, choose **External**, and add every Gmail address you want to connect under **Audience → Test users**.
4. Under **Clients**, create a client of type **Web application** with
   - Authorised JavaScript origin: `https://<your-username>.github.io`
   - Authorised redirect URI: `https://<your-username>.github.io/<repo-name>/oauth/`
5. Paste the **Client ID** into the app. (It is a public identifier, not a secret. To avoid pasting it on every device, you can instead set it as the repository variable `GOOGLE_CLIENT_ID` under *Settings → Secrets and variables → Actions → Variables*; the workflow builds it in.)

Then *Connect Gmail and Calendar*, and *Add another Google account* for each further mailbox. Google shows "Google hasn't verified this app" the first time, which is expected for an app you made yourself: click **Continue**.

How it behaves, and why:
- **Read-only.** Only `gmail.readonly` and `calendar.readonly` are requested. The app only ever sends `GET` requests to Google.
- **A one-hour pass instead of a stored login.** A website without a server can't keep a long-lived Google login safely, so Google gives the browser a read-only pass that lasts about an hour. It is kept only until the tab is closed, and is never written to the data store or to exports.
- **Checking your mail.** While the app is open and the pass is valid, every account is re-checked every 15 minutes. After that, one tap on *Check now* fetches fresh passes for all accounts: the page hops to Google and straight back without asking anything, as long as you are still signed in to Google in that browser. You can also switch on *Check automatically when I open the app* (off by default, at most once every 3 hours).
- **Testing mode.** While your Google project is in *Testing*, Google asks you to approve access again about once a week. Publishing the app in Google Auth Platform removes that, at the price of the "unverified app" screen staying.
- Mail is processed in your browser: only receipts, bills, orders, bookings and other important mail are kept, as extracted fields plus Gmail's short preview. Message bodies are never stored.

### Claude in the Pages edition

The built-in assistant needs nothing. To add Claude, create an API key in the [Anthropic Console](https://console.anthropic.com/settings/keys), paste it under *Settings → Connected Accounts → AI provider*, and pick a model (Claude Opus 5.5 by default; Sonnet 5.5 and Haiku 5.5 are cheaper, Fable 5.2 is the most capable) and an answer depth.

- Requests go straight from your browser to Anthropic with your key. Your question and the figures looked up for it are sent; email bodies, tokens and logins are not.
- The key is stored only in that browser (`localStorage`), is left out of exports, and is removed by *Delete all data*. Anyone who can use that browser profile can use the key, so set a monthly spend limit in the Anthropic Console.
- All sites under the same `github.io` user name share browser storage. If you publish other pages there, their scripts could read the key.
- If Claude can't be reached or rejects the key, the built-in assistant answers instead and says so.
- The page carries a Content-Security-Policy that only allows connections to itself, Anthropic and Google's read-only APIs.

To build it yourself, run `NEXT_PUBLIC_BASE_PATH=/<repo-name> npm run build:pages`. This writes `out/`. For a local preview, run `npm run dev:pages` (it serves on port 3100).

How it works: route files named `*.local.tsx` are used only by this build (`pageExtensions`). `tsconfig.local.json` swaps the Supabase client for an in-browser query engine (`src/lib/local/db.ts`), which implements the subset of supabase-js the app uses, and swaps the server configuration for what is set up in the browser (`src/lib/local/env.ts`). Each page's server component then renders in the browser against that local data. The export, sync and assistant endpoints are answered client-side (`src/lib/local/boot.tsx`, `sync.ts`, `assistant.ts`), using the same sync and assistant code as the server. Google sign-in for browsers lives in `src/lib/local/google.ts`.

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
| `ANTHROPIC_API_KEY` | optional | Claude API key. Without it the built-in assistant answers. |
| `AI_MODEL`, `AI_EXTRACTION_MODEL` | optional | Default `claude-opus-5-5`. Also supported: `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-2`. |
| `AI_EFFORT` | optional | `low`, `medium` (default) or `high`: how much reasoning Claude spends per answer. |

Any integration without its variables simply shows a **"requires setup"** card listing exactly what's missing.

---

## Integrations — what you need and what it costs

### Gmail + Google Calendar (free)

1. Google Cloud Console → new project → enable **Gmail API** and **Google Calendar API**.
2. OAuth consent screen: *External*, add your own Google account as a **test user**, add the scopes `gmail.readonly` and `calendar.readonly`.
3. Credentials → OAuth client ID → *Web application* → authorised redirect URI: `<APP_URL>/api/integrations/google/callback`.
4. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, then Settings → Connected Accounts → Connect Gmail and Calendar. Use **Add another Google account** for each further mailbox (add each address as a test user in step 2).

Notes:
- Only **read-only** scopes are requested; the app cannot send, delete, label or modify mail or events.
- Each Google account is its own connection with its own encrypted token, sync cursor and status. Mail from all of them is shown together, labelled by mailbox, and each can be checked, reconnected or disconnected on its own. Syncing or disconnecting one account never touches another account's emails or calendar events.
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

### The assistant: built-in (free) and Claude (optional, paid, usage-based)

**Built-in assistant.** Works with no configuration and sends nothing anywhere. It understands everyday questions with language rules (`src/lib/ai/nlu.ts`), runs the same read-only data tools Claude would use, and writes the answer from the exact figures those tools return (`src/lib/ai/builtin.ts`). It covers spending totals, categories, merchants, biggest purchases, income, savings, comparisons, budgets, balances, subscriptions (cost, forgotten, trials, price changes), upcoming payments, calendar, email search, an email digest, unusual charges and a full check-up. When it can't work out a question it says so; it never guesses.

**Claude.** Set `ANTHROPIC_API_KEY`, then **opt in** under Settings → Privacy & Security. Both switches are off by default.

- **Assistant:** your question and the specific figures the assistant looks up (via 19 tools over your own data: totals, matching transactions, subscriptions, upcoming items, budgets, cash flow, unusual charges, extracted email fields per mailbox — never email bodies) are sent to Anthropic. Conversations are not stored by the app. Rate limited per user.
- **AI email extraction:** the text of likely receipts/bills/bookings (capped at 12 000 characters each) is sent to improve extraction; without it, extraction uses the built-in rules only.
- Server-side refusal fallback (`fallbacks: "default"`) is enabled on Claude requests where the model offers it.
- If Claude can't be reached or the key is rejected, the built-in assistant answers instead and the answer says so.
- Charts and tables under an answer are built from the tool results themselves (`src/lib/ai/cards.ts`), not from text the model wrote.
- The cost shown per answer is an estimate from the token counts and Anthropic's list prices at the time of writing (`src/lib/ai/models.ts`).

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
- **GitHub Pages edition** — there is no server and no database: data stays in the browser. Google access is a read-only pass of about an hour, held in `sessionStorage` and never persisted; the sign-in response is checked against a one-time `state` value, and the token is removed from the address bar immediately. An Anthropic key, if you add one, stays in `localStorage` and is excluded from exports. A Content-Security-Policy limits connections to the site itself, Anthropic and Google's read-only APIs.

---

## Testing

```bash
npm test
```

There are 135 unit tests. They cover the categoriser, transfer pairing, recurring and price-change detection, the CSV parser across bank layouts, Enable Banking mapping and JWT signing, email MIME parsing, classification and extraction (nl/fr/en fixtures), the Gmail sync against mocked API responses, the calendar sync against mocked responses (including several Google accounts side by side), the Google sign-in URL, timezone/DST handling, subscription helpers, report helpers, the in-browser database used by the GitHub Pages edition, and the assistant: question understanding (intents, periods, merchants, follow-ups), built-in answers checked against sample data, the Claude loop against a mocked streaming API, and the fallback to the built-in assistant.

```bash
npm run typecheck && npm run lint && npm run build
```

End-to-end flows were exercised with Playwright against a local Supabase stack: sign-up, CSV import (and re-import without duplicates), recategorisation rules, manual entries, exports, demo data, every page, the full cancellation flow, notifications, the built-in assistant and a full check-up, the RLS isolation checks, and delete-all-data.

The GitHub Pages build was tested the same way, served under a `/finance-checker/` base path like GitHub Pages:
- CSV import and persistence across reloads, demo data, every page, deep links to subscription details, the cancellation flow, both exports, delete-all, and the phone layout.
- The assistant: check-up, cards, follow-ups, merchant and period questions, and the fall-back when a question isn't understood.
- Claude with the user's own key, against a **simulated** Anthropic API: key check, streaming answer with tool use, model and depth settings, cost display, and the switch to the built-in assistant when the key is rejected.
- Two Google accounts, against a **simulated** Google: sign-in parameters (read-only scopes, account chooser), both mailboxes shown together and filtered, calendar events from both, read-only requests only, the one-tap and automatic refresh of expired passes, an account that needs reconnecting, a forged sign-in response being refused, disconnecting one account without touching the other, and that no token, key or email body ends up in the data store or the export.

---

## Known limitations / next steps

- Live Google, Enable Banking and Claude calls need your credentials; in development they were verified against mocked or simulated API responses, not live accounts. That includes the browser-side Google sign-in of the GitHub Pages edition: the first real sign-in is its first real test.
- The GitHub Pages edition can only check mail while it is open, and Google's read-only pass lasts about an hour, so a check after that needs a hop to Google and back (one tap, or automatic if you switch it on). The full edition syncs daily in the background.
- The built-in assistant understands English questions only, and only the kinds of question listed above; Claude handles everything else.
- Outlook / Microsoft 365 mail isn't supported yet; the email pipeline (`src/lib/email`) is provider-agnostic, so a Microsoft Graph client is the main missing piece.
- Notifications are in-app only (no email or push delivery yet).
- Amounts in other currencies are displayed as-is (no FX conversion).
- "Today" boundaries for month/week totals are computed in the server's timezone; display is always in Europe/Brussels. On a UTC server that shifts day boundaries by 1–2 hours.
- The assistant's rate limiter is in-memory (per server instance).
