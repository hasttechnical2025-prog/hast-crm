-- SCRIPT TẠO BẢNG DÀNH RIÊNG CHO SCHEMA hast_crm
-- Hãy chạy toàn bộ script này trong SQL Editor của Supabase

-- 1. DEPARTMENTS
CREATE TABLE IF NOT EXISTS hast_crm.departments (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 2. USERS
CREATE TABLE IF NOT EXISTS hast_crm.users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    salt TEXT,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    avatar TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin', 'boss', 'manager', 'staff')),
    department_id TEXT REFERENCES hast_crm.departments(id),
    position TEXT,
    status TEXT DEFAULT 'active',
    failed_login_count INT DEFAULT 0,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 3. SESSIONS
CREATE TABLE IF NOT EXISTS hast_crm.sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES hast_crm.users(id),
    token TEXT NOT NULL,
    expired_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 4. SETTINGS
CREATE TABLE IF NOT EXISTS hast_crm.settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 5. AUDIT LOG
CREATE TABLE IF NOT EXISTS hast_crm.audit_log (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    changes TEXT,
    ip_address TEXT
);

-- 6. CUSTOMERS
CREATE TABLE IF NOT EXISTS hast_crm.customers (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    visibility TEXT DEFAULT 'private',
    approval_status TEXT DEFAULT 'pending',
    classification TEXT,
    tags TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT REFERENCES hast_crm.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 7. CONTACTS
CREATE TABLE IF NOT EXISTS hast_crm.contacts (
    id TEXT PRIMARY KEY,
    customer_id TEXT REFERENCES hast_crm.customers(id),
    code TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 8. TAGS
CREATE TABLE IF NOT EXISTS hast_crm.tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 9. PRODUCTS
CREATE TABLE IF NOT EXISTS hast_crm.products (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    price NUMERIC,
    external_code TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 10. OPPORTUNITIES
CREATE TABLE IF NOT EXISTS hast_crm.opportunities (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    customer_id TEXT REFERENCES hast_crm.customers(id),
    title TEXT NOT NULL,
    value NUMERIC,
    stage TEXT,
    probability INT,
    close_date DATE,
    assigned_to TEXT REFERENCES hast_crm.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT REFERENCES hast_crm.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 11. QUOTES
CREATE TABLE IF NOT EXISTS hast_crm.quotes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    opportunity_id TEXT REFERENCES hast_crm.opportunities(id),
    customer_id TEXT REFERENCES hast_crm.customers(id),
    title TEXT NOT NULL,
    value NUMERIC,
    status TEXT,
    validity_date DATE,
    assigned_to TEXT REFERENCES hast_crm.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT REFERENCES hast_crm.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 12. ORDERS
CREATE TABLE IF NOT EXISTS hast_crm.orders (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    quote_id TEXT REFERENCES hast_crm.quotes(id),
    opportunity_id TEXT REFERENCES hast_crm.opportunities(id),
    customer_id TEXT REFERENCES hast_crm.customers(id),
    title TEXT NOT NULL,
    total_amount NUMERIC,
    paid_amount NUMERIC DEFAULT 0,
    status TEXT,
    payment_status TEXT,
    due_date DATE,
    assigned_to TEXT REFERENCES hast_crm.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT REFERENCES hast_crm.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 13. ORDER_ITEMS
CREATE TABLE IF NOT EXISTS hast_crm.order_items (
    id TEXT PRIMARY KEY,
    parent_type TEXT NOT NULL, -- 'quote' or 'order'
    parent_id TEXT NOT NULL,
    product_id TEXT REFERENCES hast_crm.products(id),
    quantity INT DEFAULT 1,
    unit_price NUMERIC,
    amount NUMERIC,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 14. SUPPORT_TICKETS
CREATE TABLE IF NOT EXISTS hast_crm.support_tickets (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    customer_id TEXT REFERENCES hast_crm.customers(id),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    priority TEXT,
    status TEXT,
    assigned_to TEXT REFERENCES hast_crm.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT REFERENCES hast_crm.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 15. ACTIVITIES
CREATE TABLE IF NOT EXISTS hast_crm.activities (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    customer_id TEXT REFERENCES hast_crm.customers(id),
    type TEXT,
    subject TEXT NOT NULL,
    description TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    status TEXT,
    assigned_to TEXT REFERENCES hast_crm.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT REFERENCES hast_crm.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 16. CAMPAIGNS
CREATE TABLE IF NOT EXISTS hast_crm.campaigns (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    status TEXT,
    start_date DATE,
    end_date DATE,
    budget NUMERIC,
    revenue NUMERIC,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT REFERENCES hast_crm.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 17. NOTES
CREATE TABLE IF NOT EXISTS hast_crm.notes (
    id TEXT PRIMARY KEY,
    parent_type TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    title TEXT,
    content TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT REFERENCES hast_crm.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 18. MESSAGES
CREATE TABLE IF NOT EXISTS hast_crm.messages (
    id TEXT PRIMARY KEY,
    channel TEXT,
    direction TEXT,
    content TEXT NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT,
    sender_user_id TEXT REFERENCES hast_crm.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 19. WORKFLOWS
CREATE TABLE IF NOT EXISTS hast_crm.workflows (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    workflow_type TEXT NOT NULL, -- sales, installation, maintenance
    entity_type TEXT NOT NULL, -- order, ticket
    entity_id TEXT NOT NULL,
    current_stage TEXT,
    current_dept TEXT,
    assigned_to TEXT REFERENCES hast_crm.users(id),
    priority TEXT,
    due_date DATE,
    history JSONB,
    status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT REFERENCES hast_crm.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 20. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS hast_crm.notifications (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    user_id TEXT REFERENCES hast_crm.users(id),
    type TEXT,
    title TEXT NOT NULL,
    message TEXT,
    entity_type TEXT,
    entity_id TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    priority TEXT DEFAULT 'normal',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by TEXT,
    is_deleted BOOLEAN DEFAULT FALSE
);
