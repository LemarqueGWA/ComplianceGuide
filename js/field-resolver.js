export function isEsignField(name, type) {
  if (type === 'Sig') return true;
  if (name.includes('_es_:')) return true;
  if (/^(Signature|Signed at|Signature Block|Client signature)/i.test(name)) return true;
  if (/^date$/i.test(name)) return true;
  return false;
}

/**
 * gateRevealedValues(values, reveals): returns a NEW values object with
 * conditionally-revealed text fields removed when their controlling checkbox is
 * not ticked. `reveals` maps checkboxField -> textField (template config). A
 * blank/untruthy checkbox means its paired text field must NOT be written to the
 * output PDF, even if a value lingers in state from an earlier tick.
 */
export function gateRevealedValues(values, reveals = {}) {
  const out = { ...values };
  for (const [checkbox, textField] of Object.entries(reveals || {})) {
    const ticked = values[checkbox] === 'Yes' || values[checkbox] === true;
    if (!ticked) delete out[textField];
  }
  return out;
}

// snake_case = starts with a lowercase letter, then lowercase / digits joined
// by single underscores. Generic Adobe field names ('Check Box14', 'Text1',
// 'Row1', bare numbers) fail this and are hidden from the dashboard.
export function isSnakeName(name) {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name);
}

export function prettyLabel(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inputTypeFor(name, type) {
  if (type === 'checkbox') return 'checkbox';
  if (name.endsWith('_date')) return 'date';
  if (name.endsWith('_amount')) return 'number';
  return 'text';
}

/**
 * classifyFields(fields, knownTokens):
 *   fields = [{ name, type }]  (type = AcroForm /FT without slash: 'Tx','Btn','Sig')
 *   knownTokens = Set of CRM token names that can be auto-filled
 * returns { auto:[{name,type}], manual:[{name,type,inputType,label}], skip:[{name,type}] }
 */
export function classifyFields(fields, knownTokens) {
  const auto = [], manual = [], skip = [];
  for (const f of fields) {
    if (isEsignField(f.name, f.type)) { skip.push(f); continue; }
    // Hide fields whose names don't follow snake_case (generic Adobe auto-names
    // carry no meaning and can't be auto-filled): keep the form clean.
    if (!isSnakeName(f.name)) { skip.push(f); continue; }
    if (knownTokens.has(f.name)) { auto.push(f); continue; }
    manual.push({ ...f, inputType: inputTypeFor(f.name, f.type), label: prettyLabel(f.name) });
  }
  return { auto, manual, skip };
}
