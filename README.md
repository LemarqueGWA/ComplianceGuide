# GWA Document Pre-population Dashboard (v1 — Investment line)

DRAFT tool. Advisers only. All client data stays in the browser — nothing is uploaded to a server.

## Run
Serve over http (ES modules + fetch require it — do not open index.html via file://):

    python3 -m http.server 8765

Open http://localhost:8765/

## Use
1. Upload a CRM "Client Information Summary" PDF.
2. Pick a scenario.
3. Review the compliance checklist and edit the form fields (auto-filled fields are editable; manual fields start blank).
4. Click Generate — downloads a zip of pre-populated DRAFT PDFs plus the compliance checklist.

## Scope (v1)
Investment line. 5 templates, 5 scenarios. Profile data only (no financials).
All outputs are DRAFTS requiring compliance review (CLAUDE.md §5 #1). Not yet committee-ratified — see below.

## Tests
    npm test

A POPIA-safe anonymised sample CRM PDF for manual testing is at:
`test/fixtures/sample-client-info.pdf` (all fictitious data).

## Adding templates / scenarios
- Drop a field-named PDF in `templates/`, add it to `config/templates.json`.
- Reference it from `config/scenarios.investment.json`.
- Field names matching CRM tokens (see the field-naming standard PDF in 03_Reference) auto-fill;
  any other field becomes a manual input. No code change needed.
- E-sign / signature fields (type Sig, names containing `_es_:`, or starting "Signature") are never written.

## Architecture
Pure client-side: pdf.js (parse) → CRM token map → field resolver (auto/manual/skip) →
pdf-lib (fill + DRAFT stamp) → JSZip (bundle). Logic modules in `js/` are pure and Node-tested.
Browser resolves the bare `pdf-lib`/`jszip` imports via an import map → shim files re-exporting
the vendored UMD globals (`vendor/`).

## Committee ratification (required before adviser use)
Per CLAUDE.md §10, no tool deploys to advisers without GWA AI Committee sign-off.
This build + its spec/plan (docs/superpowers/) must be reviewed and ratified first.
