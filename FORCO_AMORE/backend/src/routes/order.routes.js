// ============================================================
// ORDER ROUTES (Customer)
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import QRCode from 'qrcode';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateOrderContext } from '../services/orderService.js';
import { calculateDealDiscount, calculateOrderFinancials, clampDevDiscount, resolveLine } from '../services/orderService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const prisma = new PrismaClient();

// UPI payee config (override in .env)
function buildUpiUri(amount, note, upiId, payeeName) {
    const params = new URLSearchParams({
        pa: upiId,
        pn: payeeName || 'Forco Amore',
        am: Number(amount).toFixed(2),
        cu: 'INR',
        tn: note || 'Forco Amore order'
    });
    return `upi://pay?${params.toString()}`;
}

/**
 * Recompute the order total from a cart (server-side price snapshot + optional deal).
 * Shared by /preview, /payment-qr and POST / so the amount is always consistent.
 */
async function computeCartTotal(items, dealCode, userId) {
    if (!items || items.length === 0) {
        throw new AppError('Cart is empty', 400, 'EMPTY_CART');
    }
    const menuItemIds = items.map(i => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
        where: { id: { in: menuItemIds }, isAvailable: true }
    });
    if (menuItems.length !== menuItemIds.length) {
        const found = new Set(menuItems.map(m => m.id));
        const missing = menuItemIds.filter(id => !found.has(id));
        throw new AppError(`Items not available: ${missing.join(', ')}`, 400, 'ITEMS_UNAVAILABLE');
    }
    const itemMap = new Map(menuItems.map(m => [m.id, m]));
    let subtotal = 0, devDiscount = 0;
    for (const item of items) {
        const line = resolveLine(itemMap.get(item.menuItemId), item.variant);
        subtotal += line.unitPrice * item.quantity;
        devDiscount += line.devDiscount * item.quantity;
    }
    subtotal = Math.round(subtotal * 100) / 100;
    devDiscount = Math.round(devDiscount * 100) / 100;

    let dealDiscount = 0;
    if (dealCode) {
        const deal = await prisma.deal.findFirst({
            where: { id: dealCode, isActive: true, startsAt: { lte: new Date() }, expiresAt: { gte: new Date() } }
        });
        if (deal) dealDiscount = calculateDealDiscount(deal, subtotal, userId);
    }
    // Both developer per-item discounts and deals come out of the platform's 15% share
    return calculateOrderFinancials(subtotal, Math.round((devDiscount + dealDiscount) * 100) / 100);
}

// All routes require customer authentication
router.use(authenticate, authorize('customer'));

// ──────────────────────────────────────────────
// PAYMENT QR (real UPI QR with prefilled amount)
// ──────────────────────────────────────────────
router.post('/payment-qr', async (req, res, next) => {
    try {
        const { items, dealCode } = req.body;
        const financials = await computeCartTotal(items, dealCode, req.user.id);
        const amount = financials.customerPays;

        const upiIdSetting = await prisma.setting.findUnique({ where: { key: 'upi_id' } });
        const upiId = upiIdSetting?.value || process.env.UPI_VPA || 'forcoamore@paytm';
        const upiPayeeName = process.env.UPI_PAYEE_NAME || 'Forco Amore';

        const upiUri = buildUpiUri(amount, `Forco Amore - ${req.user.name}`, upiId, upiPayeeName);
        const qr = await QRCode.toDataURL(upiUri, { width: 320, margin: 1, color: { dark: '#1a2e22', light: '#ffffff' } });

        res.json({
            amount,
            currency: 'INR',
            upiUri,
            qr,
            payeeVpa: upiId,
            payeeName: upiPayeeName,
            financials
        });
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// DEALS
// ──────────────────────────────────────────────
router.get('/deals', async (req, res, next) => {
    try {
        const deals = await prisma.deal.findMany({
            where: {
                isActive: true,
                startsAt: { lte: new Date() },
                expiresAt: { gte: new Date() }
            },
            include: {
                applicableItem: true
            }
        });
        res.json(deals.map(d => ({
            id: d.id,
            title: d.title,
            description: d.description,
            discountType: d.discountType,
            discountValue: parseFloat(d.discountValue),
            maxDiscountAmount: d.maxDiscountAmount ? parseFloat(d.maxDiscountAmount) : null,
            minOrderAmount: parseFloat(d.minOrderAmount),
            expiresAt: d.expiresAt,
            applicableItem: d.applicableItem || null
        })));
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// ORDER PREVIEW
// ──────────────────────────────────────────────
router.post('/preview', async (req, res, next) => {
    try {
        const { items, dealCode } = req.body;

        if (!items || items.length === 0) {
            throw new AppError('Cart is empty', 400, 'EMPTY_CART');
        }

        const menuItemIds = items.map(i => i.menuItemId);
        const menuItems = await prisma.menuItem.findMany({
            where: { id: { in: menuItemIds }, isAvailable: true }
        });

        const priceMap = new Map(menuItems.map(m => [m.id, parseFloat(m.price)]));

        let subtotal = 0;
        const itemDetails = items.map(item => {
            const price = priceMap.get(item.menuItemId);
            if (!price) throw new AppError(`Item ${item.menuItemId} not available`, 400);
            const total = price * item.quantity;
            subtotal += total;
            return { ...item, unitPrice: price, itemTotal: total };
        });

        subtotal = Math.round(subtotal * 100) / 100;

        let discount = 0;
        let dealInfo = null;

        if (dealCode) {
            const deal = await prisma.deal.findFirst({
                where: { id: dealCode, isActive: true, startsAt: { lte: new Date() }, expiresAt: { gte: new Date() } }
            });

            if (deal) {
                discount = calculateDealDiscount(deal, subtotal, req.user.id);
                dealInfo = { id: deal.id, title: deal.title, discount };
            }
        }

        const financials = calculateOrderFinancials(subtotal, discount);

        res.json({
            items: itemDetails,
            deal: dealInfo,
            financials,
            requiresContext: true,
        });
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// PLACE ORDER
// ──────────────────────────────────────────────
router.post('/', async (req, res, next) => {
    try {
        const {
            items,
            orderType = 'DELIVERY',
            paymentMethod = 'ONLINE',
            context, // Contains delivery info, table number, etc.
            dealCode,
            transactionId,
            specialRequest
        } = req.body;

        if (!items || items.length === 0) {
            throw new AppError('Your cart is empty.', 400, 'EMPTY_CART');
        }

        const sanitizedContext = validateOrderContext(context, orderType);

        if (paymentMethod === 'ONLINE' && !transactionId) {
            throw new AppError('Transaction ID is required for online payments.', 400, 'MISSING_TRANSACTION_ID');
        }

        const menuItemIds = items.map(i => i.menuItemId);
        const menuItems = await prisma.menuItem.findMany({
            where: { id: { in: menuItemIds }, isAvailable: true }
        });

        if (menuItems.length !== menuItemIds.length) {
            const foundIds = new Set(menuItems.map(m => m.id));
            const missing = menuItemIds.filter(id => !foundIds.has(id));
            throw new AppError(`Items not available: ${missing.join(', ')}`, 400, 'ITEMS_UNAVAILABLE');
        }
        
        const itemMap = new Map(menuItems.map(m => [m.id, m]));
        let subtotal = 0;
        let developerDiscountTotal = 0;
        const orderItems = items.map(item => {
            const line = resolveLine(itemMap.get(item.menuItemId), item.variant);
            developerDiscountTotal += line.devDiscount * item.quantity;
            const itemTotal = Math.round(line.unitPrice * item.quantity * 100) / 100;
            subtotal += itemTotal;
            return { menuItemId: item.menuItemId, itemName: line.itemName, variant: line.variant, quantity: item.quantity, unitPrice: line.unitPrice, itemTotal };
        });

        subtotal = Math.round(subtotal * 100) / 100;
        developerDiscountTotal = Math.round(developerDiscountTotal * 100) / 100;
        
        let appliedDeal = null;
        let dealDiscount = 0;
        if (dealCode) {
            appliedDeal = await prisma.deal.findFirst({
                where: { id: dealCode, isActive: true, startsAt: { lte: new Date() }, expiresAt: { gte: new Date() } }
            });
            if (appliedDeal) {
                const userUsage = await prisma.dealUsage.count({ where: { dealId: appliedDeal.id, userId: req.user.id } });
                if (userUsage >= appliedDeal.maxUsesPerUser) throw new AppError('Deal usage limit reached', 400, 'DEAL_LIMIT_REACHED');
                dealDiscount = calculateDealDiscount(appliedDeal, subtotal, req.user.id);
                if (dealDiscount === 0) throw new AppError('Deal not applicable', 400, 'DEAL_NOT_APPLICABLE');
            }
        }
        
        const discountAmount = Math.round((developerDiscountTotal + dealDiscount) * 100) / 100;
        const financials = calculateOrderFinancials(subtotal, discountAmount);
        
        const orderNumber = await generateOrderNumber();
        
        const initialStatus = paymentMethod === 'COUNTER' ? 'accepted' : 'payment_verification_pending';
        const paidAt = paymentMethod === 'COUNTER' ? null : new Date();

        const order = await prisma.$transaction(async (tx) => {
            const newOrder = await tx.order.create({
                data: {
                    orderNumber,
                    userId: req.user.id,
                    ...sanitizedContext,
                    orderType,
                    paymentMethod,
                    specialRequest: (specialRequest && String(specialRequest).trim().slice(0, 500)) || null,
                    transactionId: paymentMethod === 'ONLINE' ? transactionId : null,
                    ...financials,
                    appliedDealId: appliedDeal?.id || null,
                    status: initialStatus,
                    paidAt,
                    items: { create: orderItems }
                },
                include: { items: true }
            });

            await tx.orderLog.create({
                data: {
                    orderId: newOrder.id,
                    fromStatus: null,
                    toStatus: initialStatus,
                    changedBy: req.user.id,
                    changedByRole: 'customer',
                    notes: `Order placed via ${orderType} / ${paymentMethod}`,
                    metadata: { subtotal: financials.subtotal, customerPays: financials.customerPays, dealId: appliedDeal?.id }
                }
            });

            if (appliedDeal) {
                await tx.dealUsage.create({ data: { dealId: appliedDeal.id, userId: req.user.id, orderId: newOrder.id } });
                await tx.deal.update({ where: { id: appliedDeal.id }, data: { currentUses: { increment: 1 } } });
            }

            return newOrder;
        });

        const io = req.app.get('io');
        if (io) {
            io.to('admin_feed').emit('order:new', {
                orderId: order.id,
                orderNumber: order.orderNumber,
                customerName: req.user.name,
                total: order.customerPays,
                status: order.status
            });
        }

        res.status(201).json(order);
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// ORDER LISTING & DETAIL
// ──────────────────────────────────────────────

// ── GET /orders — List own orders ──
router.get('/', async (req, res, next) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = { userId: req.user.id };
        if (status) where.status = status;

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    items: true,
                    appliedDeal: { select: { id: true, title: true } }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.order.count({ where })
        ]);

        res.json({
            orders: orders.map(formatOrder),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (err) {
        next(err);
    }
});

// ── GET /orders/:id — Order detail ──
router.get('/:id', async (req, res, next) => {
    try {
        const order = await prisma.order.findFirst({
            where: {
                id: req.params.id,
                userId: req.user.id
            },
            include: {
                items: true,
                appliedDeal: { select: { id: true, title: true, discountType: true, discountValue: true } },
                assignedDelivery: { select: { name: true, phone: true } },
                logs: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                        fromStatus: true,
                        toStatus: true,
                        notes: true,
                        createdAt: true
                    }
                }
            }
        });

        if (!order) {
            throw new AppError('Order not found', 404, 'NOT_FOUND');
        }

        res.json(formatOrder(order));
    } catch (err) {
        next(err);
    }
});

// ── Helpers ──

/**
 * Generate a unique, human-readable order number: FA-YYMMDD-#### (daily counter).
 */
async function generateOrderNumber() {
    const now = new Date();
    const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const countToday = await prisma.order.count({ where: { createdAt: { gte: dayStart } } });
    let seq = countToday + 1;
    // Guard against collisions (concurrent placement / retries)
    for (let attempt = 0; attempt < 50; attempt++) {
        const candidate = `FA-${ymd}-${String(seq).padStart(4, '0')}`;
        const exists = await prisma.order.findUnique({ where: { orderNumber: candidate } });
        if (!exists) return candidate;
        seq++;
    }
    return `FA-${ymd}-${Date.now().toString().slice(-5)}`;
}

function formatOrder(order) {
    return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        orderType: order.orderType,
        paymentMethod: order.paymentMethod,
        items: order.items.map(i => ({
            menuItemId: i.menuItemId,
            name: i.itemName,
            variant: i.variant,
            quantity: i.quantity,
            unitPrice: parseFloat(i.unitPrice),
            total: parseFloat(i.itemTotal)
        })),
        specialRequest: order.specialRequest,
        context: {
            name: order.deliveryName,
            phone: order.deliveryPhone,
            building: order.buildingName,
            floorSeat: order.floorSeat,
            notes: order.deliveryNotes,
            tableNumber: order.tableNumber
        },
        deliveryAgent: (order.assignedDelivery && ['out_for_delivery', 'delivered'].includes(order.status))
            ? { name: order.assignedDelivery.name, phone: order.assignedDelivery.phone }
            : null,
        financials: {
            subtotal: parseFloat(order.subtotal),
            discountAmount: parseFloat(order.discountAmount),
            customerPays: parseFloat(order.customerPays)
        },
        deal: order.appliedDeal ? {
            id: order.appliedDeal.id,
            title: order.appliedDeal.title
        } : null,
        payment: {
            paidAt: order.paidAt
        },
        statusTimeline: order.logs || [],
        timestamps: {
            created: order.createdAt,
            paid: order.paidAt,
            delivered: order.deliveredAt
        }
    };
}

export default router;
