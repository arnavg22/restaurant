-- ============================================================
-- CAFETERIA GREEN — COMPLETE DATABASE SCHEMA
-- PostgreSQL 16+
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USERS
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    phone           VARCHAR(15) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'customer'
                    CHECK (role IN ('customer', 'admin', 'delivery', 'developer')),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- 2. MENU ITEMS
-- ============================================================
CREATE TABLE menu_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    price           DECIMAL(10,2) NOT NULL CHECK (price > 0),
    category        VARCHAR(100) NOT NULL,
    image_url       VARCHAR(500),
    is_available    BOOLEAN DEFAULT true,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_menu_category ON menu_items(category);
CREATE INDEX idx_menu_available ON menu_items(is_available) WHERE is_available = true;

-- ============================================================
-- 3. DEALS / DISCOUNTS  (Only Developer can create/update)
--    Discount comes from the platform's 15% share ONLY.
--    Restaurant revenue is NEVER reduced by a deal.
-- ============================================================
CREATE TABLE deals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               VARCHAR(200) NOT NULL,        -- "Flat ₹50 off on ₹300+"
    description         TEXT,
    discount_type       VARCHAR(20) NOT NULL
                        CHECK (discount_type IN ('flat', 'percent')),
    discount_value      DECIMAL(10,2) NOT NULL CHECK (discount_value > 0),
    -- For percent type: max discount cap (null = no cap)
    max_discount_amount DECIMAL(10,2),
    -- Minimum order subtotal to qualify
    min_order_amount    DECIMAL(10,2) DEFAULT 0,
    -- Optional: specific menu item this applies to (null = whole order)
    applicable_item_id  UUID REFERENCES menu_items(id),
    -- Validity
    starts_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    -- Usage limits
    max_total_uses      INTEGER,                      -- null = unlimited
    current_uses        INTEGER DEFAULT 0,
    max_uses_per_user   INTEGER DEFAULT 1,
    -- Status
    is_active           BOOLEAN DEFAULT true,
    created_by          UUID NOT NULL REFERENCES users(id),  -- must be developer
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deals_active ON deals(is_active, starts_at, expires_at)
    WHERE is_active = true;

-- Track per-user usage of deals
CREATE TABLE deal_usage (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id     UUID NOT NULL REFERENCES deals(id),
    user_id     UUID NOT NULL REFERENCES users(id),
    order_id    UUID NOT NULL REFERENCES orders(id),
    used_at     TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(deal_id, order_id)  -- one deal per order
);

CREATE INDEX idx_deal_usage_user ON deal_usage(deal_id, user_id);

-- ============================================================
-- 4. ORDERS
-- ============================================================
CREATE TABLE orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number        VARCHAR(20) UNIQUE NOT NULL,
    user_id             UUID NOT NULL REFERENCES users(id),

    -- ── Delivery Information (MANDATORY before payment) ──
    -- These fields are NOT NULL + CHECK constraints ensure that
    -- an order CANNOT be created without complete delivery info.
    -- This is enforced at 3 levels:
    --   1. Frontend: form validation before "Pay" button is enabled
    --   2. Backend: validateDeliveryInfo() throws if any field is missing/invalid
    --   3. Database: NOT NULL + CHECK rejects empty strings
    delivery_name       VARCHAR(100) NOT NULL CHECK (LENGTH(TRIM(delivery_name)) >= 2),
    delivery_phone      VARCHAR(15) NOT NULL CHECK (LENGTH(delivery_phone) >= 10),
    building_name       VARCHAR(200) NOT NULL CHECK (LENGTH(TRIM(building_name)) >= 2),
    floor_seat          VARCHAR(100) NOT NULL CHECK (LENGTH(TRIM(floor_seat)) >= 2),
    delivery_notes      TEXT,

    -- ── Financial Breakdown ──
    -- subtotal       = sum of (item.price × quantity)  [menu price total]
    -- discount_amount= deal discount applied (from platform share only)
    -- customer_pays  = subtotal - discount_amount       [what user actually pays]
    -- platform_fee   = subtotal × 0.15                  [would-be commission]
    -- discount_from_platform = discount_amount          [reduces platform earnings]
    -- platform_earnings = platform_fee - discount_from_platform
    -- restaurant_share  = subtotal × 0.85              [NEVER reduced by deals]
    subtotal                DECIMAL(10,2) NOT NULL,
    discount_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
    customer_pays           DECIMAL(10,2) NOT NULL,
    platform_fee            DECIMAL(10,2) NOT NULL,       -- subtotal × 0.15
    discount_from_platform  DECIMAL(10,2) NOT NULL DEFAULT 0,
    platform_earnings       DECIMAL(10,2) NOT NULL,       -- platform_fee - discount_from_platform
    restaurant_share        DECIMAL(10,2) NOT NULL,       -- subtotal × 0.85
    
    -- Applied deal (nullable)
    applied_deal_id         UUID REFERENCES deals(id),

    -- ── Payment (Razorpay) ──
    razorpay_order_id       VARCHAR(100),                 -- Razorpay order ID
    razorpay_payment_id     VARCHAR(100),                 -- Razorpay payment ID (after success)
    razorpay_signature      VARCHAR(255),                 -- Webhook signature
    payment_verified        BOOLEAN DEFAULT false,
    paid_at                 TIMESTAMPTZ,

    -- ── Order Status ──
    status                  VARCHAR(30) NOT NULL DEFAULT 'pending_payment'
                            CHECK (status IN (
                                'pending_payment',
                                'placed',
                                'accepted',
                                'preparing',
                                'ready',
                                'out_for_delivery',
                                'delivered',
                                'cancelled',
                                'payment_expired'
                            )),

    -- ── Cancellation ──
    cancelled_by            UUID REFERENCES users(id),
    cancel_reason           TEXT,

    -- ── Settlement ──
    is_settled              BOOLEAN DEFAULT false,
    settled_at              TIMESTAMPTZ,

    -- ── Timestamps ──
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    delivered_at            TIMESTAMPTZ
);

CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_unsettled ON orders(is_settled, status)
    WHERE status = 'delivered' AND is_settled = false;
CREATE INDEX idx_orders_razorpay ON orders(razorpay_order_id);

-- Auto-generate human-readable order numbers
CREATE SEQUENCE order_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.order_number := 'GRN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                        LPAD(nextval('order_number_seq')::TEXT, 4, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_number
    BEFORE INSERT ON orders
    FOR EACH ROW
    WHEN (NEW.order_number IS NULL)
    EXECUTE FUNCTION generate_order_number();

-- ============================================================
-- 5. ORDER ITEMS (snapshot of menu item at order time)
-- ============================================================
CREATE TABLE order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id    UUID NOT NULL REFERENCES menu_items(id),
    item_name       VARCHAR(200) NOT NULL,    -- frozen snapshot
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      DECIMAL(10,2) NOT NULL,   -- frozen snapshot
    item_total      DECIMAL(10,2) NOT NULL,   -- quantity × unit_price
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================================
-- 6. ORDER LOGS (immutable audit trail)
-- ============================================================
CREATE TABLE order_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id),
    from_status     VARCHAR(30),
    to_status       VARCHAR(30) NOT NULL,
    changed_by      UUID REFERENCES users(id),
    changed_by_role VARCHAR(20),
    notes           TEXT,
    metadata        JSONB,                    -- extra context (payment details, etc.)
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_logs_order ON order_logs(order_id, created_at);

-- ============================================================
-- 7. SETTLEMENTS (periodic payout records)
-- ============================================================
CREATE TABLE settlements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    total_orders        INTEGER NOT NULL,
    gross_revenue       DECIMAL(12,2) NOT NULL,     -- sum of subtotal
    total_discounts     DECIMAL(12,2) NOT NULL,      -- sum of discounts given
    customer_revenue    DECIMAL(12,2) NOT NULL,      -- sum of customer_pays
    platform_fee_total  DECIMAL(12,2) NOT NULL,      -- sum of platform_fee
    platform_earnings   DECIMAL(12,2) NOT NULL,      -- sum of platform_earnings (after discounts)
    restaurant_payout   DECIMAL(12,2) NOT NULL,      -- sum of restaurant_share
    status              VARCHAR(20) DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed')),
    settled_at          TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. AUTH SESSIONS
-- ============================================================
CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token   VARCHAR(500) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    device_info     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(refresh_token);

-- ============================================================
-- 9. SEED DATA: Create the 4 system users
-- ============================================================
-- Passwords should be hashed with bcrypt in the app layer.
-- These are placeholder hashes for 'password123' — CHANGE IN PRODUCTION.

INSERT INTO users (name, email, phone, password_hash, role) VALUES
('Platform Admin', 'dev@cafeteriagrean.in', '9000000000', '$2b$10$placeholder_hash_dev', 'developer'),
('Restaurant Admin', 'admin@cafeteriagrean.in', '9000000001', '$2b$10$placeholder_hash_admin', 'admin'),
('Delivery Person', 'delivery@cafeteriagrean.in', '9000000002', '$2b$10$placeholder_hash_delivery', 'delivery');

-- ============================================================
-- 10. VIEWS for quick queries
-- ============================================================

-- Active orders (not terminal)
CREATE VIEW active_orders AS
SELECT
    o.*,
    u.name AS customer_name,
    u.phone AS customer_phone,
    u.email AS customer_email
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status NOT IN ('delivered', 'cancelled', 'payment_expired')
ORDER BY o.created_at DESC;

-- Unsettled delivered orders (restaurant owes platform)
CREATE VIEW unsettled_orders AS
SELECT
    o.id,
    o.order_number,
    o.subtotal,
    o.platform_fee,
    o.discount_from_platform,
    o.platform_earnings,
    o.restaurant_share,
    o.customer_pays,
    o.delivered_at,
    d.title AS deal_title
FROM orders o
LEFT JOIN deals d ON d.id = o.applied_deal_id
WHERE o.status = 'delivered'
  AND o.is_settled = false
ORDER BY o.delivered_at ASC;

-- Platform revenue summary
CREATE VIEW platform_revenue AS
SELECT
    DATE_TRUNC('day', delivered_at) AS date,
    COUNT(*) AS order_count,
    SUM(subtotal) AS gross_revenue,
    SUM(discount_amount) AS total_discounts_given,
    SUM(platform_fee) AS gross_platform_fee,
    SUM(discount_from_platform) AS discounts_from_platform,
    SUM(platform_earnings) AS net_platform_earnings,
    SUM(restaurant_share) AS restaurant_payout
FROM orders
WHERE status = 'delivered'
GROUP BY DATE_TRUNC('day', delivered_at)
ORDER BY date DESC;
