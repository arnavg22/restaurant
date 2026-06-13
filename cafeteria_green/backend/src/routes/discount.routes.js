// ============================================================
// DISCOUNT PANEL ROUTES
// A dedicated dashboard for managing:
//   - Discount schemes (deals)
//   - Per-item promotional discounts (pricing)
//   - Menu items (via the shared /menu endpoints, which also allow this role)
// This is separate from the Developer Console, which is left unchanged.
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import { createDeal, updateDeal, deactivateDeal, getAllDeals, getDealStats } from '../services/dealService.js';
import { PLATFORM_FEE_RATE } from '../config/constants.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const prisma = new PrismaClient();

// All routes require the discount role
router.use(authenticate, authorize('discount'));

const r2 = (n) => Math.round(n * 100) / 100;

// Categories exempt from the 4% platform fee (100% restaurant).
const EXEMPT_CATEGORIES = ['cafeteria special thali'];

function pricingRow(item) {
    const base = parseFloat(item.price);
    const exempt = EXEMPT_CATEGORIES.includes(item.category.toLowerCase());
    const discount = exempt ? 0 : parseFloat(item.developerDiscount || 0);
    const customerPrice = r2(base - discount);
    const devShare = exempt ? 0 : r2(customerPrice * PLATFORM_FEE_RATE);
    const restShare = exempt ? customerPrice : r2(customerPrice - devShare);
    return {
        id: item.id,
        name: item.name,
        category: item.category,
        section: item.section || 'Food',
        isAvailable: item.isAvailable,
        basePrice: base,
        developerDiscount: discount,
        visiblePrice: customerPrice,
        developerShare: devShare,
        restaurantShare: restShare,
        exempt
    };
}

// ══════════════════════════════════════════════
// PER-ITEM PRICING / DISCOUNTS
// ══════════════════════════════════════════════

// ── GET /discount/pricing — per-item pricing & discount ──
router.get('/pricing', async (req, res, next) => {
    try {
        const items = await prisma.menuItem.findMany({
            orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }]
        });
        res.json(items.map(pricingRow));
    } catch (err) {
        next(err);
    }
});

// ── PATCH /discount/pricing/:id — set the per-item promotional discount ──
router.patch('/pricing/:id', async (req, res, next) => {
    try {
        const { developerDiscount } = req.body;
        const item = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
        if (!item) throw new AppError('Menu item not found', 404, 'NOT_FOUND');

        if (EXEMPT_CATEGORIES.includes(item.category.toLowerCase())) {
            throw new AppError('This item is exempt from platform fee — discounts are not applicable', 400, 'EXEMPT_ITEM');
        }

        const base = parseFloat(item.price);
        const requested = parseFloat(developerDiscount);
        if (isNaN(requested) || requested < 0) {
            throw new AppError('Discount must be a positive number', 400, 'VALIDATION_ERROR');
        }
        if (requested >= base) {
            throw new AppError(`Discount cannot exceed the item price (₹${base})`, 400, 'DISCOUNT_TOO_HIGH');
        }

        const updated = await prisma.menuItem.update({
            where: { id: req.params.id },
            data: { developerDiscount: r2(requested) }
        });
        res.json(pricingRow(updated));
    } catch (err) {
        next(err);
    }
});

// ══════════════════════════════════════════════
// DISCOUNT SCHEMES (DEALS)
// ══════════════════════════════════════════════

// ── GET /discount/deals — All deals (including inactive) ──
router.get('/deals', async (req, res, next) => {
    try {
        const deals = await getAllDeals();
        res.json(deals.map(d => ({
            ...d,
            discountValue: parseFloat(d.discountValue),
            maxDiscountAmount: d.maxDiscountAmount ? parseFloat(d.maxDiscountAmount) : null,
            minOrderAmount: parseFloat(d.minOrderAmount),
            totalUsages: d._count.usages
        })));
    } catch (err) {
        next(err);
    }
});

// ── GET /discount/deals/:id/stats — Deal usage stats ──
router.get('/deals/:id/stats', async (req, res, next) => {
    try {
        const stats = await getDealStats(req.params.id);
        res.json(stats);
    } catch (err) {
        next(err);
    }
});

// ── POST /discount/deals — Create new deal ──
router.post('/deals', async (req, res, next) => {
    try {
        const deal = await createDeal(req.user.id, req.body);
        res.status(201).json({
            ...deal,
            discountValue: parseFloat(deal.discountValue),
            message: 'Scheme created successfully'
        });
    } catch (err) {
        next(err);
    }
});

// ── PUT /discount/deals/:id — Update deal (any deal, not just own) ──
router.put('/deals/:id', async (req, res, next) => {
    try {
        const deal = await updateDeal(req.params.id, req.user.id, req.body, { enforceOwner: false });
        res.json({
            ...deal,
            discountValue: parseFloat(deal.discountValue),
            message: 'Scheme updated successfully'
        });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /discount/deals/:id/deactivate — Deactivate deal ──
router.patch('/deals/:id/deactivate', async (req, res, next) => {
    try {
        const deal = await deactivateDeal(req.params.id, req.user.id, { enforceOwner: false });
        res.json({ message: 'Scheme deactivated', dealId: deal.id });
    } catch (err) {
        next(err);
    }
});

export default router;
