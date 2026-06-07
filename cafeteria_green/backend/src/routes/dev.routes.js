// ============================================================
// DEVELOPER ROUTES — Platform Dashboard (Read-Only + Deals)
// Developer can:
//   - View all order logs (read-only)
//   - View app statistics and analytics
//   - View revenue and commission reports
//   - View outstanding commission
//   - CREATE / UPDATE / DEACTIVATE deals (discounts from their share)
// Developer CANNOT:
//   - Modify orders, menu items, or any operational data
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import { getPlatformDashboard, getOutstandingCommission, getSettlementHistory, createSettlement, getDevUpi, setDevUpi, listCommissionPayments, verifyCommissionPayment, rejectCommissionPayment } from '../services/revenueService.js';
import { createDeal, updateDeal, deactivateDeal, getAllDeals, getDealStats } from '../services/dealService.js';
import { clampDevDiscount, visiblePrice } from '../services/orderService.js';
import { PLATFORM_FEE_RATE } from '../config/constants.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const prisma = new PrismaClient();

// All routes require developer authentication
router.use(authenticate, authorize('developer'));

// ══════════════════════════════════════════════
// MENU PRICING — developer manages the customer-visible price by
// discounting out of their 15% share (per item).
// ══════════════════════════════════════════════

const r2 = (n) => Math.round(n * 100) / 100;

// Categories exempt from the 15% platform fee (100% restaurant).
const EXEMPT_CATEGORIES = ['cafeteria special thali'];

function pricingRow(item) {
    const base = parseFloat(item.price);
    const exempt = EXEMPT_CATEGORIES.includes(item.category.toLowerCase());
    const discount = exempt ? 0 : clampDevDiscount(item.price, item.developerDiscount);
    const grossShare = exempt ? 0 : r2(base * PLATFORM_FEE_RATE);
    return {
        id: item.id,
        name: item.name,
        category: item.category,
        isAvailable: item.isAvailable,
        basePrice: base,
        restaurantShare: exempt ? base : r2(base * (1 - PLATFORM_FEE_RATE)),
        developerGrossShare: grossShare,
        maxDiscount: grossShare,
        developerDiscount: discount,
        visiblePrice: exempt ? base : visiblePrice(item.price, item.developerDiscount),
        developerNetShare: r2(grossShare - discount),
        exempt
    };
}

// ── GET /dev/pricing — per-item pricing & developer share ──
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

// ── PATCH /dev/pricing/:id — set the per-item developer discount ──
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
        const maxDiscount = r2(base * PLATFORM_FEE_RATE);
        if (requested > maxDiscount + 0.001) {
            throw new AppError(`Discount can be at most ₹${maxDiscount} (the 15% developer share on this item)`, 400, 'DISCOUNT_TOO_HIGH');
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
// DASHBOARD & STATISTICS
// ══════════════════════════════════════════════

// ── GET /dev/dashboard — Main analytics dashboard ──
router.get('/dashboard', async (req, res, next) => {
    try {
        const { period, startDate, endDate } = req.query;
        const dashboard = await getPlatformDashboard({ period, startDate, endDate });
        res.json(dashboard);
    } catch (err) {
        next(err);
    }
});

// ── GET /dev/outstanding — Outstanding commission details ──
router.get('/outstanding', async (req, res, next) => {
    try {
        const outstanding = await getOutstandingCommission();
        res.json(outstanding);
    } catch (err) {
        next(err);
    }
});

// ══════════════════════════════════════════════
// COMMISSION SETTLEMENT (restaurant → developer)
// ══════════════════════════════════════════════

// ── GET /dev/commission — summary + payout UPI + payment history ──
router.get('/commission', async (req, res, next) => {
    try {
        const [outstanding, devUpi, payments] = await Promise.all([
            getOutstandingCommission(),
            getDevUpi(),
            listCommissionPayments()
        ]);
        res.json({ summary: outstanding.summary, devUpi, payments });
    } catch (err) {
        next(err);
    }
});

// ── PUT /dev/commission/upi — developer sets the UPI ID they get paid at ──
router.put('/commission/upi', async (req, res, next) => {
    try {
        const upiId = await setDevUpi(req.body.upiId);
        res.json({ upiId, message: 'Payout UPI ID saved' });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /dev/commission/payments/:id/verify — confirm a restaurant payment ──
router.patch('/commission/payments/:id/verify', async (req, res, next) => {
    try {
        const payment = await verifyCommissionPayment(req.params.id);
        res.json({ message: 'Payment verified — outstanding reduced', payment });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /dev/commission/payments/:id/reject — reject a restaurant payment ──
router.patch('/commission/payments/:id/reject', async (req, res, next) => {
    try {
        const payment = await rejectCommissionPayment(req.params.id, req.body.reason);
        res.json({ message: 'Payment rejected', payment });
    } catch (err) {
        next(err);
    }
});

// ══════════════════════════════════════════════
// ORDER LOGS (Read-Only)
// ══════════════════════════════════════════════

// ── GET /dev/orders — All orders with full details ──
router.get('/orders', async (req, res, next) => {
    try {
        const {
            status,
            dateFrom,
            dateTo,
            search,
            page = 1,
            limit = 50,
            hasDeals
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const where = {};

        if (status) where.status = status;
        if (hasDeals === 'true') where.appliedDealId = { not: null };
        if (hasDeals === 'false') where.appliedDealId = null;

        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) where.createdAt.gte = new Date(dateFrom);
            if (dateTo) where.createdAt.lte = new Date(dateTo);
        }

        if (search) {
            where.OR = [
                { orderNumber: { contains: search, mode: 'insensitive' } },
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { buildingName: { contains: search, mode: 'insensitive' } }
            ];
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    items: true,
                    user: { select: { name: true, email: true, phone: true } },
                    appliedDeal: { select: { id: true, title: true, discountType: true, discountValue: true } },
                    logs: {
                        orderBy: { createdAt: 'asc' },
                        select: {
                            fromStatus: true,
                            toStatus: true,
                            changedByRole: true,
                            notes: true,
                            createdAt: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.order.count({ where })
        ]);

        res.json({
            orders: orders.map(o => ({
                orderNumber: o.orderNumber,
                status: o.status,
                customer: { name: o.user.name, email: o.user.email },
                delivery: {
                    building: o.buildingName,
                    floorSeat: o.floorSeat
                },
                items: o.items.map(i => ({
                    name: i.itemName,
                    qty: i.quantity,
                    total: parseFloat(i.itemTotal)
                })),
                financials: {
                    subtotal: parseFloat(o.subtotal),
                    discountAmount: parseFloat(o.discountAmount),
                    customerPays: parseFloat(o.customerPays),
                    platformFee: parseFloat(o.platformFee),
                    discountFromPlatform: parseFloat(o.discountFromPlatform),
                    platformEarnings: parseFloat(o.platformEarnings),
                    restaurantShare: parseFloat(o.restaurantShare)
                },
                deal: o.appliedDeal ? {
                    id: o.appliedDeal.id,
                    title: o.appliedDeal.title,
                    type: o.appliedDeal.discountType,
                    value: parseFloat(o.appliedDeal.discountValue)
                } : null,
                payment: {
                    verified: !!o.paidAt,
                    transactionId: o.transactionId,
                    paidAt: o.paidAt
                },
                auditLog: o.logs.map(l => ({
                    from: l.fromStatus,
                    to: l.toStatus,
                    by: l.changedByRole,
                    notes: l.notes,
                    at: l.createdAt
                })),
                timestamps: {
                    created: o.createdAt,
                    delivered: o.deliveredAt
                },
                settled: o.isSettled
            })),
            pagination: { page: parseInt(page), limit: parseInt(limit), total }
        });
    } catch (err) {
        next(err);
    }
});

// ── GET /dev/orders/:id — Single order with full audit log ──
router.get('/orders/:id', async (req, res, next) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                items: true,
                user: { select: { name: true, email: true, phone: true } },
                appliedDeal: true,
                logs: {
                    orderBy: { createdAt: 'asc' },
                    include: {
                        changedByUser: { select: { name: true, role: true } }
                    }
                }
            }
        });

        if (!order) {
            throw new AppError('Order not found', 404, 'NOT_FOUND');
        }

        res.json({
            ...order,
            subtotal: parseFloat(order.subtotal),
            discountAmount: parseFloat(order.discountAmount),
            customerPays: parseFloat(order.customerPays),
            platformFee: parseFloat(order.platformFee),
            platformEarnings: parseFloat(order.platformEarnings),
            restaurantShare: parseFloat(order.restaurantShare),
            items: order.items.map(i => ({
                ...i,
                unitPrice: parseFloat(i.unitPrice),
                itemTotal: parseFloat(i.itemTotal)
            })),
            logs: order.logs.map(l => ({
                from: l.fromStatus,
                to: l.toStatus,
                by: l.changedByUser?.name || 'System',
                role: l.changedByRole,
                notes: l.notes,
                metadata: l.metadata,
                at: l.createdAt
            }))
        });
    } catch (err) {
        next(err);
    }
});

// ══════════════════════════════════════════════
// DEALS MANAGEMENT (Developer Only — Create/Update)
// ══════════════════════════════════════════════

// ── GET /dev/deals — All deals (including inactive) ──
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

// ── GET /dev/deals/:id/stats — Deal usage stats ──
router.get('/deals/:id/stats', async (req, res, next) => {
    try {
        const stats = await getDealStats(req.params.id);
        res.json(stats);
    } catch (err) {
        next(err);
    }
});

// ── POST /dev/deals — Create new deal ──
router.post('/deals', async (req, res, next) => {
    try {
        const deal = await createDeal(req.user.id, req.body);
        res.status(201).json({
            ...deal,
            discountValue: parseFloat(deal.discountValue),
            message: 'Deal created successfully'
        });
    } catch (err) {
        next(err);
    }
});

// ── PUT /dev/deals/:id — Update deal ──
router.put('/deals/:id', async (req, res, next) => {
    try {
        const deal = await updateDeal(req.params.id, req.user.id, req.body);
        res.json({
            ...deal,
            discountValue: parseFloat(deal.discountValue),
            message: 'Deal updated successfully'
        });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /dev/deals/:id/deactivate — Deactivate deal ──
router.patch('/deals/:id/deactivate', async (req, res, next) => {
    try {
        const deal = await deactivateDeal(req.params.id, req.user.id);
        res.json({ message: 'Deal deactivated', dealId: deal.id });
    } catch (err) {
        next(err);
    }
});

// ══════════════════════════════════════════════
// SETTLEMENTS
// ══════════════════════════════════════════════

// ── GET /dev/settlements — Settlement history ──
router.get('/settlements', async (req, res, next) => {
    try {
        const settlements = await getSettlementHistory();
        res.json(settlements.map(s => ({
            ...s,
            grossRevenue: parseFloat(s.grossRevenue),
            totalDiscounts: parseFloat(s.totalDiscounts),
            customerRevenue: parseFloat(s.customerRevenue),
            platformFeeTotal: parseFloat(s.platformFeeTotal),
            platformEarnings: parseFloat(s.platformEarnings),
            restaurantPayout: parseFloat(s.restaurantPayout)
        })));
    } catch (err) {
        next(err);
    }
});

// ── POST /dev/settlements — Create settlement ──
router.post('/settlements', async (req, res, next) => {
    try {
        const { periodStart, periodEnd, notes } = req.body;

        if (!periodStart || !periodEnd) {
            throw new AppError('Period start and end dates are required', 400, 'VALIDATION_ERROR');
        }

        const settlement = await createSettlement(periodStart, periodEnd, notes);
        res.status(201).json(settlement);
    } catch (err) {
        next(err);
    }
});

// ══════════════════════════════════════════════
// SYSTEM STATS (Read-Only)
// ══════════════════════════════════════════════

router.get('/stats', async (req, res, next) => {
    try {
        const [
            totalUsers,
            totalOrders,
            totalMenuItems,
            activeDeals
        ] = await Promise.all([
            prisma.user.count({ where: { role: 'customer' } }),
            prisma.order.count(),
            prisma.menuItem.count({ where: { isAvailable: true } }),
            prisma.deal.count({ where: { isActive: true } })
        ]);

        res.json({
            totalCustomers: totalUsers,
            totalOrders,
            activeMenuItems: totalMenuItems,
            activeDeals
        });
    } catch (err) {
        next(err);
    }
});

export default router;
