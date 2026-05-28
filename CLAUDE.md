# Jr Finance Exec — Claude Context

## What this app is

Internal finance operations tool for **Hexamatics** (hexamatics.finance). Used by the finance team to:
- Run the full 10-step CSI and Payroll workflow (upload → check → approval → bank file → payment approval → Zoho posting)
- View the live Consultant Database (sourced from Airtable)
- Dashboard with journal history and stats

Deployed at: `https://hexajrfe.hexamatics.finance` via Vercel.
GitHub: `praphulla-asimcore/hexa-jr-fe` (main branch → auto-deploys to Vercel)

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
| Email | Resend (`RESEND_API_KEY`) |
| PDF | pdfkit (server-side, installed in root + server) |

---

## Project layout

```
client/src/
  screens/
    PayrollFlow.jsx         # 10-step CSI/Payroll workflow (main feature)
    PayrollFlow.css
    BankBeneficiaries.jsx   # Live Consultant Database from Airtable
    Dashboard.jsx
    Login.jsx / AcceptInvite.jsx
    GlSelection.jsx / JeReview.jsx / Upload.jsx / Summary.jsx  # Legacy (still present)
  components/
    Sidebar.jsx             # Nav: dashboard | csi | payroll | consultant db
    AdminPanel.jsx
    Logo.jsx
  orgsConfig.js             # Entity code → Zoho org ID + full name mapping

server/
  index.js                  # Express app, mounts all routes
  routes/
    payroll-cases.js        # ★ Main 10-step payroll workflow (all steps)
    consultants.js          # Airtable proxy → GET /api/consultants
    accounts.js             # GL account lookup from Zoho
    postJe.js               # Legacy JE posting
    parse.js                # CSV/XLSX parsing
    auth.js / users.js      # Auth + user management
    journalHistory.js
    finops.js               # Legacy PIR workflow (kept but removed from UI)
  services/
    zoho.js                 # Zoho Books API wrapper (journals, expenses, attachments)
    db.js                   # Supabase client
    email.js                # Resend email service
    parser.js               # Excel parser
  config/
    orgs.json               # Entity code → Zoho org ID mapping (server-side)
    admin.json

supabase/
  schema.sql                # Original tables
  payroll_cases_schema.sql  # ★ New tables for 10-step workflow
```

---

## Supabase tables

**Original:**
- `users` — auth, roles (admin | user)
- `journal_posts` — history of Zoho journal entries
- `pir_approvals` — legacy PIR workflow

**New (payroll workflow):**
- `payroll_cases` — one row per CSI/Payroll run, all step data
- `payroll_approval_tokens` — email approval links (step 3 + step 6)
- `payroll_audit_log` — immutable event log per case

**Columns added via ALTER TABLE (not in original schema file):**
```sql
ALTER TABLE payroll_cases ADD COLUMN IF NOT EXISTS payment_date DATE;
ALTER TABLE payroll_cases ADD COLUMN IF NOT EXISTS bank_receipt_name TEXT;
ALTER TABLE payroll_cases ADD COLUMN IF NOT EXISTS bank_receipt_data TEXT;
ALTER TABLE payroll_cases ADD COLUMN IF NOT EXISTS bank_receipt_attached_at TIMESTAMPTZ;
```

---

## Environment variables (Vercel dashboard + server/.env)

```
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
ZOHO_DOMAIN=com
PORT=3001
JWT_SECRET=hexa-jwt-secret-change-in-prod
APP_URL=https://hexajrfe.hexamatics.finance
EMAIL_FROM=noreply@hexamatics.finance
RESEND_API_KEY=
AIRTABLE_API_KEY=<redacted>
AIRTABLE_BASE_ID=approRZLeSBhOJE8q
AIRTABLE_TABLE_NAME=EOR Employee Master
BANK_CORPORATE_ID=MYMHEXAMATI
BANK_GROUP_ID=MYMHEXA1D
BANK_DEBIT_ACCOUNT=
BANK_NOTIFY_EMAILS=
```

---

## Organisations (orgsConfig.js + server/config/orgs.json)

| Code | Full Name | Zoho Org ID |
|------|-----------|-------------|
| HCSSB | Hexa Consulting Services Sdn Bhd | 897668064 |
| APHHR | HexaHR Sdn Bhd | 883796614 |
| HCI | Hexamatics Consulting Inc. | 768663054 |
| HMCL | Hexamatics Myanmar Company Ltd | 768663052 |
| HNPL | Hexamatics Nepal Private Limited | 804163623 |
| HSSB | Hexamatics Servcomm Sdn Bhd | 762447369 |
| HSPL | Hexamatics Singapore Pte. Ltd | 753289306 |
| PTHIT | PT Hexamatics Info Tech | 768662733 |

---

## 10-Step CSI/Payroll Workflow

Both CSI and Payroll tabs use `PayrollFlow.jsx` with the same steps.

**Reference format:** `CSI-HSSB-202506-001` or `PAYROLL-HCSSB-202506-001`

### Workflow statuses (in order)
`uploaded → check_generated → check_approval_sent → check_reviewer_approved → check_approved → bank_file_generated → bank_uploaded → payment_approval_sent → payment_approved → zoho_posted`

### Steps

| Step | What happens | Key route |
|------|-------------|-----------|
| 1 | Upload Excel + SHA-256 hash + IP stamp | `POST /api/payroll-cases/upload` |
| 2 | Rule-based check file (totals, CTC variance, flags) | `POST /api/payroll-cases/:id/gen-check` |
| 3 | Email approval (Asim → Praphulla) + auto-generate bank files on final approval + optional Zoho accrual booking (DR Salary Expense / CR Salary Payable per consultant) | `POST /api/payroll-cases/:id/send-check-approval` |
| 4 | Auto-generates RCMS XLSX + RCgen TXT from Airtable bank data — triggered on final approval | `POST /api/payroll-cases/:id/gen-bank-file` |
| 5 | FE logs bank portal ref → clicks "Payment Ready for Approval" → sends director email | `POST /api/payroll-cases/:id/log-bank-upload` + `send-payment-approval` |
| 6 | Director approves via email link OR "Payment Approved in Bank" in-app button | `GET /api/payroll-cases/director/:token` + `POST /api/payroll-cases/:id/confirm-payment` |
| 7 | Book payment clearing in Zoho: DR Salary Payable / CR Bank — one expense per consultant | `POST /api/payroll-cases/:id/post-zoho` |
| 8 | FP&A sub-ledger (informational placeholder) | — |
| 9 | Audit package PDF download (all documents + audit log) | Frontend only |
| 10 | Compliance controls (always green, informational) | — |

### Approvers
- **Step 3 First Reviewer:** Asim Subedi — `asim.ovc977@gmail.com`
- **Step 3 Final Approver:** Praphulla Subedi — `praphulla@hexamatics.com`
- **Step 6 Director:** Dato Thiruchelvapalan — `tripathisonee@gmail.com` *(temp)*

### Zoho accounting flow
- **Step 3** (optional): Book `DR Salary Expense / CR Salary Payable` — one journal per consultant (accrual)
- **Step 7**: Book `DR Salary Payable / CR Bank` — one expense per consultant (payment clearing)
- After Step 7: Check Report PDF + Audit Package PDF auto-attached to first accrual journal

### Bank file generation (Step 4)
- Triggered automatically when final approver approves
- Fetches bank details from Airtable (matched by employee number/name)
- Generates two files:
  - `RCMS_BankUpload_{ref}_{date}.xlsx` — 31-column RCMS format
  - `RCgen_Payment_DP_{timestamp}.txt` — pipe-delimited RCgen format
- Both stored as base64 in `payroll_cases.bank_file_data` and `bank_receipt_data`

---

## Consultant Database

- `GET /api/consultants` — server fetches from Airtable with pagination
- Uses `cellFormat=string` + `timeZone=Asia/Kuala_Lumpur` + `userLocale=en-MY`
- Airtable base: `approRZLeSBhOJE8q`, table: `EOR Employee Master`
- Fields: Full Legal Name, Employee Number, Employee ID, ID Number, Client Name, Contract Start/End Date, Current Monthly Salary, Bank Name, Bank Account Number

---

## UI Design

- **Login page:** Full-screen dark gradient with animated floating orbs, glassmorphism card
- **Sidebar:** Dark (`#0b0b16`), gradient active states, user initials avatar
- **Cards:** White with multi-layer purple-tinted shadows, hover lift
- **Primary gradient:** `#6366f1 → #8b5cf6 → #06b6d4`
- **Screen titles:** Gradient text

---

## Auth model
- Roles: `admin` | `user`
- Invite flow: admin sends invite → user sets password via `/accept-invite?token=...`
- JWT in `x-auth-token` header

---

## Considered / Pending features

### Invoicing section (not yet built)
- User discussed adding an **Invoicing** tab after Payroll in the sidebar
- Would take client details, billing amount, description
- Auto-creates invoice in Zoho Books via `POST /books/v3/invoices`
- Could auto-populate from CSI case data (consultant count, billing amount, period)
- **Decision pending** — user said "let me make up my mind"

---

## State as of 2026-05-29

- Full 10-step workflow live and deployed
- Finance Ops (PIR) removed from sidebar UI (backend routes still exist)
- Zoho PDF attachment uses `form-data` package (fixed multipart boundary bug)
- `pdfkit` installed for server-side PDF generation
- Delete available for unfinished cases only (not `zoho_posted`)
- Step 3 GL section persists while approval is pending
- Step 7 orgId auto-detects from `kase.entity` code (fixes blank panel bug)
