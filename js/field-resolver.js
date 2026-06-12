export function isEsignField(name, type) {
  if (type === 'Sig') return true;
  if (name.includes('_es_:')) return true;
  if (/^(Signature|Signed at|Signature Block|Client signature)/i.test(name)) return true;
  if (/^date$/i.test(name)) return true;
  return false;
}

export function prettyLabel(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inputTypeFor(name) {
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
    if (knownTokens.has(f.name)) { auto.push(f); continue; }
    manual.push({ ...f, inputType: inputTypeFor(f.name), label: prettyLabel(f.name) });
  }
  return { auto, manual, skip };
}
