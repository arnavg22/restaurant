# 🍽️ FORCO AMORE — System Architecture

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Roles & Permissions Matrix](#2-roles--permissions-matrix)
3. [Tech Stack](#3-tech-stack)
4. [System Architecture Diagram](#4-system-architecture-diagram)
5. [Database Schema](#5-database-schema)
6. [API Design](#6-api-design)
7. [Order Lifecycle & State Machine](#7-order-lifecycle--state-machine)
8. [UPI Payment Flow](#8-upi-payment-flow)
9. [Business Math & Revenue Model](#9-business-math--revenue-model)
10. [Authentication & Authorization](#10-authentication--authorization)
11. [Real-time Updates](#11-real-time-updates)
12. [Deployment Architecture](#12-deployment-architecture)

---

## 1. System Overview

**FORCO AMORE** is a mobile-first food ordering platform for a locally-run restaurant operating in a corporate area. Office workers browse the menu, place orders, pay via UPI QR, and get food delivered to their office desk. The platform takes a **15% commission** on every order.

### Key Constraints
- **Target users:** Office workers in nearby corporate buildings
- **Delivery model:** Walk/desk delivery within a small radius (~2-3 km)
- **Payment:** UPI only (pre-filled QR code generation)
- **Mandatory delivery info:** Building name, floor/seat, contact number — required before payment
- **No refunds handled by platform** — restaurant admin handles cancellations directly

---

## 2. Roles & Permissions Matrix

| Permission                              | User (Customer) | Restaurant Admin | Delivery Person | Developer (Platform) |
|-----------------------------------------|:----------------:|:----------------:|:---------------:|:--------------------:|
| Browse menu                             | ✅               | ✅               | ❌              | ✅                   |
| Add/edit menu items                     | ❌               | ✅               | ❌              | ❌                   |
| Delete/disable menu items               | ❌               | ✅               | ❌              | ❌                   |
| Place an order                          | ✅               | ❌               | ❌              | ❌                   |
| View own order history                  | ✅               | ❌               | ❌              | ❌                   |
| View ALL order history                  | ❌               | ✅               | ❌              | ✅                   |
| Process / accept orders                 | ❌               | ✅               | ❌              | ❌                   |
| Cancel orders                           | ❌               | ✅               | ❌              | ❌                   |
| Update status → "Preparing"             | ❌               | ✅               | ❌              | ❌                   |
| Update status → "Ready for pickup"      | ❌               | ✅               | ❌              | ❌                   |
| Update status → "Out for delivery"      | ❌               | ✅               | ✅              | ❌                   |
| Update status → "Delivered"             | ❌               | ❌               | ✅              | ❌                   |
| View order logs / audit trail           | ❌               | ✅               | ❌              | ✅                   |
| View app analytics & statistics         | ❌               | ❌               | ❌              | ✅                   |
| View revenue / commission reports       | ❌               | ❌               | ❌              | ✅                   |
| Modify any data                         | ❌               | ❌               | ❌              | ❌                   |

### Role Descriptions

- **User (Customer):** Registers/logs in → browses menu → builds cart → fills delivery location + contact → generates UPI QR → pays → tracks order in real time.

- **Restaurant Admin:** Logs into admin dashboard → sees incoming orders → accepts/processes them → updates prep status → manages full menu (CRUD) → can cancel orders → sees complete order history.

- **Delivery Person:** Logs into delivery dashboard → sees orders marked "Ready" → marks "Out for delivery" → marks "Delivered" when handed over.

- **Developer (Platform Owner):** Logs into developer dashboard → sees all order logs, revenue reports, commission earnings, app statistics. **Cannot modify any data** — strictly read-only.

---

## 3. Tech Stack

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                           │
│                                                         │
│  React (PWA) + Vite + TailwindCSS                       │
│  ├─ User App        → /app                              │
│  ├─ Admin Dashboard  → /admin                           │
│  ├─ Delivery App     → /delivery                        │
│  └─ Developer Panel  → /dev                             │
│                                                         │
│  QR Code Generation: qrcode.react                       │
│  Real-time: Socket.io client                             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                      BACKEND                            │
│                                                         │
│  Node.js + Express (or Fastify)                         │
│  ├─ REST API        → /api/v1/*                         │
│  ├─ WebSocket       → Socket.io server                  │
│  ├─ Auth            → JWT (access + refresh tokens)     │
│  └─ Validation      → Zod schemas                       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                      DATABASE                           │
│                                                         │
│  PostgreSQL (primary store)                             │
│  ├─ Prisma ORM (type-safe queries)                      │
│  └─ Redis (session cache + rate limiting)                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE                       │
│                                                         │
│  Docker + Docker Compose                                │
│  Nginx (reverse proxy + static files)                   │
│  Let's Encrypt (SSL)                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 4. System Architecture Diagram

```
                        ┌──────────────┐
                        │   CUSTOMER   │
                        │  (Mobile /   │
                        │   Browser)   │
                        └──────┬───────┘
                               │ HTTPS
                        ┌──────▼───────┐
                        │              │
                        │    NGINX     │ ◄── SSL termination
                        │  (Reverse   │     Static file serving
                        │   Proxy)    │     Rate limiting
                        │              │
                        └──┬───┬───┬──┘
                           │   │   │
          ┌────────────────┘   │   └────────────────┐
          ▼                    ▼                     ▼
   ┌─────────────┐    ┌──────────────┐     ┌──────────────┐
   │  React PWA  │    │  Express API │     │  Socket.io   │
   │  (4 views:  │    │  Server      │     │  Server      │
   │  user/admin │    │              │     │  (Real-time  │
   │  /delivery  │    │  /api/v1/*   │     │   events)    │
   │  /dev)      │    │              │     │              │
   └─────────────┘    └──────┬───────┘     └──────┬───────┘
                             │                     │
                    ┌────────┴────────┐            │
                    ▼                  ▼            │
              ┌──────────┐     ┌──────────┐        │
              │PostgreSQL│     │  Redis   │◄───────┘
              │  (Main   │     │ (Cache + │
              │   DB)    │     │  PubSub) │
              └──────────┘     └──────────┘

   ┌──────────────┐     ┌──────────────┐
   │  ADMIN USER  │     │  DELIVERY    │
   │  (Tablet /   │     │  PERSON      │
   │   Desktop)   │     │  (Mobile)    │
   └──────────────┘     └──────────────┘

   ┌──────────────┐
   │  DEVELOPER   │
   │  (Desktop)   │
   └──────────────┘
```

---

## 5. Database Schema

### Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│    users     │       │     orders       │       │  menu_items  │
├──────────────┤       ├──────────────────┤       ├──────────────┤
│ id (PK)      │──┐    │ id (PK)          │   ┌──▶│ id (PK)      │
│ name         │  │    │ user_id (FK)     │───┘   │ name         │
│ email        │  └───▶│ delivery_name    │       │ description  │
│ phone        │       │ delivery_phone   │       │ price        │
│ password_hash│       │ building_name    │       │ category     │
│ role         │       │ floor_seat       │       │ image_url    │
│ created_at   │       │ delivery_notes   │       │ is_available │
└──────────────┘       │ subtotal         │       │ created_at   │
                       │ platform_fee     │       │ updated_at   │
                       │ total_amount     │       └──────────────┘
                       │ restaurant_share │
                       │ status           │       ┌──────────────┐
                       │ upi_txn_id       │       │ order_items  │
                       │ payment_verified │       ├──────────────┤
                       │ cancelled_by     │       │ id (PK)      │
                       │ cancel_reason    │       │ order_id (FK)│──┐
                       │ created_at       │       │ menu_item_id │  │
                       │ updated_at       │       │   (FK)       │──┘
                       └──────────────────┘       │ quantity     │
                                                  │ unit_price   │
                       ┌──────────────────┐       │ item_total   │
                       │  order_logs      │       └──────────────┘
                       ├──────────────────┤
                       │ id (PK)          │       ┌──────────────┐
                       │ order_id (FK)    │       │   sessions   │
                       │ from_status      │       ├──────────────┤
                       │ to_status        │       │ id (PK)      │
                       │ changed_by (FK)  │       │ user_id (FK) │
                       │ notes            │       │ refresh_token│
                       │ created_at       │       │ expires_at   │
                       └──────────────────┘       │ device_info  │
                                                  └──────────────┘
```

### Full SQL Schema

```sql
-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    phone           VARCHAR(15) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'customer'
                    CHECK (role IN ('customer', 'admin', 'delivery', 'developer')),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- MENU ITEMS TABLE
-- ============================================
CREATE TABLE menu_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    price           DECIMAL(10, 2) NOT NULL CHECK (price > 0),
    category        VARCHAR(100) NOT NULL,  -- e.g., 'Main Course', 'Snacks', 'Beverages'
    image_url       VARCHAR(500),
    is_available    BOOLEAN DEFAULT true,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ORDERS TABLE
-- ============================================
CREATE TABLE orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number        VARCHAR(20) UNIQUE NOT NULL,  -- Human-readable: GRN-20260606-001
    user_id             UUID NOT NULL REFERENCES users(id),
    
    -- Delivery information (MUST be filled before order placement)
    delivery_name       VARCHAR(100) NOT NULL,
    delivery_phone      VARCHAR(15) NOT NULL,
    building_name       VARCHAR(200) NOT NULL,
    floor_seat          VARCHAR(100) NOT NULL,  -- "3rd Floor, Desk 42"
    delivery_notes      TEXT,                    -- Optional: "Near the pantry", etc.
    
    -- Financial breakdown
    subtotal            DECIMAL(10, 2) NOT NULL,  -- Sum of all item totals
    platform_fee        DECIMAL(10, 2) NOT NULL,  -- 15% of subtotal
    total_amount        DECIMAL(10, 2) NOT NULL,  -- What customer pays (subtotal + 0, since fee is commission)
    
    -- IMPORTANT: total_amount = subtotal (customer pays the menu price)
    -- platform_fee is deducted from restaurant's revenue, not added to customer
    -- restaurant_share = subtotal - platform_fee
    
    -- Payment
    upi_txn_id          VARCHAR(100),            -- UPI transaction reference
    payment_verified    BOOLEAN DEFAULT false,
    payment_qr_data     TEXT,                     -- The UPI URI that was in the QR
    
    -- Order status
    status              VARCHAR(30) NOT NULL DEFAULT 'pending_payment'
                        CHECK (status IN (
                            'pending_payment',   -- Awaiting payment
                            'placed',            -- Payment confirmed, awaiting admin
                            'accepted',          -- Admin accepted the order
                            'preparing',         -- Being prepared
                            'ready',             -- Ready for pickup by delivery
                            'out_for_delivery',  -- Delivery person picked up
                            'delivered',         -- Delivered to customer
                            'cancelled'          -- Cancelled by admin
                        )),
    
    -- Cancellation
    cancelled_by        UUID REFERENCES users(id),
    cancel_reason       TEXT,
    
    -- Timestamps
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    paid_at             TIMESTAMP WITH TIME ZONE,
    delivered_at        TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- ORDER ITEMS TABLE
-- ============================================
CREATE TABLE order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id    UUID NOT NULL REFERENCES menu_items(id),
    item_name       VARCHAR(200) NOT NULL,    -- Snapshot at order time (menu might change)
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      DECIMAL(10, 2) NOT NULL,  -- Snapshot at order time
    item_total      DECIMAL(10, 2) NOT NULL,  -- quantity × unit_price
    
    UNIQUE(order_id, menu_item_id)
);

-- ============================================
-- ORDER LOGS (Audit Trail)
-- ============================================
CREATE TABLE order_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id),
    from_status     VARCHAR(30),
    to_status       VARCHAR(30) NOT NULL,
    changed_by      UUID REFERENCES users(id),
    changed_by_role VARCHAR(20),
    notes           TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- SESSIONS TABLE (for auth)
-- ============================================
CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token   VARCHAR(500) NOT NULL,
    expires_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    device_info     TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_logs_order_id ON order_logs(order_id);
CREATE INDEX idx_menu_items_category ON menu_items(category);
CREATE INDEX idx_menu_items_available ON menu_items(is_available) WHERE is_available = true;

-- ============================================
-- ORDER NUMBER SEQUENCE
-- ============================================
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
```

---

## 6. API Design

### Base URL: `https://api.forcoamore.in/v1`

### Authentication
```
POST   /auth/register          -- Customer registration
POST   /auth/login             -- All roles
POST   /auth/refresh           -- Refresh access token
POST   /auth/logout            -- Invalidate session
```

### Menu (Public + Admin)
```
GET    /menu                   -- Public: list available items (grouped by category)
GET    /menu/:id               -- Public: single item details
POST   /menu                   -- Admin only: create item
PUT    /menu/:id               -- Admin only: update item
PATCH  /menu/:id/availability  -- Admin only: toggle availability
DELETE /menu/:id               -- Admin only: soft delete
```

### Orders (Customer)
```
POST   /orders                 -- Place order (requires delivery info + items)
GET    /orders                 -- List own orders (paginated, filterable by status)
GET    /orders/:id             -- Order detail + items + logs
PATCH  /orders/:id/payment     -- Submit payment proof (UPI txn ID)
```

### Orders (Admin)
```
GET    /admin/orders           -- ALL orders (filterable: status, date range, search)
GET    /admin/orders/:id       -- Any order detail
PATCH  /admin/orders/:id/accept    -- Accept order → status: 'accepted'
PATCH  /admin/orders/:id/prepare   -- Start preparing → status: 'preparing'
PATCH  /admin/orders/:id/ready     -- Mark ready → status: 'ready'
PATCH  /admin/orders/:id/cancel    -- Cancel order (requires reason)
```

### Orders (Delivery)
```
GET    /delivery/orders        -- Orders with status 'ready' or 'out_for_delivery'
PATCH  /delivery/orders/:id/pickup   -- Mark out for delivery
PATCH  /delivery/orders/:id/deliver  -- Mark delivered (requires OTP from customer)
```

### Developer / Platform
```
GET    /dev/stats              -- Dashboard statistics
GET    /dev/orders             -- All order logs (read-only, paginated)
GET    /dev/revenue            -- Revenue & commission reports
GET    /dev/logs               -- System audit logs
```

### WebSocket Events
```
Connection: ws://api.forcoamore.in/ws?token=<access_token>

Server → Client Events:
  order:status_changed    { orderId, oldStatus, newStatus, timestamp }
  order:new               { orderId, orderNumber }  (admin only)
  order:cancelled         { orderId, reason }

Client → Server Events:
  subscribe:order         { orderId }     -- Subscribe to specific order updates
  subscribe:admin_feed    {}              -- Admin: subscribe to all new orders
```

---

## 7. Order Lifecycle & State Machine

```
                    ┌─────────────────┐
                    │ pending_payment  │  ← User fills cart + delivery info + generates QR
                    └────────┬────────┘
                             │ User submits UPI txn ID
                             ▼
                    ┌─────────────────┐
                    │     placed       │  ← Payment submitted, awaiting admin
                    └────────┬────────┘
                             │ Admin accepts
                             ▼
                    ┌─────────────────┐
                    │    accepted      │
                    └────────┬────────┘
                             │ Admin starts cooking
                             ▼
                    ┌─────────────────┐
                    │   preparing      │
                    └────────┬────────┘
                             │ Admin marks ready
                             ▼
                    ┌─────────────────┐
                    │     ready        │  ← Delivery person sees this
                    └────────┬────────┘
                             │ Delivery picks up
                             ▼
                    ┌─────────────────┐
                    │ out_for_delivery │
                    └────────┬────────┘
                             │ Delivery confirms handoff
                             ▼
                    ┌─────────────────┐
                    │   delivered ✅   │  ← Terminal state
                    └─────────────────┘

    CANCELLATION (can happen from: placed, accepted, preparing):
                    ┌─────────────────┐
                    │   cancelled ❌   │  ← Terminal state (Admin only)
                    └─────────────────┘
```

### Status Transition Rules

| From Status         | To Status          | Who Can Do It      | Conditions                     |
|---------------------|--------------------|--------------------|--------------------------------|
| pending_payment     | placed             | System (auto)      | Payment txn ID submitted        |
| pending_payment     | cancelled          | System (auto)      | Payment not made in 15 min      |
| placed              | accepted           | Admin              | —                              |
| placed              | cancelled          | Admin              | Must provide reason             |
| accepted            | preparing          | Admin              | —                              |
| accepted            | cancelled          | Admin              | Must provide reason             |
| preparing           | ready              | Admin              | —                              |
| preparing           | cancelled          | Admin              | Must provide reason             |
| ready               | out_for_delivery   | Delivery Person    | —                              |
| out_for_delivery    | delivered          | Delivery Person    | —                              |

---

## 8. UPI Payment Flow

This is the **core payment mechanism** — a UPI deep-link QR code that the customer scans with any UPI app.

### Flow Diagram

```
  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌─────────┐
  │  USER   │    │  SERVER  │    │   QR     │    │  UPI    │
  │         │    │          │    │ DISPLAY  │    │  APP    │
  └────┬────┘    └────┬─────┘    └────┬─────┘    └────┬────┘
       │              │               │               │
       │ 1. Build cart│               │               │
       │ 2. Fill delivery info        │               │
       │ 3. POST /orders              │               │
       │─────────────▶│               │               │
       │              │               │               │
       │ 4. Generate UPI URI         │               │
       │    Return order_id           │               │
       │    + upi_payment_link        │               │
       │◀─────────────│               │               │
       │              │               │               │
       │ 5. Render QR code on screen  │               │
       │────────────────────────────▶│               │
       │              │               │               │
       │ 6. User scans QR with phone camera            │
       │──────────────────────────────────────────────▶
       │              │               │               │
       │              │               │ 7. UPI app opens
       │              │               │    with pre-filled:
       │              │               │    - Payee VPA
       │              │               │    - Amount
       │              │               │    - Note (order #)
       │              │               │               │
       │              │               │ 8. User enters UPI PIN
       │              │               │    and pays          │
       │              │               │               │
       │ 9. User enters UPI Ref# on our page          │
       │─────────────▶│               │               │
       │              │               │               │
       │ 10. Verify (or trust txn ref)                │
       │     Update status → 'placed' │               │
       │◀─────────────│               │               │
       │              │               │               │
```

### UPI URI Format

```
upi://pay?pa=<VPA>&pn=<NAME>&am=<AMOUNT>&cu=INR&tn=<ORDER_NOTE>&tr=<TXN_REF>
```

**Example:**
```
upi://pay?pa=forcoamore@paytm&pn=Cafeteria%20Green&am=250.00&cu=INR&tn=Order%20GRN-20260606-0001&tr=GRN202606060001
```

**Parameter Breakdown:**

| Param | Description                        | Value                                    |
|-------|------------------------------------|------------------------------------------|
| `pa`  | Payee VPA (UPI ID)                 | `forcoamore@paytm` (your UPI handle) |
| `pn`  | Payee Name                         | `FORCO AMORE`                        |
| `am`  | Amount (₹)                         | `250.00` (order total)                   |
| `cu`  | Currency                           | `INR`                                    |
| `tn`  | Transaction Note                   | `Order GRN-20260606-0001`               |
| `tr`  | Transaction Reference              | Order number (for reconciliation)        |

### QR Code Generation (Frontend)

```jsx
import QRCode from 'qrcode.react';

function PaymentQR({ order }) {
    const upiLink = `upi://pay?pa=forcoamore@paytm&pn=${encodeURIComponent('FORCO AMORE')}&am=${order.total_amount}&cu=INR&tn=${encodeURIComponent(`Order ${order.order_number}`)}&tr=${order.order_number}`;
    
    return (
        <div className="payment-screen">
            <h2>Scan to Pay ₹{order.total_amount}</h2>
            <QRCode value={upiLink} size={250} level="H" />
            <p className="order-ref">Order: {order.order_number}</p>
            <p className="hint">Scan with any UPI app (GPay, PhonePe, Paytm...)</p>
            
            {/* After payment, user enters UPI reference */}
            <form onSubmit={handlePaymentConfirm}>
                <input 
                    type="text" 
                    placeholder="Enter UPI Transaction Ref #" 
                    required 
                />
                <button type="submit">Confirm Payment</button>
            </form>
        </div>
    );
}
```

### Payment Verification Strategy

Since we're generating a pre-filled QR (not using a payment gateway), we have **3 levels of verification:**

| Level | Method | Reliability | Complexity |
|-------|--------|-------------|------------|
| **L1: Trust + Audit** | User enters UPI ref number, admin verifies manually | Low | Simple |
| **L2: Bank SMS/Webhook** | Parse bank SMS alerts or bank API webhook | High | Medium |
| **L3: Payment Gateway** | Use Razorpay/Cashfree UPI intent API | Very High | Medium |

**Recommended for MVP: L1 + L2 hybrid**

For MVP: Use L1 (user submits ref, admin sees it on their dashboard and verifies before accepting). Later integrate L2/L3 for automation.

**Order status stays at `pending_payment` until the user submits a txn reference.** Admin can then verify and the system auto-moves to `placed`.

---

## 9. Business Math & Revenue Model

### Per-Order Financial Breakdown

```
┌─────────────────────────────────────────────────────────────┐
│                    ORDER FINANCIALS                         │
│                                                             │
│  Customer Pays:     ₹TOTAL (subtotal, i.e. sum of items)    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              ₹TOTAL = ₹SUBTOTAL                      │  │
│  │                                                       │  │
│  │  Platform Fee (15%):   ₹FEE = SUBTOTAL × 0.15        │  │
│  │  Restaurant Share:     ₹REST = SUBTOTAL - FEE        │  │
│  │                                                       │  │
│  │  REST = SUBTOTAL × 0.85                              │  │
│  │  FEE  = SUBTOTAL × 0.15                              │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Example:                                                   │
│  ───────                                                    │
│  Item 1: Paneer Butter Masala    × 1  =  ₹180              │
│  Item 2: Jeera Rice              × 2  =  ₹120              │
│  Item 3: Mango Lassi             × 1  =  ₹60               │
│  ─────────────────────────────────────────────              │
│  Subtotal                          =  ₹360                  │
│  Platform Fee (15%)                =  ₹54.00               │
│  Restaurant Gets (85%)             =  ₹306.00              │
│  Customer Pays                     =  ₹360                  │
│                                                             │
│  ★ Customer pays EXACTLY the menu price.                    │
│  ★ The 15% is a COMMISSION deducted from restaurant.       │
│  ★ No extra charge to the customer.                         │
└─────────────────────────────────────────────────────────────┘
```

### Financial Formulas

```javascript
// === CORE CALCULATIONS ===

// Per order item
itemTotal = unitPrice × quantity

// Order level
subtotal     = Σ(itemTotal for each item)
platformFee  = subtotal × 0.15         // Your commission
restShare    = subtotal × 0.85         // Restaurant's revenue
totalAmount  = subtotal                // What customer actually pays

// === AGGREGATE REPORTS ===

// Daily/Weekly/Monthly
totalRevenue       = Σ(totalAmount) for delivered orders
totalPlatformEarnings = Σ(platformFee) for delivered orders
totalRestaurantEarnings = Σ(restShare) for delivered orders
totalOrders        = COUNT(delivered orders)
avgOrderValue      = totalRevenue / totalOrders

// Cancellation impact
cancelledOrders    = COUNT(cancelled orders)
cancellationRate   = cancelledOrders / totalOrders × 100
revenueLost        = Σ(subtotal) for cancelled orders

// Active orders (at any point in time)
pendingOrders      = COUNT(orders WHERE status IN ('placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'))
```

### Revenue Dashboard Metrics (Developer View)

```
┌─────────────────────────────────────────────────────┐
│           TODAY'S DASHBOARD — 6 Jun 2026            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  📦 Orders Today          47                        │
│  💰 Gross Revenue         ₹12,450.00               │
│  🏆 Your Commission (15%) ₹1,867.50                │
│  🏪 Restaurant Revenue    ₹10,582.50               │
│  📊 Avg Order Value       ₹264.89                  │
│  ❌ Cancellation Rate      4.3% (2 cancelled)       │
│  ⏱️  Avg Delivery Time     22 min                   │
│                                                     │
│  ── This Week ──                                    │
│  📦 Total Orders           284                      │
│  💰 Gross Revenue          ₹74,920.00              │
│  🏆 Your Commission        ₹11,238.00              │
│                                                     │
│  ── This Month ──                                   │
│  📦 Total Orders           1,102                    │
│  💰 Gross Revenue          ₹2,89,740.00            │
│  🏆 Your Commission        ₹43,461.00              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Commission Settlement Logic

```javascript
// Settlement happens weekly/monthly — restaurant receives accumulated restShare
// minus any refunds/cancellations

async function calculateSettlement(restaurantId, startDate, endDate) {
    const orders = await db.query(`
        SELECT 
            SUM(subtotal) as total_subtotal,
            SUM(platform_fee) as total_platform_fee,
            SUM(rest_share) as total_rest_share,
            COUNT(*) as order_count
        FROM orders
        WHERE status = 'delivered'
        AND delivered_at BETWEEN $1 AND $2
    `, [startDate, endDate]);

    const cancelledAmount = await db.query(`
        SELECT SUM(subtotal) as cancelled_subtotal
        FROM orders
        WHERE status = 'cancelled'
        AND updated_at BETWEEN $1 AND $2
        AND payment_verified = true
    `, [startDate, endDate]);

    return {
        totalOrders: orders.order_count,
        grossRevenue: orders.total_subtotal,
        platformCommission: orders.total_platform_fee,  // Your 15%
        restaurantPayout: orders.total_rest_share,       // Their 85%
        cancelledRefunds: cancelledAmount.cancelled_subtotal || 0,
        netRestaurantPayout: orders.total_rest_share - (cancelledAmount.cancelled_subtotal || 0)
    };
}
```

---

## 10. Authentication & Authorization

### JWT Token Structure

```javascript
// Access Token (short-lived: 15 min)
{
    "sub": "user-uuid",
    "name": "Rahul Sharma",
    "role": "customer",        // customer | admin | delivery | developer
    "iat": 1717651200,
    "exp": 1717652100
}

// Refresh Token (long lived: 7 days, stored in DB)
// Opaque token, stored in sessions table
```

### Auth Middleware

```javascript
// Role-based route protection
function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

// Usage in routes:
router.get('/admin/orders',    authorize('admin'),              getOrders);
router.patch('/delivery/:id',  authorize('delivery', 'admin'),  markDelivered);
router.get('/dev/stats',       authorize('developer'),          getStats);
router.get('/menu',            authorize('customer', 'admin', 'developer'), getMenu);
```

### Route Protection Map

```javascript
// Public (no auth needed)
app.get('/api/v1/menu', getMenu);          // Public menu browsing

// Customer routes
app.use('/api/v1/orders', authenticate, authorize('customer'), customerOrderRoutes);

// Admin routes
app.use('/api/v1/admin',  authenticate, authorize('admin'), adminRoutes);

// Delivery routes
app.use('/api/v1/delivery', authenticate, authorize('delivery'), deliveryRoutes);

// Developer routes
app.use('/api/v1/dev',    authenticate, authorize('developer'), devRoutes);

// Shared (admin + delivery)
app.use('/api/v1/orders', authenticate, authorize('admin', 'delivery'), sharedOrderRoutes);
```

---

## 11. Real-time Updates

### Architecture

```
  Customer App                    Server                     Admin Dashboard
  ────────────                    ──────                     ───────────────
      │                              │                              │
      │── WS connect ──────────────▶│◀── WS connect ──────────────│
      │                              │                              │
      │── subscribe:order(123) ─────▶│                              │
      │                              │◀── subscribe:admin_feed ─────│
      │                              │                              │
      │                              │  [Order placed event]        │
      │                              │─────────────────────────────▶│
      │                              │   "New order: GRN-001"       │
      │                              │                              │
      │  [Admin accepts]             │                              │
      │◀─────────────────────────────│─────────────────────────────│
      │  order:status_changed        │                              │
      │  {status: 'accepted'}        │                              │
      │                              │                              │
```

### Implementation

```javascript
// Server-side Socket.io
io.use(authenticateSocket);  // Verify JWT on connection

io.on('connection', (socket) => {
    const user = socket.user;
    
    // Customer subscribes to their order
    socket.on('subscribe:order', (orderId) => {
        // Verify this order belongs to the user
        socket.join(`order:${orderId}`);
    });
    
    // Admin subscribes to all new orders
    if (user.role === 'admin') {
        socket.join('admin_feed');
    }
    
    // Delivery person subscribes to ready orders
    if (user.role === 'delivery') {
        socket.join('delivery_feed');
    }
});

// When order status changes, emit to relevant rooms
function emitOrderUpdate(orderId, oldStatus, newStatus) {
    // Notify the customer who owns this order
    io.to(`order:${orderId}`).emit('order:status_changed', {
        orderId, oldStatus, newStatus,
        timestamp: new Date().toISOString()
    });
    
    // Notify admin feed
    io.to('admin_feed').emit('order:updated', {
        orderId, newStatus
    });
    
    // Notify delivery feed when order becomes 'ready'
    if (newStatus === 'ready') {
        io.to('delivery_feed').emit('order:ready', { orderId });
    }
}
```

---

## 12. Deployment Architecture

### Docker Compose Setup

```yaml
version: '3.8'

services:
  # ── NGINX Reverse Proxy ──
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/nginx/certs
      - ./frontend/dist:/usr/share/nginx/html
    depends_on:
      - api

  # ── Node.js API Server ──
  api:
    build: ./backend
    environment:
      - DATABASE_URL=postgresql://cg_user:password@postgres:5432/forco_amore
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=<secret>
      - UPI_VPA=forcoamore@paytm
      - UPI_PAYEE_NAME=FORCO AMORE
      - PLATFORM_FEE_RATE=0.15
      - PORT=3000
    depends_on:
      - postgres
      - redis

  # ── PostgreSQL ──
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: forco_amore
      POSTGRES_USER: cg_user
      POSTGRES_PASSWORD: password
    volumes:
      - pgdata:/var/lib/postgresql/data

  # ── Redis ──
  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

### NGINX Config

```nginx
server {
    listen 443 ssl http2;
    server_name forcoamore.in;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    # Frontend (React PWA)
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    # API
    location /api/ {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket
    location /ws {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## Appendix A: Complete Order Flow (Step by Step)

```
STEP  WHAT HAPPENS                                           WHO        STATUS
────  ──────────────────────────────────────────────────     ────       ──────────────
 1    Customer opens app, browses menu                        Customer   —
 2    Adds items to cart                                      Customer   —
 3    Fills in: Name, Phone, Building, Floor/Seat, Notes      Customer   —
 4    Taps "Place Order"                                      Customer   —
 5    Server validates:
      - Cart not empty
      - Delivery fields all present
      - All menu items still available & prices correct
      - Creates order with status: pending_payment            Server     pending_payment
 6    Server generates UPI link + returns QR data             Server     pending_payment
 7    App renders QR code on screen                           Customer   pending_payment
 8    Customer scans QR with UPI app                          Customer   pending_payment
 9    Customer pays ₹{total} via UPI                          Customer   pending_payment
10    Customer enters UPI Transaction Reference #             Customer   pending_payment
11    Server receives txn ref, updates order                  Server     placed
12    Real-time notification to Admin dashboard               Server     placed
13    Admin sees order, verifies payment                      Admin      placed
14    Admin taps "Accept"                                     Admin      accepted
15    Admin taps "Start Preparing"                            Admin      preparing
16    Customer sees status update in real time                 Customer   preparing
17    Admin finishes, taps "Ready"                            Admin      ready
18    Delivery person sees order in their feed                Delivery   ready
19    Delivery person picks up, taps "Picked Up"              Delivery   out_for_delivery
20    Delivery person arrives at customer's desk              Delivery   out_for_delivery
21    Delivery person taps "Delivered"                        Delivery   delivered ✅
22    Customer sees "Delivered" status                         Customer   delivered ✅
23    Order logged for developer analytics                     —          —
24    Commission calculated: ₹{total} × 0.15                  —          —
```

---

## Appendix B: Frontend Route Structure

```
/                           → Landing / redirect to /app
/app                        → Customer Menu + Cart
/app/cart                   → Cart review
/app/checkout               → Delivery info form + Payment QR
/app/orders                 → My orders list
/app/orders/:id             → Order detail + live tracking

/admin                      → Admin Login
/admin/dashboard            → Active orders Kanban board
/admin/orders               → Full order history
/admin/menu                 → Menu management (CRUD)
/admin/settings             → Restaurant settings

/delivery                   → Delivery Login
/delivery/orders            → Ready orders list
/delivery/orders/:id        → Order detail + deliver action

/dev                        → Developer Login
/dev/dashboard              → Analytics dashboard
/dev/orders                 → All order logs
/dev/revenue                → Revenue & commission reports
/dev/audit                  → System audit trail
```

---

## Appendix C: File / Folder Structure

```
forco_amore/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── components/
│   │   │   ├── common/           # Shared: Button, Card, Badge, Toast
│   │   │   ├── menu/             # MenuCard, CategoryTabs, ItemDetail
│   │   │   ├── cart/             # CartDrawer, CartItem, CartSummary
│   │   │   ├── checkout/         # DeliveryForm, PaymentQR, PaymentConfirm
│   │   │   ├── orders/           # OrderCard, OrderTimeline, StatusBadge
│   │   │   ├── admin/            # OrderKanban, MenuEditor, OrderTable
│   │   │   ├── delivery/         # DeliveryOrderCard, DeliveryMap
│   │   │   └── dev/              # StatsGrid, RevenueChart, LogTable
│   │   ├── hooks/                # useAuth, useOrders, useWebSocket, useCart
│   │   ├── context/              # AuthContext, CartContext, SocketContext
│   │   ├── pages/
│   │   │   ├── customer/         # MenuPage, CartPage, CheckoutPage, OrdersPage
│   │   │   ├── admin/            # DashboardPage, MenuMgmtPage, OrderHistoryPage
│   │   │   ├── delivery/         # DeliveryFeedPage, DeliveryDetailPage
│   │   │   └── dev/              # DevDashboardPage, DevOrdersPage, DevRevenuePage
│   │   ├── services/             # api.js, auth.js, orders.js, menu.js
│   │   └── utils/                # formatters.js, validators.js, constants.js
│   ├── public/
│   │   └── manifest.json         # PWA manifest
│   └── vite.config.js
│
├── backend/
│   ├── src/
│   │   ├── server.js             # Express + Socket.io setup
│   │   ├── config/               # env.js, database.js, redis.js
│   │   ├── middleware/           # auth.js, errorHandler.js, rateLimiter.js, validator.js
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── menu.routes.js
│   │   │   ├── order.routes.js
│   │   │   ├── admin.routes.js
│   │   │   ├── delivery.routes.js
│   │   │   └── dev.routes.js
│   │   ├── controllers/          # Business logic per route
│   │   ├── services/             # orderService.js, paymentService.js, reportService.js
│   │   ├── models/               # Prisma schema
│   │   ├── websocket/            # socketHandler.js, events.js
│   │   └── utils/                # upiGenerator.js, orderNumberGenerator.js
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
│
├── nginx/
│   └── nginx.conf
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Appendix D: Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Frontend** | React + Vite (PWA) | Fast, installable on mobile, single codebase for 4 views |
| **Backend** | Node.js + Express | Fast to build, good WebSocket support, JSON-native |
| **Database** | PostgreSQL | ACID transactions for orders, mature, great for analytics |
| **Cache** | Redis | Session storage, rate limiting, pub/sub for real-time |
| **Real-time** | Socket.io | Auto-reconnect, room-based pub/sub, works everywhere |
| **QR Code** | UPI deep link + qrcode.react | No payment gateway dependency, zero transaction fees from platform |
| **Auth** | JWT + refresh tokens | Stateless API, easy role-based access control |
| **ORM** | Prisma | Type-safe, auto-migrations, great DX |
| **Hosting** | VPS (DigitalOcean/Hetzner) | Cheap for local restaurant, full control |
| **PWA** | Service Worker + manifest | "App-like" feel without App Store |

---

*Architecture designed for FORCO AMORE — a commission-based food ordering platform for corporate office delivery.*
*Platform takes 15% commission. Customer pays exact menu price. UPI-first payment model.*
