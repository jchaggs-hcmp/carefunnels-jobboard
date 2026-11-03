'use strict';
// Creates a demo agency with sample jobs. Usage: npm run seed
const { agencies, jobs } = require('./db');
let a = agencies.bySlug('sunrise-home-care');
if (!a) {
  a = agencies.create({ name: 'Sunrise Home Care', slug: 'sunrise-home-care', website: 'https://example.com', brand_color: '#5b2a86', phone: '(555) 201-4400',
    street: '120 Main St', city: 'Columbus', state: 'OH', zip: '43215', about: 'Locally owned since 2009. Weekly pay, flexible scheduling, paid training and a team that treats you like family.' });
  const base = { city: 'Columbus', state: 'OH', zip: '43215', pay_unit: 'HOUR', status: 'open' };
  jobs.create(a.id, { ...base, title: 'Caregiver / Personal Care Aide', category: 'Caregiver', employment_type: 'PART_TIME', pay_min: 16, pay_max: 19, shifts: 'Days, Evenings, Weekends',
    summary: 'Help seniors stay independent at home with companionship, meals and personal care. No experience needed — we train.',
    description: 'As a Sunrise caregiver you will support clients in their own homes across Columbus.\n\nTypical duties:\n- Companionship and conversation\n- Light housekeeping and meal preparation\n- Bathing, dressing and mobility assistance\n- Medication reminders and errands',
    requirements: '- 18 years or older\n- Pass a background check\n- Reliable transportation preferred', benefits: '- Weekly pay & daily pay option\n- Paid training and CPR certification\n- Mileage reimbursement\n- Referral bonus' });
  jobs.create(a.id, { ...base, title: 'Certified Nursing Assistant (CNA)', category: 'CNA', employment_type: 'FULL_TIME', pay_min: 19, pay_max: 23, shifts: 'Days, Overnights',
    summary: 'Full-time CNA role with consistent clients and $500 sign-on bonus.', description: 'Provide hands-on personal care to clients with higher care needs.', requirements: '- Active Ohio CNA certification\n- 1+ year experience', benefits: '- $500 sign-on bonus\n- Health, dental & vision\n- PTO' });
  jobs.create(a.id, { ...base, title: 'Live-in Caregiver', category: 'Live-in Caregiver', employment_type: 'FULL_TIME', pay_min: 280, pay_max: 320, pay_unit: 'DAY', shifts: 'Live-in (3–4 day rotations)', city: 'Dublin',
    summary: 'Rotating live-in assignments with a long-term client.', description: 'Provide around-the-clock companionship and care in rotating shifts.' });
  jobs.create(a.id, { ...base, title: 'Home Health Aide (HHA)', category: 'HHA', employment_type: 'PER_DIEM', pay_min: 18, pay_max: 21, shifts: 'Weekends', city: 'Westerville', summary: 'Pick up weekend shifts on your schedule.' });
  console.log('Seeded demo agency.');
}
console.log(`Agency: ${a.name}\nAgency login key: ${a.api_key}`);
