# 🌿 Cafeteria Green & FORCO AMORE — Shared Monorepo Reference

Welcome to the unified monorepo containing two highly polished, mobile-first restaurant order systems designed for localized desk-delivery within corporate office parks: **Cafeteria Green** and **FORCO AMORE**.

*This document is kept locally and will not be pushed to Git. It serves as your private, comprehensive project and architectural reference.*

---

## 📖 Project Context & Business Model

The applications in this monorepo are tailored for food and beverage operators targeting high-density office zones:

*   **Target Audience:** Corporate workers who want to order hot meals, snacks, or beverages directly to their office desks.
*   **The Business Model:** The platform operates on a **commission-based** revenue model, taking a **15% commission** on every completed order. 
*   **Customer Price Transparency:** Customers pay the exact menu price. There are no surprise platform markup fees added. Instead, the 15% platform fee is deducted directly from the restaurant’s gross earnings during weekly/monthly settlements.
*   **Delivery Model:** Ultra-localized walk/desk delivery. Instead of GPS maps, deliveries are fulfilled inside a small radius using precise building and desk-level parameters.

### Operational Constraints & Handoffs
*   **Mandatory Delivery Info:** Because delivery is made directly to desks, order placements (`customer.html`) strictly enforce building name, floor, desk/seat number, and receiver phone validation before allowing payment generation.
*   **No Platform-led Refunds:** Cancelled orders must be settled directly between the restaurant administrator and the customer, protecting the platform from transaction-processing overhead.

---

## 👥 Interactive User Roles & Permissions

The system manages **5 distinct roles**, each with localized dashboards serving custom actions:

| Permission | Customer | Restaurant Admin | Kitchen Staff | Delivery Agent | Developer (Platform) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Browse Menu** | ✅ | ✅ | ❌ | ❌ | ✅ (Read) |
| **Place Order** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Menu Management (CRUD)** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Manage Developer Discounts** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Verify UPI / Accept Order** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Kitchen KDS Operations** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Assign Delivery Partner** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Pickup / Deliver Order** | ❌ | ❌ | ❌ | ✅ | ❌ |
| **View System Audit Logs** | ❌ | ✅ | ❌ | ❌ | ✅ (Read) |
| **Revenue / Settlement View** | ❌ | ✅ (Owed) | ❌ | ❌ | ✅ (Payouts) |

### 🛠️ Role Workflows

1.  **User (Customer):** Sign-up/Log-in → Browse menu → Select variants (e.g., Pint/Bucket for Bar items) → Select discount deals → Provide exact desk location → Generate scannable UPI QR with prefilled locks → Submit transaction reference → Track order status dynamically.
2.  **Restaurant Admin (Counter):** Live Kanban Board → Monitor incoming transactions → Validate customer-supplied UPI references → Accept/Sent to Kitchen → Assign delivery personnel → Monitor outstanding commission owed to the developer → Configure active **UPI ID** from Settings.
3.  **Kitchen Staff:** Kitchen Display System (KDS) → View active ticket queues (oldest first) → View custom customer cooking requests (e.g., "extra spicy") → Mark "Preparing" → Mark "Ready for Pickup".
4.  **Delivery Agent:** Delivery App → Monitor queue of ready orders assigned to them → Mark "Out for Delivery" → Access customer contact click-to-call link → Mark "Delivered" upon arrival at the desk.
5.  **Developer (Platform Owner):** Developer Console → Read-only operations list → Manage discount schemas (funded strictly out of the platform's 15% commission) → Review system audit trails → Payout settlement builder → Configure visible menu prices by allocating per-item developer-funded discounts.

---

## 📈 Specialized Business Features

### 1. Developer-Funded Discounts
To incentivize orders, the developer can fund discount campaigns:
*   **The Golden Rule:** All campaign discounts are absorbed **exclusively** by the platform's 15% share. The restaurant's 85% share is never reduced.
*   **System Safe-Cap:** The backend automatically caps any applied deal or per-item developer discount to a maximum of 15% of the order subtotal. If a deal exceeds this, the platform earnings become ₹0, but the restaurant payout remains perfectly protected.

### 2. Dine-In Table Bill Clubbing
In addition to deliveries, the systems support table dining:
*   Dine-in customers can order multiple rounds of food from their phones by putting in their Table Number.
*   Admins can view all unbilled, active table orders and **Club them into a single Bill** directly from the dashboard, completing the transactions collectively upon counter payment.

---

## 🗺️ Monorepo Directory Structure

```
C:\freelance\
├── FORCO_AMORE\               # Project 1: FORCO AMORE (Port 3089)
│   ├── backend\               # Node.js + Express API + Prisma
│   └── forco_amore\           # Shared static vanilla frontend views
│
├── cafeteria_green\           # Project 2: Cafeteria Green (Port 3088)
│   ├── backend\               # Node.js + Express API + Prisma
│   └── cafeteria-green\       # Shared static vanilla frontend views
│
└── MONOREPO_DOCUMENTATION.md  # Your private local reference (Not in Git)
```

---

## 🧼 Pretty URLs & Port Architectures

Both servers run concurrently on remapped, non-conflicting local ports:
*   **Cafeteria Green:** Port **`3088`**
*   **FORCO AMORE:** Port **`3089`**

Both backends feature an absolute-path file server that translates requests into "Pretty URLs," hiding the `.html` extension completely on the browser:

| View | Cafeteria Green | FORCO AMORE |
| :--- | :--- | :--- |
| **Landing Page** | `http://localhost:3088/` | `http://localhost:3089/` |
| **Customer App** | `http://localhost:3088/customer` | `http://localhost:3089/customer` |
| **Admin Panel** | `http://localhost:3088/admin` | `http://localhost:3089/admin` |
| **Kitchen (KDS)** | `http://localhost:3088/kitchen` | `http://localhost:3089/kitchen` |
| **Delivery App** | `http://localhost:3088/delivery` | `http://localhost:3089/delivery` |
| **Developer Panel** | `http://localhost:3088/developer` | `http://localhost:3089/developer` |

---

## 🚀 Step-by-Step Local Setup

To run either project locally, execute the following commands in order:

### 1. Install Project Dependencies
```bash
# For Cafeteria Green
cd cafeteria_green/backend
npm install

# For FORCO AMORE
cd FORCO_AMORE/backend
npm install
```

### 2. Configure Local Environment (`.env`)
Create a `.env` file in the root of each backend directory:
```env
PORT=3088 # Use 3089 for FORCO_AMORE
NODE_ENV=development
DATABASE_URL=postgresql://your_user:your_password@localhost:5432/your_db_name
JWT_SECRET=your-secure-jwt-key
```

### 3. Sync Database schema
Initialize migrations and Prisma Client compilation:
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 4. Start the Application
```bash
npm start
# or during development
npm run dev
```

---

## 🐳 Containerized Production Deployment

Both projects feature a dedicated production-ready `Dockerfile` in their backend roots to simplify deployments to containerized cloud setups like **AWS ECS** or **AWS Elastic Beanstalk**.

### Build & Execute locally using Docker:

```bash
# Build the production Docker containers
docker build -t cafeteria-green-backend cafeteria_green/backend
docker build -t forco-amore-backend FORCO_AMORE/backend

# Launch the containers, passing database URLs as system variables
docker run -d -p 3088:3088 -e DATABASE_URL="postgresql://user:password@aws-rds:5432/db" cafeteria-green-backend
docker run -d -p 3089:3089 -e DATABASE_URL="postgresql://user:password@aws-rds:5432/db" forco-amore-backend
```

*   **Frontend Cloud Hosting (Vercel):** You can easily deploy the frontend static folders (`forco_amore` and `cafeteria-green`) to Vercel simply by linking this Git repository and setting the project root directories to the respective folders.

---
*Private local documentation index. Incorporates business model, user permissions, table clubbing parameters, and monorepo port routing configurations.*
