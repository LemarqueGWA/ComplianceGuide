// Human-friendly checklist names for scenario document keys. Without this map,
// keys title-case to junk (e.g. asisa_replacement -> "Asisa Replacement").
// Used by checklist.js: label = DOC_LABELS[key] || prettyLabel(key).
export const DOC_LABELS = {
  disclosure_letter: 'Disclosure / Introduction Letter',
  broker_appointment: 'Broker Appointment / Letter of Authority',
  gwa_mandate: 'GWA Mandate',
  client_service_request: 'Client Service Request',
  cdd_form: 'CDD Form (new client)',
  cdd_form_existing: 'CDD Form (existing client)',
  suitability_questionnaire: 'Personal Investor Suitability Questionnaire',
  investment_proposal: 'Investment Proposal',
  portfolio_allocation: 'Investment Portfolio Allocation Summary',
  profile_confirmation: 'Personal Investor Profile Confirmation',
  advice_agreement: 'Advice Agreement for Investments',
  fica_id_proof: 'FICA Documents (ID & proof of address)',
  easefica_risk_rating: 'Client Risk Rating (EaseFICA report)',
  pep_screening: 'PEP Screening',
  transaction_register: 'Transaction Register',
  asisa_replacement: 'Replacement (ASISA)',
  product_review_declaration: 'Product Review Declaration',
};
