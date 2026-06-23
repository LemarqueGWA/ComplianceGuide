// CRM section header text → internal section key
export const SECTIONS = {
  'PERSONAL DETAILS: CLIENT': 'client',
  'PERSONAL DETAILS: SPOUSE': 'spouse',
  'FICA / AML related information: Client': 'fica',
  'FAIS information: Client': 'fais',
  'CONTACT DETAILS': 'contact',
  'BANK DETAILS': 'bank',
  'WILL DETAILS': 'will',
  'Client reviews': 'review',
};

// Personal fields shared by client + spouse (same labels, different prefix)
const PERSONAL = {
  'Surname': 'surname',
  'First names': 'first_names',
  'Initials': 'initials',
  'Title': 'title',
  'Nick name': 'nickname',
  'Date of birth': 'dob',
  'ID number': 'id_number',
  'Passport number': 'passport',
  'Gender': 'gender',
  'Nationality': 'nationality',
  'Marital status': 'marital_status',
  'Marital date': 'marital_date',
  'Maiden name': 'maiden_name',
  'Place of birth': 'place_of_birth',
  'Home language': 'home_language',
  'Correspondence language': 'corr_language',
  'Age next birthday': 'age_next',
  'Tax number': 'tax_number',
  'Tax office': 'tax_office',
  'Is smoker?': 'smoker',
  'Company': 'company',
  'Office': 'office',
  'External reference': 'ext_ref',
};

const prefixed = (prefix) =>
  Object.fromEntries(Object.entries(PERSONAL).map(([k, v]) => [k, `${prefix}_${v}`]));

export const LABELS = {
  client: prefixed('client'),
  spouse: prefixed('spouse'),
  fica: {
    'Risk rating': 'fica_risk_rating',
    'Risk rating date': 'fica_risk_rating_date',
    'Aml frozen status': 'fica_frozen_status',
  },
  fais: {
    'Risk profile': 'fais_risk_profile',
    'Risk tolerance': 'fais_risk_tolerance',
    'Client mandate': 'fais_mandate',
    'Mandate date': 'fais_mandate_date',
    'Investment objective': 'fais_invest_objective',
  },
  contact: {
    'Tel. (Cell phone)': 'contact_cell',
    'Email (Private)': 'contact_email',
    'Residential Address': 'contact_address',
  },
  will: {
    'Has a local (SA) will?': 'will_has_local',
    'Has a offshore will?': 'will_has_offshore',
    'Has living will?': 'will_has_living',
    'Has estate planning been done?': 'will_estate_planning',
    'Executor': 'will_executor',
  },
  review: {
    'Frequency': 'review_frequency',
    'Review start date': 'review_start_date',
  },
};
