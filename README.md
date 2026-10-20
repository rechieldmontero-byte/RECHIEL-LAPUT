# Scholarship Monitoring System — SAD Laboratory Examination

## Included
- Sign-in page: `index.html`
- Scholar registration: `register.html`
- Dashboard: `dashboard.html`
- Shared Supabase client and page scripts: `js/supabase.js`, `js/login.js`, `js/auth.js`, `js/dashboard.js`
- Supabase schema, RLS policies and controlled workflow RPCs: `supabase/schema.sql`
- Synthetic seed instructions: `supabase/seed.sql`
- Analysis baseline and test template: `ANALYSIS_AND_TESTS.md`

## Setup
1. Create a Supabase project.
2. Create the first staff account in Authentication > Users.
3. Open `supabase/schema.sql` and verify that the staff email at the bottom (`SMS@gmail.com`) matches the account created in Authentication > Users. Run this single schema-and-staff-setup file in Supabase SQL Editor as the project owner. The staff account must exist before the profile bootstrap can link it. This script matches the existing schema columns (`verification`, `compliance`, `renewal`, `min_enrolled_units`) and does not drop existing records.
4. Create scholar test accounts in Authentication > Users. Use unique synthetic emails and passwords; share credentials privately with the instructor, never in source code.
5. Sign in as staff and register/assign each scholar in Scholar Management. The scholar profile is created/updated through the staff-only RPC.
6. The browser app is configured with the project's URL and public publishable key in `js/supabase.js`. Publishable keys are intended for browser use; never place a secret/service-role key there. RLS must still be correctly configured.
7. Run locally using VS Code Live Server or another static web server. Opening `index.html` directly may work, but a local server is recommended.
8. Test with separate staff and scholar accounts.

## Security notes
- Never put a Supabase service-role key, database password, or test account password in source code.
- RLS must be enabled. Do not treat hidden navigation or buttons as security.
- Before a real deployment, review all RLS policies and SECURITY DEFINER functions with your instructor/security reviewer.
- The application is an examination prototype, not a production scholarship decision service.
- The Registrar remains the source of official grades. Evidence is represented by a document reference; no Registrar API is integrated.

## Known limitations to verify/fix during the lab
- The UI is a minimum viable prototype. Test all RPCs and RLS behavior in the actual Supabase project.
- Scholars can correct and resubmit records returned by staff; the correction is saved through the controlled RPC and returns to Pending verification.
- New submissions and workflow actions are written to audit history. Confirm the expected entries and role isolation using separate accounts.
- The seed file documents the six required synthetic records; use the actual Auth UUIDs to seed records and avoid committing private identifiers.
- The first staff profile is linked by the schema script's final block; it only succeeds when its configured email matches an existing Auth user.
- Run the updated schema in Supabase SQL Editor to install workflow RPCs and RLS policies before testing the app.

## Test accounts
Create two or more synthetic accounts in Supabase Auth. Put test credentials in a separate private note for the instructor, not in this repository.
