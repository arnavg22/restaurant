# 🏷️ Deals & Discount System

## How Discounts Work

**CRITICAL RULE: All discounts come from the platform's 15% share ONLY.**
The restaurant's revenue is NEVER affected by any deal.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Order Subtotal: ₹1000 (menu price total)                      │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Platform's 15% Share:  ₹150                            │   │
│   │  Restaurant's 85% Share: ₹850  ← NEVER TOUCHED          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   Deal: "₹100 off"                                              │
│   ────────────────────                                          │
│   Discount applied: ₹100 (from platform's ₹150)                 │
│   Platform keeps: ₹150 - ₹100 = ₹50                            │
│   Restaurant gets: ₹850 (unchanged!)                            │
│   Customer pays: ₹1000 - ₹100 = ₹900                           │
│                                                                 │
│   ────────────────────────────────────────────────────────────  │
│   ✓ Check: ₹850 + ₹50 = ₹900 = customer pays ✓                │
│                                                                 │
│   Deal: "₹200 off" on ₹1000 order                              │
│   ────────────────────                                          │
│   ❌ INVALID — max discount is ₹150 (15% of ₹1000)              │
│   System caps discount at ₹150                                  │
│   Platform keeps: ₹150 - ₹150 = ₹0 (free order for platform!) │
│   Restaurant still gets: ₹850                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Deal Types

### 1. Flat Discount
```
Example: "₹50 off on orders above ₹300"
  - Type: flat
  - Value: 50
  - Min order: 300
  
  Order ₹300 → discount = ₹50 → customer pays ₹250
  Order ₹500 → discount = ₹50 → customer pays ₹450
  Order ₹200 → not eligible (below ₹300)
```

### 2. Percentage Discount
```
Example: "10% off (max ₹100)"
  - Type: percent
  - Value: 10
  - Max cap: 100
  
  Order ₹300 → 10% = ₹30 → customer pays ₹270
  Order ₹800 → 10% = ₹80 → customer pays ₹720
  Order ₹1500 → 10% = ₹150, but capped at ₹100 → customer pays ₹1400
```

## Discount Cap Logic

```javascript
// The discount can NEVER exceed the platform's 15% commission
maxDiscount = subtotal × 0.15

// Examples:
// ₹500 order  → max discount = ₹75
// ₹1000 order → max discount = ₹150
// ₹2000 order → max discount = ₹300

// If a deal would give more than the cap:
// → Cap it at the platform's share
// → Platform earns ₹0 on that order (but restaurant is unaffected)
```

## Who Can Do What

| Action              | Developer | Admin | Customer |
|--------------------|:---------:|:-----:|:--------:|
| Create a deal       | ✅        | ❌    | ❌       |
| Update a deal       | ✅        | ❌    | ❌       |
| Deactivate a deal   | ✅        | ❌    | ❌       |
| View active deals   | ✅        | ✅    | ✅       |
| View deal stats     | ✅        | ❌    | ❌       |
| Apply a deal        | ❌        | ❌    | ✅       |

## Deal Validation Rules

Before a deal is applied to an order, the system checks:

1. **Is the deal active?** (`isActive = true`)
2. **Is it within the valid date range?** (`now >= startsAt AND now <= expiresAt`)
3. **Has the total usage limit been reached?** (`currentUses < maxTotalUses`)
4. **Has the user exceeded their per-user limit?** (check `deal_usage` table)
5. **Does the order meet the minimum amount?** (`subtotal >= minOrderAmount`)
6. **Is the discount within the platform cap?** (`discount <= subtotal × 0.15`)

If any check fails, the deal is not applied (order proceeds without discount).

## Deal Usage Tracking

```sql
-- Every time a deal is used, we record it:
INSERT INTO deal_usage (deal_id, user_id, order_id) VALUES (...);

-- And increment the counter:
UPDATE deals SET current_uses = current_uses + 1 WHERE id = ...;
```

## Outstanding Commission with Deals

```
┌─────────────────────────────────────────────────────────────────┐
│  OUTSTANDING COMMISSION = what restaurant owes platform          │
│                                                                 │
│  For each delivered, unsettled order:                           │
│    platform_earnings = platform_fee - discount_from_deal        │
│                                                                 │
│  TOTAL OUTSTANDING = Σ(platform_earnings)                       │
│                                                                 │
│  Example (5 orders):                                            │
│  ─────────────────                                              │
│  Order 1: ₹500 subtotal, no deal    → platform earns ₹75       │
│  Order 2: ₹800 subtotal, ₹50 off   → platform earns ₹120-50=₹70│
│  Order 3: ₹300 subtotal, no deal    → platform earns ₹45       │
│  Order 4: ₹600 subtotal, 10% off   → platform earns ₹90-60=₹30│
│  Order 5: ₹400 subtotal, no deal    → platform earns ₹60       │
│  ────────────────────────────────────────────────               │
│  TOTAL OUTSTANDING = ₹75+70+45+30+60 = ₹280                    │
│                                                                 │
│  Restaurant must pay platform ₹280                              │
└─────────────────────────────────────────────────────────────────┘
```

## API Endpoints

### Developer (Create/Manage Deals)
```
POST   /api/v1/dev/deals              Create deal
PUT    /api/v1/dev/deals/:id          Update deal
PATCH  /api/v1/dev/deals/:id/deactivate  Deactivate deal
GET    /api/v1/dev/deals              List all deals
GET    /api/v1/dev/deals/:id/stats    Deal usage stats
```

### Customer (Use Deals)
```
GET    /api/v1/orders/deals           List active deals
POST   /api/v1/orders/preview         Preview order with deal applied
POST   /api/v1/orders                 Place order (with optional dealCode)
```
