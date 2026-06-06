# 🌿 Cafeteria Green — Complete Backend

## Quick Start

```bash
# 1. Install dependencies
cd backend
npm install

# 2. Setup environment
cp .env.example .env
# Edit .env with your Razorpay keys and database URL

# 3. Setup database
npx prisma migrate dev --name init
npm run db:seed

# 4. Start development server
npm run dev
```

## What's Built

### ✅ Automatic UPI Payments (Razorpay)
- Customer places order → Razorpay generates UPI QR
- Customer scans with ANY UPI app (GPay, PhonePe, Paytm, BHIM)
- Razorpay webhook auto-verifies payment → order status updates
- **No manual reference number entry needed**
- Real-time notification to customer + admin via WebSocket

### ✅ 4-Role System
| Role | Login | Dashboard |
|------|-------|-----------|
| Customer | `/api/v1/auth/login` | Browse menu, place orders, track delivery |
| Restaurant Admin | `/api/v1/auth/login` | Order queue, menu CRUD, commission view |
| Delivery Person | `/api/v1/auth/login` | Ready orders, mark pickup/delivered |
| Developer (You) | `/api/v1/auth/login` | Analytics, revenue, order logs, deals |

### ✅ Deals & Discounts (From Your Share Only)
- **Only you (developer) can create/update deals**
- Flat discounts (₹50 off) or percentage (10% off, max ₹100)
- Discount comes from platform's 15% commission — restaurant revenue never affected
- Per-user usage limits, date validity, minimum order amount
- Full usage tracking and stats

### ✅ Commission & Settlement Tracking
- **Admin dashboard**: Shows outstanding commission owed to platform
- **Developer dashboard**: Full revenue breakdown + outstanding details
- Per-order financial tracking: subtotal, discount, platform fee, restaurant share
- Settlement system: Mark batches of orders as settled

### ✅ Order State Machine
```
pending_payment → placed → accepted → preparing → ready → out_for_delivery → delivered
                                     ↘ cancelled (admin only)
```

### ✅ Complete Audit Trail
- Every status change logged with: who, when, from → to, notes
- Payment events logged from Razorpay webhooks
- Full order history viewable by admin and developer

## File Structure

```
backend/
├── prisma/
│   └── schema.prisma          # Database schema (Prisma ORM)
├── src/
│   ├── server.js              # Express + Socket.io entry point
│   ├── config/
│   │   └── constants.js       # Fee rates, status transitions, roles
│   ├── middleware/
│   │   ├── auth.js            # JWT auth + role-based authorization
│   │   └── errorHandler.js    # Global error handling
│   ├── routes/
│   │   ├── auth.routes.js     # Register, login, refresh, logout
│   │   ├── menu.routes.js     # Public browse + admin CRUD
│   │   ├── order.routes.js    # Customer order placement + tracking
│   │   ├── admin.routes.js    # Admin order management + dashboard
│   │   ├── delivery.routes.js # Delivery pickup + delivery marking
│   │   ├── dev.routes.js      # Developer analytics + deals management
│   │   └── webhook.routes.js  # Razorpay auto-payment webhook
│   ├── services/
│   │   ├── orderService.js    # Core order logic + financial math
│   │   ├── dealService.js     # Deal CRUD + discount calculations
│   │   └── revenueService.js  # Revenue, outstanding, settlements
│   ├── websocket/
│   │   └── socketHandler.js   # Real-time event handling
│   └── seed.js                # Initial data (users + menu + sample deals)
├── database/
│   └── schema.sql             # Raw SQL schema (for reference)
├── package.json
└── .env.example
```

## Key Business Logic Files

| File | What It Does |
|------|-------------|
| `services/orderService.js` | Financial calculations, order creation, Razorpay integration, status transitions, payment verification |
| `services/dealService.js` | Deal creation (developer only), discount calculations with platform cap enforcement |
| `services/revenueService.js` | Outstanding commission, dashboard analytics, settlement management |
| `config/constants.js` | Platform fee rate (15%), status transition rules, role definitions |

## The Math (Quick Reference)

```
subtotal       = Σ(item_price × quantity)
discount       = min(deal_discount, subtotal × 0.15)  // capped at platform share
customer_pays  = subtotal - discount
platform_fee   = subtotal × 0.15
platform_earnings = platform_fee - discount
restaurant_share  = subtotal × 0.85  // NEVER affected by deals

VERIFY: customer_pays = restaurant_share + platform_earnings
```

## API Overview

### Authentication
```
POST /api/v1/auth/register     Customer registration
POST /api/v1/auth/login        All roles
POST /api/v1/auth/refresh      Refresh access token
GET  /api/v1/auth/me           Current user info
```

### Menu (Public + Admin)
```
GET    /api/v1/menu            Available items (public)
GET    /api/v1/menu/all        All items (admin)
POST   /api/v1/menu            Create item (admin)
PUT    /api/v1/menu/:id        Update item (admin)
PATCH  /api/v1/menu/:id/availability   Toggle (admin)
```

### Orders (Customer)
```
GET    /api/v1/orders/deals    Available deals
POST   /api/v1/orders/preview  Preview with deal
POST   /api/v1/orders          Place order
GET    /api/v1/orders          My orders
GET    /api/v1/orders/:id      Order detail
```

### Admin
```
GET    /api/v1/admin/dashboard  Full dashboard
GET    /api/v1/admin/orders     All orders
PATCH  /api/v1/admin/orders/:id/accept
PATCH  /api/v1/admin/orders/:id/prepare
PATCH  /api/v1/admin/orders/:id/ready
PATCH  /api/v1/admin/orders/:id/cancel
GET    /api/v1/admin/history    Order history with financials
```

### Delivery
```
GET    /api/v1/delivery/orders           Ready/in-delivery orders
PATCH  /api/v1/delivery/orders/:id/pickup
PATCH  /api/v1/delivery/orders/:id/deliver
```

### Developer
```
GET    /api/v1/dev/dashboard    Analytics dashboard
GET    /api/v1/dev/outstanding  Commission details
GET    /api/v1/dev/orders       All order logs
POST   /api/v1/dev/deals        Create deal
PUT    /api/v1/dev/deals/:id    Update deal
GET    /api/v1/dev/deals        List deals
GET    /api/v1/dev/stats        System stats
GET    /api/v1/dev/settlements  Settlement history
POST   /api/v1/dev/settlements  Create settlement
```

### Webhooks
```
POST   /api/v1/webhook/razorpay  Auto-payment verification
```

## Deployment

```bash
# Build and run with Docker
docker-compose up -d

# Or run directly
npm start
```

See `PAYMENT_FLOW.md` for Razorpay setup details.
See `DEALS_SYSTEM.md` for deal/discount documentation.
"# restaurant" 
