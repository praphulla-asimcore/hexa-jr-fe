# Jr Finance Exec — Claude Context

## What this app is

Internal finance operations tool for **Hexamatics** (hexamatics.finance). Used by the finance team to:
- Process consultant (CSI) and internal payroll journal entries into Zoho Books
- Run PIR (Payment Instruction Request) checks, approval workflows, and bank file generation
- View the consultant database (sourced live from Airtable)
- Manage bank beneficiary registry

Deployed at: `https://hexajrfe.hexamatics.finance` via Vercel.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite, plain CSS (no UI library) |
| Backend | Express.js (`server/`) |
| Database | Supabase (PostgreSQL) |
| Accounting | Zoho Books API |
| Consultant data | Airtable (`EOR Employee Master` table) |
| Auth | JWT stored in localStorage (`hx_token`) |
| Deploy | Vercel — `api/index.js` re-exports `server/index.js` |

---

## Project layout

```
client/src/
  screens/          # One file per page
    Dashboard.jsx
    BankBeneficiaries.jsx   # Now pulls live from Airtable (Consultant Database)
    FinanceOps.jsx          # PIR check, approval, bank file generation
    Upload.jsx / GlSelection.jsx / JeReview.jsx / Summary.jsx  # CSI/Payroll flow
  components/
    Sidebar.jsx     # Nav: dashboard | csi | payroll | finops | beneficiaries
    AdminPanel.jsx
  data/
    beneficiaryData.js  # Static bank registry (246 registered + 17 pending upload)
                        # Kept as-is for bank upload status; Airtable is separate

server/
  index.js          # Express app, mounts all routes
  routes/
    parse.js        # CSV/XLSX parsing for upload flow
    postJe.js       # Posts journals to Zoho Books
    accounts.js     # GL account lookup
    finops.js       # PIR check, approval tokens, bank file generation
    auth.js         # Login / invite / JWT
    users.js        # User management
    journalHistory.js
    consultants.js  # Airtable proxy → GET /api/consultants
  services/
    zoho.js         # Zoho Books API wrapper
    db.js           # Supabase client
    email.js        # Resend email service
  config/
    orgs.json       # Multi-org Zoho config
    admin.json      # Admin settings

supabase/schema.sql   # Tables: users, journal_posts, pir_approvals
```

---

## Environment variables

### `server/.env`
```
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
PORT=3001
AIRTABLE_API_KEY=<redacted — set in Vercel dashboard and server/.env>
AIRTABLE_BASE_ID=approRZLeSBhOJE8q
AIRTABLE_TABLE_NAME=EOR Employee Master
AIRTABLE_VIEW_ID=viwjIrNQZYgFCcuK9
```

Vercel env vars must be set in the Vercel project dashboard (same keys).

---

## Key data flows

### CSI / Payroll journal flow
1. User uploads CSV/XLSX → `POST /api/parse` → returns entities + amounts
2. User maps GL accounts → frontend builds journal entries
3. `POST /api/post-je` → Zoho Books `/books/v3/journals`
4. Summary screen shows results

### Finance Ops (PIR)
1. User uploads PIR Excel → parsed server-side
2. PIR data saved to `pir_approvals` table in Supabase
3. Approval email sent via Resend to reviewer/approver
4. Approver clicks link → `GET /api/finops/approve/:token`
5. On approval, bank file (RCgen `.txt` format) is generated and emailed

### Consultant Database
- `GET /api/consultants` — server fetches all pages from Airtable, maps fields, returns JSON
- Frontend (`BankBeneficiaries.jsx`) fetches on mount, shows searchable table
- Airtable table: `EOR Employee Master` in base `approRZLeSBhOJE8q`
- Fields used: Full Legal Name, Employee Number, Employee ID, ID Number, Client Name,
  Contract Start Date, Contract End Date, Current Monthly Salary, Bank Name, Bank Account Number

---

## Auth model
- Roles: `admin` | `user` (stored in Supabase `users` table)
- Invite flow: admin sends invite → user sets password via token link `/accept-invite?token=...`
- JWT verified server-side on protected routes via `x-auth-token` header

---

## Where we left off (2026-05-28)

**In progress: Airtable integration for Consultant Database**

The `beneficiaries` sidebar section is being transformed from a static data view into a live Consultant Database fed by Airtable:
- `server/routes/consultants.js` — new route proxying Airtable REST API with pagination
- `BankBeneficiaries.jsx` — updated to fetch `/api/consultants`, new column layout
- `Sidebar.jsx` — label changed from "Bank Beneficiaries" to "Consultant Database"

The old static `beneficiaryData.js` is kept untouched (used for bank upload registry separately).

**Next things to consider:**
- Vercel env vars need AIRTABLE_* keys added in dashboard
- Salary column visibility: decide if it should be hidden by default (sensitive)
- Contract status badge: auto-derived from Contract End Date vs today
