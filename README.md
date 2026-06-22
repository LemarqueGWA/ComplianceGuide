# GWA Document Pre-population Dashboard

**DRAFT tool · Advisers only · Confidential — internal GWA use (CLAUDE.md).**
Fills GWA compliance PDFs from a CRM "Client Information Summary" export and builds a
per-scenario compliance pack. **All client data stays in the browser — nothing is uploaded to any server.**

> Not yet ratified for adviser deployment — see **Governance** below.

**Hosted (always-latest, opens in browser):** https://lemarquegwa.github.io/ComplianceGuide/
GitHub Pages serves the live `main` — every push updates it automatically, no build step.
⚠️ This Pages site is **public** (anyone with the link). Confidentiality tradeoff accepted for now; revisit (private host / Cloudflare Access) before wide rollout.

---

## For advisers — the single-file version (no Terminal)

**`GWA_Dashboard.html`** is a self-contained, offline, double-click file — all libraries, the
template PDFs, the scenario config and the brand fonts/logo are baked in. Double-click → it opens
in the browser. No install, no server.

> The `.html` is a **build artifact** (git-ignored, ~15 MB). It is *not* in the repo — regenerate it
> (below) or get it from wherever the committee publishes the latest build. Never hand-edit it.

### Use
1. **Upload** the CRM Client Information Summary PDF.
2. **Scenario** — pick the **product line** (Investment / Long Term Insurance / Medical & GAP / Short Term), then the scenario.
3. **Checklist** — review required documents; answer each *conditional* (Yes/No); complete any required **verifications** (open the site, upload the result).
4. **Form fields** — grouped per document; auto-filled fields carry a `CRM` chip, manual fields start blank. Inline validation on dates / SA-ID.
5. **Generate** — downloads a `.zip` of pre-populated **DRAFT** PDFs + the compliance checklist (+ any uploaded verification files). Locked until required fields, conditionals and verifications are done. "Generate anyway" covers optional fields but **cannot** bypass verifications.

---

## For developers — run + build

Requires Node (for build/tests). From the repo root:

```bash
npm install                 # restores node_modules (NOT committed)
npm test                    # 41 unit tests (pure logic modules)
node build-standalone.mjs   # writes GWA_Dashboard.html (the adviser file)
```

Dev server (modular source uses ES modules + fetch — do **not** open index.html via file://):

```bash
python3 -m http.server 8765   # then open http://localhost:8765/
```

---

## Architecture

Pure client-side, no backend:

```
pdf.js (parse CRM PDF) → CRM token map → field resolver (auto / manual / skip)
   → pdf-lib (fill) → JSZip (bundle .zip)
```

- **Shared controller:** `js/ui.js` (`initDashboard({loadConfig, getTemplateBytes, listFields, extractItems})`) holds all UX. Two thin entries supply env-specific loaders:
  - `js/app.js` — dev server (fetch + pdf.js ES module).
  - `standalone/main.js` — offline file (reads `window.GWA_*` globals + a blob pdf.js worker).
- **pdf-lib / jszip** resolve via an import map → shim files re-exporting the vendored UMD globals in `vendor/`. The standalone inlines those UMD builds (esbuild-minified pdf-lib hangs on some AcroForms).
- **Field lists are pre-extracted at build** into `config/template-fields.json` + `window.GWA_TEMPLATE_FIELDS` (browser pdf-lib AcroForm parsing is pathologically slow on some PDFs).
- `js/` logic modules are pure and Node-tested.

---

## Configuration (no code changes needed)

| File | Purpose |
|---|---|
| `config/lines.json` | Product-line registry → each line's scenario file |
| `config/scenarios.investment.json` etc. | Per-line scenarios → required documents (status `required`/`conditional`, type `generate`/`collect`, optional `note`) |
| `config/templates.json` | Doc-key → field-named PDF + `docType` (+ optional `reveals` checkbox→detail map) |
| `config/verifications.json` | External link→upload gates (see below) |
| `js/doc-labels.js` | Friendly checklist names per doc key |
| `config/template-fields.json` | **Generated** by the build — do not hand-edit |

### Add a product line
Add a `scenarios.<line>.json` + register it in `config/lines.json`. Done — the line picker updates.

### Make a document auto-fill (instead of "attach manually")
Drop a field-named PDF in `templates/`, add it to `config/templates.json`, set the doc's `type` to `generate` in the scenario config, rebuild. Field names matching CRM tokens auto-fill; others become manual inputs. E-sign fields (type `Sig`, names with `_es_:`, or starting "Signature") are never written.

### Verification gate (link → upload → unlock Generate)
`config/verifications.json` — each item `{ id, label, url, accept, kind, docs }`. It applies to a scenario only if one of its `docs` is an active document there. Current:
- **EaseFICA** risk-rating report (PDF) → `https://admin.easefica.co.za` → satisfies `easefica_risk_rating`
- **Dilisense** PEP/sanctions screening (screenshot) → `https://dilisense.com/en` → satisfies `pep_screening` / `fic_tfs_screenshot`

The advisor opens each site, uploads the result; both files are added to the generated `.zip`.

---

## Product lines (from the GWA Compliance Guide)

| Line | Scenarios | Auto-fills (templates exist) |
|---|---|---|
| Investment | 5 | 9 templates (full) |
| Long Term Insurance | 9 | broker appointment / LoA, CDD, existing-CDD, client service request |
| Medical & GAP | 5 | broker appointment / LoA, client service request |
| Short Term | 6 | broker appointment / LoA |

Docs without a field-named PDF render as **collect** ("attach manually"). Missing fillable forms still to be supplied: Disclosure/Introduction Letter (all lines), Product Review Declaration (Medical/Short-Term), plus the line-specific advice agreements / RAR / Risk Product Review Declaration / Annual Review Letter.

---

## Tests
```bash
npm test
```
Anonymised, POPIA-safe sample CRM PDF for manual testing: `test/fixtures/sample-client-info.pdf` (all fictitious).

---

## Governance
- Every output is a **DRAFT** requiring compliance review (CLAUDE.md §5 #1).
- **No deployment to advisers without GWA AI Committee ratification** (CLAUDE.md §10).
- Outstanding before sign-off: Investment annual-review (row 6) anomaly in the source guide (Adri to confirm); the LTI/Medical/Short-Term doc→template assumptions; a real-machine generate-speed check.
