const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ WARNING: SUPABASE_URL hoặc SUPABASE_ANON_KEY chưa được thiết lập');
}

const supabase = createClient(supabaseUrl || 'https://example.supabase.co', supabaseAnonKey || 'anon_key', {
  auth: {
    persistSession: false
  },
  db: {
    schema: 'public'
  }
});

const CONSTANTS = {
  JWT_SECRET: process.env.JWT_SECRET || 'hast_crm_default_secret_key_123',
  CODE_PREFIXES: {
    crm_customers: 'KH',
    crm_contacts: 'LH',
    crm_opportunities: 'CH',
    crm_quotes: 'BG',
    crm_orders: 'DH',
    crm_activities: 'HD',
    crm_support_tickets: 'TK',
    crm_campaigns: 'CD',
    crm_products: 'SP',
    crm_notifications: 'NT'
  }
};

module.exports = {
  supabase,
  CONSTANTS
};