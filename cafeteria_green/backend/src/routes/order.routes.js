// ============================================================
// ORDER ROUTES (Customer)
// ============================================================
//
// ORDER FLOW ENFORCEMENT:
// ┌──────────────────────────────────────────────────────────┐
// │  Step 1: Browse menu (GET /menu)                         │
// │  Step 2: Add items to cart (client-side)                 │
// │  Step 3: Preview order total (POST /orders/preview)      │
// │  Step 4: Fill delivery info → validate                   │
// │          (POST /orders/validate-delivery)                │
// │  Step 5: Place order (POST /orders)                      │
// │          → Server validates delivery AGAIN               │
// │          → Creates Razorpay order                        │
// │          → Returns QR code data                          │
// │  Step 6: Pay via UPI scan                                │
// │  Step 7: Razorpay webhook auto-confirms                  │
// │                                                          │
// │  ★ CANNOT skip Step 4/5 — server rejects without         │
// │    complete delivery info. No QR = no payment.            │
// └──────────────────────────────────────────────────────────┘
// ============================================================

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import QRCode from 'qrcode';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateDeliveryInfo, validateOrderContext } from '../services/orderService.js';
import { calculateDealDiscount, calculateOrderFinancials, clampDevDiscount, resolveLine } from '../services/orderService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const prisma = new PrismaClient();

// UPI payee config (override in .env)
const UPI_VPA = process.env.UPI_VPA || 'cafeteriagrean@paytm';
const UPI_PAYEE_NAME = process.env.UPI_PAYEE_NAME || 'Cafeteria Green';

/**
 * Build a standard UPI deep-link (works with GPay / PhonePe / Paytm / any UPI app).
 * Amount is PREFILLED and locked so the customer pays the exact order total.
 */
function buildUpiUri(amount, note, vpa, payeeName) {
    const params = new URLSearchParams({
        pa: vpa || UPI_VPA,
        pn: payeeName || UPI_PAYEE_NAME,
        am: Number(amount).toFixed(2),
        cu: 'INR',
        tn: note || 'Cafeteria Green order'
    });
    return `upi://pay?${params.toString()}`;
}

/**
 * Read the admin-configured tax rates from settings.
 * Stored as percentages (e.g. "5", "18"); returned as fractions (0.05, 0.18).
 * Falls back to defaults (GST 5%, VAT 18%) when unset.
 */
async function getTaxRates() {
    const rows = await prisma.setting.findMany({
        where: { key: { in: ['gst_rate', 'vat_rate'] } }
    });
    const map = Object.fromEntries(rows.map(r => [r.key, parseFloat(r.value)]));
    const gst = Number.isFinite(map.gst_rate) ? map.gst_rate : 5;
    const vat = Number.isFinite(map.vat_rate) ? map.vat_rate : 18;
    return { gstRate: gst / 100, vatRate: vat / 100 };
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
    let subtotal = 0, devDiscount = 0, exemptSubtotal = 0, comboSubtotal = 0, alcoholSubtotal = 0;
    // Categories exempt from the 4% platform fee (100% goes to restaurant)
    const EXEMPT_CATEGORIES = ['cafeteria special thali'];
    for (const item of items) {
        const menuItem = itemMap.get(item.menuItemId);
        const line = resolveLine(menuItem, item.variant);
        const lineTotal = line.unitPrice * item.quantity;
        subtotal += lineTotal;
        devDiscount += line.devDiscount * item.quantity;
        if (line.isCombo) {
            comboSubtotal += lineTotal;
        }
        // Alcohol items (Bar section) are taxed as VAT instead of GST
        if (menuItem.section === 'Bar') {
            alcoholSubtotal += lineTotal;
        }
        if (EXEMPT_CATEGORIES.includes(menuItem.category.toLowerCase())) {
            exemptSubtotal += lineTotal;
        }
    }
    subtotal = Math.round(subtotal * 100) / 100;
    devDiscount = Math.round(devDiscount * 100) / 100;
    exemptSubtotal = Math.round(exemptSubtotal * 100) / 100;
    comboSubtotal = Math.round(comboSubtotal * 100) / 100;
    alcoholSubtotal = Math.round(alcoholSubtotal * 100) / 100;
    // Combos are not discountable — deals only apply to the rest of the cart.
    const discountableSubtotal = Math.round((subtotal - comboSubtotal) * 100) / 100;

    let dealDiscount = 0;
    if (dealCode) {
        const deal = await prisma.deal.findFirst({
            where: { id: dealCode, isActive: true, startsAt: { lte: new Date() }, expiresAt: { gte: new Date() } }
        });
        if (deal) dealDiscount = calculateDealDiscount(deal, subtotal, userId, discountableSubtotal);
    }
    const { gstRate, vatRate } = await getTaxRates();
    // Both developer per-item discounts and deals come out of the platform's 4% share
    return calculateOrderFinancials(
        subtotal,
        Math.round((devDiscount + dealDiscount) * 100) / 100,
        exemptSubtotal,
        { alcoholSubtotal, gstRate, vatRate }
    );
}

// All routes require customer authentication
router.use(authenticate, authorize('customer'));

// ──────────────────────────────────────────────
// PAYMENT QR (real UPI QR with prefilled amount)
// ──────────────────────────────────────────────

/**
 * POST /orders/payment-qr
 *
 * Generates a REAL, scannable UPI QR code (data URL) with the order amount
 * PREFILLED. The customer scans it with any UPI app, pays, then enters the
 * resulting transaction ID when placing the order.
 *
 * Body: { items: [{menuItemId, quantity}], dealCode? }
 * Returns: { amount, currency, upiUri, qr, payeeVpa, payeeName }
 */
router.post('/payment-qr', async (req, res, next) => {
    try {
        const { items, dealCode } = req.body;
        const financials = await computeCartTotal(items, dealCode, req.user.id);
        const amount = financials.customerPays;

        const upiIdSetting = await prisma.setting.findUnique({ where: { key: 'upi_id' } });
        const upiId = upiIdSetting?.value || process.env.UPI_VPA || 'cafeteriagrean@paytm';
        const upiPayeeName = process.env.UPI_PAYEE_NAME || 'Cafeteria Green';

        const upiUri = buildUpiUri(amount, `Cafeteria Green - ${req.user.name}`, upiId, upiPayeeName);
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
// ──────────────────────────────────────────────
// CAFE POINTS (Rewards)
// ──────────────────────────────────────────────

// ── GET /orders/points — Get customer's cafe points balance ──
router.get('/points', async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { cafePoints: true }
        });
        const points = user?.cafePoints || 0;
        // 10 points = ₹1
        const redeemValue = Math.round(points / 10 * 100) / 100;
        res.json({ points, redeemValue, rate: '10 points = ₹1' });
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// DEALS
// ──────────────────────────────────────────────

// ── GET /orders/deals — Get available deals ──
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
// DELIVERY INFO VALIDATION (Step 4)
// ──────────────────────────────────────────────

/**
 * POST /orders/validate-delivery
 *
 * Validates delivery info BEFORE the customer can proceed to payment.
 * This is a standalone endpoint so the frontend can:
 *   1. Show the delivery form
 *   2. Validate on submit
 *   3. Only show the "Pay Now" button if validation passes
 *
 * Returns: { valid: true, sanitized: { ... } } or 400 error
 *
 * Frontend should NOT proceed to POST /orders unless this returns valid.
 */
router.post('/validate-delivery', async (req, res, next) => {
    try {
        const { delivery } = req.body;

        // Run full validation (throws if invalid)
        validateDeliveryInfo(delivery);

        // Return sanitized data
        res.json({
            valid: true,
            message: 'Delivery details are complete',
            sanitized: {
                deliveryName: delivery.deliveryName,
                deliveryPhone: delivery.deliveryPhone,
                buildingName: delivery.buildingName,
                floorSeat: delivery.floorSeat,
                deliveryNotes: delivery.deliveryNotes || null
            }
        });
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// ORDER PREVIEW (Step 3)
// ──────────────────────────────────────────────

// ── POST /orders/preview — Preview order total before placing ──
router.post('/preview', async (req, res, next) => {
    try {
        const { items, dealCode } = req.body;

        if (!items || items.length === 0) {
            throw new AppError('Cart is empty', 400, 'EMPTY_CART');
        }

        // Fetch current prices
        const menuItemIds = items.map(i => i.menuItemId);
        const menuItems = await prisma.menuItem.findMany({
            where: { id: { in: menuItemIds }, isAvailable: true }
        });

        const priceMap = new Map(menuItems.map(m => [m.id, parseFloat(m.price)]));
        const comboSet = new Set(menuItems.filter(m => m.section === 'Combo').map(m => m.id));
        const alcoholSet = new Set(menuItems.filter(m => m.section === 'Bar').map(m => m.id));

        let subtotal = 0;
        let comboSubtotal = 0;
        let alcoholSubtotal = 0;
        const itemDetails = items.map(item => {
            const price = priceMap.get(item.menuItemId);
            if (!price) throw new AppError(`Item ${item.menuItemId} not available`, 400);
            const total = price * item.quantity;
            subtotal += total;
            if (comboSet.has(item.menuItemId)) comboSubtotal += total;
            if (alcoholSet.has(item.menuItemId)) alcoholSubtotal += total;
            return { ...item, unitPrice: price, itemTotal: total };
        });

        subtotal = Math.round(subtotal * 100) / 100;
        comboSubtotal = Math.round(comboSubtotal * 100) / 100;
        alcoholSubtotal = Math.round(alcoholSubtotal * 100) / 100;
        // Combos are not discountable.
        const discountableSubtotal = Math.round((subtotal - comboSubtotal) * 100) / 100;

        // Apply deal if provided
        let discount = 0;
        let dealInfo = null;

        if (dealCode) {
            const deal = await prisma.deal.findFirst({
                where: {
                    id: dealCode,
                    isActive: true,
                    startsAt: { lte: new Date() },
                    expiresAt: { gte: new Date() }
                }
            });

            if (deal) {
                discount = calculateDealDiscount(deal, subtotal, req.user.id, discountableSubtotal);
                dealInfo = {
                    id: deal.id,
                    title: deal.title,
                    discount
                };
            }
        }

        const { gstRate, vatRate } = await getTaxRates();
        const financials = calculateOrderFinancials(subtotal, discount, 0, { alcoholSubtotal, gstRate, vatRate });

        res.json({
            items: itemDetails,
            deal: dealInfo,
            financials,
            // Tell frontend: delivery info is required before you can place this order
            requiresDeliveryInfo: true,
            deliveryFields: ['deliveryName', 'deliveryPhone', 'buildingName', 'floorSeat']
        });
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// PLACE ORDER (Step 5)
// ──────────────────────────────────────────────

/**
 * POST /orders — Place order
 *
 * Supports three order types: DELIVERY, DINE_IN, TAKEAWAY
 * Supports two payment methods: ONLINE (UPI), COUNTER (pay at counter)
 */
router.post('/', async (req, res, next) => {
    try {
        const {
            items,
            orderType = 'DELIVERY',
            paymentMethod = 'ONLINE',
            context, // Contains delivery info, table number, etc.
            dealCode,
            transactionId,
            specialRequest,
            redeemPoints, // Number of cafe points to redeem
            // Legacy support: accept 'delivery' field as context for DELIVERY orders
            delivery
        } = req.body;

        // ── Pre-check: items must exist ──
        if (!items || items.length === 0) {
            throw new AppError(
                'Your cart is empty. Please add items before placing an order.',
                400,
                'EMPTY_CART'
            );
        }

        // Use context or fall back to legacy delivery field
        const orderContext = context || delivery;

        // ── Validate context based on order type ──
        const sanitizedContext = validateOrderContext(orderContext, orderType);

        // ── Pre-check: transactionId must exist for ONLINE payment ──
        if (paymentMethod === 'ONLINE' && !transactionId) {
            throw new AppError(
                'Transaction ID is required. Please provide the transaction ID from your payment.',
                400,
                'MISSING_TRANSACTION_ID'
            );
        }

        // ── Validate and fetch menu items ──
        const menuItemIds = items.map(i => i.menuItemId);
        const menuItems = await prisma.menuItem.findMany({
            where: {
                id: { in: menuItemIds },
                isAvailable: true
            }
        });

        if (menuItems.length !== menuItemIds.length) {
            const found = new Set(menuItems.map(m => m.id));
            const missing = menuItemIds.filter(id => !found.has(id));
            throw new AppError(`Items not available: ${missing.join(', ')}`, 400, 'ITEMS_UNAVAILABLE');
        }

        // ── Delivery restriction: dine-in-only items can't be delivered/taken away ──
        if (orderType !== 'DINE_IN' && menuItems.some(m => m.deliveryAvailable === false)) {
            const offenders = menuItems.filter(m => m.deliveryAvailable === false).map(m => m.name);
            throw new AppError(
                `These items are dine-in only and can't be ordered for delivery or takeaway: ${offenders.join(', ')}.`,
                400,
                'DINE_IN_ONLY'
            );
        }

        // ── Calculate subtotal with price snapshot (resolves Bar variants) ──
        const itemMap = new Map(menuItems.map(m => [m.id, m]));
        // Categories exempt from the 4% platform fee (100% restaurant)
        const EXEMPT_CATEGORIES = ['cafeteria special thali'];

        let subtotal = 0;
        let developerDiscountTotal = 0;
        let exemptSubtotal = 0;
        let comboSubtotal = 0;
        let alcoholSubtotal = 0;
        const orderItems = items.map(item => {
            const menuItem = itemMap.get(item.menuItemId);
            const line = resolveLine(menuItem, item.variant);
            developerDiscountTotal += line.devDiscount * item.quantity;
            const itemTotal = Math.round(line.unitPrice * item.quantity * 100) / 100;
            subtotal += itemTotal;
            if (line.isCombo) {
                comboSubtotal += itemTotal;
            }
            // Alcohol items (Bar section) are taxed as VAT instead of GST
            if (menuItem.section === 'Bar') {
                alcoholSubtotal += itemTotal;
            }
            if (EXEMPT_CATEGORIES.includes(menuItem.category.toLowerCase())) {
                exemptSubtotal += itemTotal;
            }

            return {
                menuItemId: item.menuItemId,
                itemName: line.itemName,
                variant: line.variant,
                quantity: item.quantity,
                unitPrice: line.unitPrice,
                itemTotal
            };
        });

        subtotal = Math.round(subtotal * 100) / 100;
        developerDiscountTotal = Math.round(developerDiscountTotal * 100) / 100;
        comboSubtotal = Math.round(comboSubtotal * 100) / 100;
        alcoholSubtotal = Math.round(alcoholSubtotal * 100) / 100;
        // Combos are not discountable — deals only apply to the rest of the cart.
        const discountableSubtotal = Math.round((subtotal - comboSubtotal) * 100) / 100;

        // ── Apply deal if provided ──
        let appliedDeal = null;
        let dealDiscount = 0;

        if (dealCode) {
            appliedDeal = await prisma.deal.findFirst({
                where: {
                    id: dealCode,
                    isActive: true,
                    startsAt: { lte: new Date() },
                    expiresAt: { gte: new Date() }
                }
            });

            if (appliedDeal) {
                const userUsage = await prisma.dealUsage.count({
                    where: { dealId: appliedDeal.id, userId: req.user.id }
                });

                if (userUsage >= appliedDeal.maxUsesPerUser) {
                    throw new AppError('Deal usage limit reached', 400, 'DEAL_LIMIT_REACHED');
                }

                dealDiscount = calculateDealDiscount(appliedDeal, subtotal, req.user.id, discountableSubtotal);

                if (dealDiscount === 0) {
                    throw new AppError('Deal not applicable to this order', 400, 'DEAL_NOT_APPLICABLE');
                }
            }
        }

        // ── Calculate all financials ──
        const discountAmount = Math.round((developerDiscountTotal + dealDiscount) * 100) / 100;
        exemptSubtotal = Math.round(exemptSubtotal * 100) / 100;

        // ── Apply cafe points redemption ──
        let pointsToRedeem = 0;
        let pointsDiscount = 0;
        if (redeemPoints && parseInt(redeemPoints) > 0) {
            const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { cafePoints: true } });
            const available = user?.cafePoints || 0;
            pointsToRedeem = Math.min(parseInt(redeemPoints), available);
            // 10 points = ₹1
            pointsDiscount = Math.round(pointsToRedeem / 10 * 100) / 100;
            // Points discount cannot exceed the non-combo subtotal already net of other discounts
            // (combos are not discountable).
            const afterDealDiscountable = Math.round((discountableSubtotal - discountAmount) * 100) / 100;
            pointsDiscount = Math.min(pointsDiscount, Math.max(0, afterDealDiscountable));
            // Recalculate actual points used (in case we capped)
            pointsToRedeem = Math.round(pointsDiscount * 10);
        }

        const totalDiscount = Math.round((discountAmount + pointsDiscount) * 100) / 100;
        const { gstRate, vatRate } = await getTaxRates();
        const financials = calculateOrderFinancials(subtotal, totalDiscount, exemptSubtotal, { alcoholSubtotal, gstRate, vatRate });
        // gstAmount / vatAmount are for live display only; the Order table stores the combined taxAmount.
        const { gstAmount, vatAmount, ...persistFinancials } = financials;

        // ── Calculate points earned (10% of customerPays before tax, i.e., afterDiscount amount) ──
        const afterDiscountAmount = Math.round((subtotal - totalDiscount) * 100) / 100;
        const pointsEarned = Math.floor(afterDiscountAmount / 10); // 10% → 1 point per ₹10

        // ── Generate order number ──
        const orderNumber = await generateOrderNumber();

        // ── Determine initial status ──
        // ALL orders start as payment_verification_pending — admin must approve
        const initialStatus = 'payment_verification_pending';
        const paidAt = paymentMethod === 'ONLINE' ? new Date() : null;

        // ── Save everything in a transaction ──
        const order = await prisma.$transaction(async (tx) => {
            const newOrder = await tx.order.create({
                data: {
                    orderNumber,
                    userId: req.user.id,
                    orderType,
                    paymentMethod,
                    ...sanitizedContext,
                    specialRequest: (specialRequest && String(specialRequest).trim().slice(0, 500)) || null,
                    transactionId: paymentMethod === 'ONLINE' ? transactionId : null,
                    ...persistFinancials,
                    pointsEarned,
                    pointsRedeemed: pointsToRedeem,
                    appliedDealId: appliedDeal?.id || null,
                    status: initialStatus,
                    paidAt,
                    items: {
                        create: orderItems
                    }
                },
                include: {
                    items: true
                }
            });

            await tx.orderLog.create({
                data: {
                    orderId: newOrder.id,
                    fromStatus: null,
                    toStatus: initialStatus,
                    changedBy: req.user.id,
                    changedByRole: 'customer',
                    notes: `Order placed via ${orderType} / ${paymentMethod}`,
                    metadata: {
                        subtotal: financials.subtotal,
                        discount: financials.discountAmount,
                        customerPays: financials.customerPays,
                        pointsEarned,
                        pointsRedeemed: pointsToRedeem,
                        dealId: appliedDeal?.id || null,
                        dealTitle: appliedDeal?.title || null
                    }
                }
            });

            if (appliedDeal) {
                await tx.dealUsage.create({
                    data: {
                        dealId: appliedDeal.id,
                        userId: req.user.id,
                        orderId: newOrder.id
                    }
                });

                await tx.deal.update({
                    where: { id: appliedDeal.id },
                    data: { currentUses: { increment: 1 } }
                });
            }

            // Update user's cafe points: subtract redeemed, add earned
            await tx.user.update({
                where: { id: req.user.id },
                data: {
                    cafePoints: { increment: pointsEarned - pointsToRedeem }
                }
            });

            return newOrder;
        });

        // Notify admin via WebSocket
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
 * Generate a unique, human-readable order number: CG-YYMMDD-#### (daily counter).
 */
async function generateOrderNumber() {
    const now = new Date();
    const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const countToday = await prisma.order.count({ where: { createdAt: { gte: dayStart } } });
    let seq = countToday + 1;
    // Guard against collisions (concurrent placement / retries)
    for (let attempt = 0; attempt < 50; attempt++) {
        const candidate = `CG-${ymd}-${String(seq).padStart(4, '0')}`;
        const exists = await prisma.order.findUnique({ where: { orderNumber: candidate } });
        if (!exists) return candidate;
        seq++;
    }
    return `CG-${ymd}-${Date.now().toString().slice(-5)}`;
}

function formatOrder(order) {
    return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType || 'DELIVERY',
        paymentMethod: order.paymentMethod || 'ONLINE',
        status: order.status,
        items: order.items.map(i => ({
            menuItemId: i.menuItemId,
            name: i.itemName,
            variant: i.variant,
            quantity: i.quantity,
            unitPrice: parseFloat(i.unitPrice),
            total: parseFloat(i.itemTotal)
        })),
        specialRequest: order.specialRequest,
        delivery: {
            name: order.deliveryName,
            phone: order.deliveryPhone,
            building: order.buildingName,
            floorSeat: order.floorSeat,
            notes: order.deliveryNotes
        },
        tableNumber: order.tableNumber || null,
        // Delivery partner contact — only exposed to the customer once out for delivery
        deliveryAgent: (order.assignedDelivery && ['out_for_delivery', 'delivered'].includes(order.status))
            ? { name: order.assignedDelivery.name, phone: order.assignedDelivery.phone }
            : null,
        financials: {
            subtotal: parseFloat(order.subtotal),
            discountAmount: parseFloat(order.discountAmount),
            taxAmount: parseFloat(order.taxAmount || 0),
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
