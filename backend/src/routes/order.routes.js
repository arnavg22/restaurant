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
import { authenticate, authorize } from '../middleware/auth.js';
import { validateDeliveryInfo } from '../services/orderService.js';
import { calculateDealDiscount, calculateOrderFinancials } from '../services/orderService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const prisma = new PrismaClient();

// All routes require customer authentication
router.use(authenticate, authorize('customer'));

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

        let subtotal = 0;
        const itemDetails = items.map(item => {
            const price = priceMap.get(item.menuItemId);
            if (!price) throw new AppError(`Item ${item.menuItemId} not available`, 400);
            const total = price * item.quantity;
            subtotal += total;
            return { ...item, unitPrice: price, itemTotal: total };
        });

        subtotal = Math.round(subtotal * 100) / 100;

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
                discount = calculateDealDiscount(deal, subtotal, req.user.id);
                dealInfo = {
                    id: deal.id,
                    title: deal.title,
                    discount
                };
            }
        }

        const financials = calculateOrderFinancials(subtotal, discount);

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
 * THIS IS THE MAIN GATEWAY. The server enforces:
 *
 * 1. Cart must have items
 * 2. Delivery info MUST be complete (validated before anything else)
 * 3. Menu items must be available at current prices
 * 4. Deal (if any) must be valid and applicable
 * 5. Only THEN is a Razorpay order created (generating the QR)
 *
 * If delivery info is missing/incomplete → 400 error, NO order created, NO payment possible.
 */
router.post('/', async (req, res, next) => {
    try {
        const { items, delivery, dealCode, transactionId } = req.body;

        // ── Pre-check: items must exist ──
        if (!items || items.length === 0) {
            throw new AppError(
                'Your cart is empty. Please add items before placing an order.',
                400,
                'EMPTY_CART'
            );
        }

        // ── Pre-check: delivery object must exist ──
        if (!delivery) {
            throw new AppError(
                'Delivery information is required. Please provide your name, phone number, office building name, and desk/floor location.',
                400,
                'MISSING_DELIVERY_INFO'
            );
        }

        // ── Pre-check: transactionId must exist ──
        if (!transactionId) {
            throw new AppError(
                'Transaction ID is required. Please provide the transaction ID from your payment.',
                400,
                'MISSING_TRANSACTION_ID'
            );
        }

        // ── 1. Validate delivery info (mandatory) ──
        validateDeliveryInfo(delivery);

        // ── 2. Validate and fetch menu items ──
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

        // ── 3. Calculate subtotal with price snapshot ──
        const priceMap = new Map(menuItems.map(m => [m.id, parseFloat(m.price)]));
        const nameMap = new Map(menuItems.map(m => [m.id, m.name]));

        let subtotal = 0;
        const orderItems = items.map(item => {
            const unitPrice = priceMap.get(item.menuItemId);
            const itemTotal = Math.round(unitPrice * item.quantity * 100) / 100;
            subtotal += itemTotal;

            return {
                menuItemId: item.menuItemId,
                itemName: nameMap.get(item.menuItemId),
                quantity: item.quantity,
                unitPrice,
                itemTotal
            };
        });

        subtotal = Math.round(subtotal * 100) / 100;

        // ── 4. Apply deal if provided ──
        let appliedDeal = null;
        let discountAmount = 0;

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
                // Check per-user usage
                const userUsage = await prisma.dealUsage.count({
                    where: { dealId: appliedDeal.id, userId: req.user.id }
                });

                if (userUsage >= appliedDeal.maxUsesPerUser) {
                    throw new AppError('Deal usage limit reached', 400, 'DEAL_LIMIT_REACHED');
                }

                discountAmount = calculateDealDiscount(appliedDeal, subtotal, req.user.id);

                if (discountAmount === 0) {
                    throw new AppError('Deal not applicable to this order', 400, 'DEAL_NOT_APPLICABLE');
                }
            }
        }

        // ── 5. Calculate all financials ──
        const financials = calculateOrderFinancials(subtotal, discountAmount);

        // ── 6. Save everything in a transaction ──
        const order = await prisma.$transaction(async (tx) => {
            // Create the order
            const newOrder = await tx.order.create({
                data: {
                    userId: req.user.id,
                    deliveryName: delivery.deliveryName,
                    deliveryPhone: delivery.deliveryPhone,
                    buildingName: delivery.buildingName,
                    floorSeat: delivery.floorSeat,
                    deliveryNotes: delivery.deliveryNotes || null,
                    transactionId: transactionId,
                    ...financials,
                    appliedDealId: appliedDeal?.id || null,
                    status: 'payment_verification_pending',
                    items: {
                        create: orderItems
                    }
                },
                include: {
                    items: true
                }
            });

            // Create initial log entry
            await tx.orderLog.create({
                data: {
                    orderId: newOrder.id,
                    fromStatus: null,
                    toStatus: 'payment_verification_pending',
                    changedBy: req.user.id,
                    changedByRole: 'customer',
                    notes: 'Order placed, awaiting payment verification',
                    metadata: {
                        subtotal: financials.subtotal,
                        discount: financials.discountAmount,
                        customerPays: financials.customerPays,
                        dealId: appliedDeal?.id || null,
                        dealTitle: appliedDeal?.title || null
                    }
                }
            });

            // Record deal usage
            if (appliedDeal) {
                await tx.dealUsage.create({
                    data: {
                        dealId: appliedDeal.id,
                        userId: req.user.id,
                        orderId: newOrder.id
                    }
                });

                // Increment deal usage counter
                await tx.deal.update({
                    where: { id: appliedDeal.id },
                    data: { currentUses: { increment: 1 } }
                });
            }

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
function formatOrder(order) {
    return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        items: order.items.map(i => ({
            name: i.itemName,
            quantity: i.quantity,
            unitPrice: parseFloat(i.unitPrice),
            total: parseFloat(i.itemTotal)
        })),
        delivery: {
            name: order.deliveryName,
            phone: order.deliveryPhone,
            building: order.buildingName,
            floorSeat: order.floorSeat,
            notes: order.deliveryNotes
        },
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
