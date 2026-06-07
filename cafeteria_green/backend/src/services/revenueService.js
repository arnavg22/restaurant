// ============================================================
// REVENUE & SETTLEMENT SERVICE
// Handles commission tracking, outstanding amounts, reports
// ============================================================
import { PrismaClient } from '@prisma/client';
import { PLATFORM_FEE_RATE, RESTAURANT_SHARE_RATE } from '../config/constants.js';
import { AppError } from '../middleware/errorHandler.js';

const prisma = new PrismaClient();

// Developer's payout UPI is stored in the shared settings table under this key.
const DEV_UPI_KEY = 'dev_upi_id';

/**
 * ═══════════════════════════════════════════════════════════
 * OUTSTANDING COMMISSION CALCULATION
 * ═══════════════════════════════════════════════════════════
 *
 * This answers: "How much does the restaurant owe the platform?"
 *
 * For each DELIVERED but UNSETTLED order:
 *
 *   platform_fee        = subtotal × 0.15
 *   discount_from_deal  = discount applied (from platform share)
 *   platform_earnings   = platform_fee - discount_from_deal
 *
 *   TOTAL OUTSTANDING = Σ(platform_earnings) for all unsettled delivered orders
 *
 * Example:
 *   Order 1: subtotal ₹500, no deal  → platform earns ₹75
 *   Order 2: subtotal ₹800, ₹50 off → platform earns ₹120 - ₹50 = ₹70
 *   Order 3: subtotal ₹300, no deal  → platform earns ₹45
 *   ─────────────────────────────────────────────
 *   Outstanding = ₹75 + ₹70 + ₹45 = ₹190
 *
 * The restaurant must pay the platform ₹190.
 * ═══════════════════════════════════════════════════════════
 */
export async function getOutstandingCommission() {
    // All delivered orders not yet settled
    const unsettledOrders = await prisma.order.findMany({
        where: {
            status: 'delivered',
            isSettled: false
        },
        include: {
            items: {
                select: { itemName: true, quantity: true, itemTotal: true }
            },
            appliedDeal: {
                select: { id: true, title: true, discountType: true, discountValue: true }
            },
            user: {
                select: { id: true, name: true, email: true }
            }
        },
        orderBy: { deliveredAt: 'asc' }
    });

    let totalSubtotal = 0;
    let totalPlatformFee = 0;
    let totalDiscounts = 0;
    let totalPlatformEarnings = 0;
    let totalRestaurantShare = 0;
    let totalCustomerRevenue = 0;

    const orderDetails = unsettledOrders.map(order => {
        const subtotal = parseFloat(order.subtotal);
        const platformFee = parseFloat(order.platformFee);
        const discount = parseFloat(order.discountFromPlatform);
        const platformEarnings = parseFloat(order.platformEarnings);
        const restaurantShare = parseFloat(order.restaurantShare);
        const customerPays = parseFloat(order.customerPays);

        totalSubtotal += subtotal;
        totalPlatformFee += platformFee;
        totalDiscounts += discount;
        totalPlatformEarnings += platformEarnings;
        totalRestaurantShare += restaurantShare;
        totalCustomerRevenue += customerPays;

        return {
            orderId: order.id,
            orderNumber: order.orderNumber,
            customer: { name: order.user.name, email: order.user.email },
            deliveredAt: order.deliveredAt,
            items: order.items.map(i => ({
                name: i.itemName,
                qty: i.quantity,
                total: parseFloat(i.itemTotal)
            })),
            financials: {
                subtotal,
                platformFee,
                discount,
                platformEarnings,
                restaurantShare,
                customerPaid: customerPays
            },
            deal: order.appliedDeal ? {
                title: order.appliedDeal.title,
                type: order.appliedDeal.discountType,
                value: parseFloat(order.appliedDeal.discountValue)
            } : null
        };
    });

    // Restaurant→developer commission payments already recorded
    const [verifiedAgg, pendingAgg] = await Promise.all([
        prisma.commissionPayment.aggregate({ where: { status: 'verified' }, _sum: { amount: true } }),
        prisma.commissionPayment.aggregate({ where: { status: 'pending' }, _sum: { amount: true } })
    ]);
    const paid = parseFloat(verifiedAgg._sum.amount || 0);
    const pending = parseFloat(pendingAgg._sum.amount || 0);
    const netOutstanding = Math.max(0, totalPlatformEarnings - paid);
    const availableToPay = Math.max(0, totalPlatformEarnings - paid - pending);

    return {
        summary: {
            unsettledOrderCount: unsettledOrders.length,
            totalSubtotal: money(totalSubtotal),
            totalCustomerRevenue: money(totalCustomerRevenue),
            totalPlatformFee: money(totalPlatformFee),
            totalDiscountsFromPlatform: money(totalDiscounts),
            totalPlatformEarnings: money(totalPlatformEarnings),
            totalRestaurantShare: money(totalRestaurantShare),
            // Gross commission generated by delivered orders (before any payments)
            grossOutstanding: money(totalPlatformEarnings),
            // Commission already paid by the restaurant and verified by the developer
            totalPaid: money(paid),
            // Submitted by the restaurant but not yet verified by the developer
            totalPending: money(pending),
            // THE KEY NUMBER: what restaurant still owes the platform (net of verified payments)
            outstandingCommission: money(netOutstanding),
            // What the restaurant may still submit right now (also excludes pending payments)
            availableToPay: money(availableToPay)
        },
        orders: orderDetails
    };
}

/**
 * Get platform revenue dashboard stats.
 * For the Developer dashboard.
 */
export async function getPlatformDashboard(filters = {}) {
    const { startDate, endDate, period } = filters;

    // Default date ranges
    let dateFrom, dateTo;
    const now = new Date();

    if (startDate && endDate) {
        dateFrom = new Date(startDate);
        dateTo = new Date(endDate);
    } else {
        switch (period) {
            case 'today':
                dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                dateTo = now;
                break;
            case 'week':
                dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                dateTo = now;
                break;
            case 'month':
                dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
                dateTo = now;
                break;
            default:
                // All time
                dateFrom = new Date('2020-01-01');
                dateTo = now;
        }
    }

    // ── Delivered Orders Stats ──
    const deliveredStats = await prisma.order.aggregate({
        where: {
            status: 'delivered',
            deliveredAt: { gte: dateFrom, lte: dateTo }
        },
        _count: true,
        _sum: {
            subtotal: true,
            discountAmount: true,
            customerPays: true,
            platformFee: true,
            discountFromPlatform: true,
            platformEarnings: true,
            restaurantShare: true
        },
        _avg: {
            customerPays: true
        }
    });

    // ── Cancelled Orders Stats ──
    const cancelledStats = await prisma.order.aggregate({
        where: {
            status: 'cancelled',
            updatedAt: { gte: dateFrom, lte: dateTo }
        },
        _count: true,
        _sum: { subtotal: true, customerPays: true }
    });

    // ── Active Orders ──
    const activeOrders = await prisma.order.count({
        where: {
            status: {
                in: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']
            }
        }
    });

    // ── Today's breakdown ──
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStats = await prisma.order.aggregate({
        where: {
            status: 'delivered',
            deliveredAt: { gte: todayStart }
        },
        _count: true,
        _sum: {
            customerPays: true,
            platformEarnings: true,
            discountAmount: true
        }
    });

    // ── Deal impact ──
    const dealStats = await prisma.order.aggregate({
        where: {
            status: 'delivered',
            appliedDealId: { not: null },
            deliveredAt: { gte: dateFrom, lte: dateTo }
        },
        _count: true,
        _sum: { discountAmount: true }
    });

    // ── Unsettled total ──
    const unsettled = await getOutstandingCommission();

    // ── Top items ──
    const topItems = await prisma.$queryRaw`
        SELECT
            oi.item_name,
            SUM(oi.quantity)::int as total_quantity,
            SUM(oi.item_total)::numeric as total_revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'delivered'
          AND o.delivered_at >= ${dateFrom}
          AND o.delivered_at <= ${dateTo}
        GROUP BY oi.item_name
        ORDER BY total_quantity DESC
        LIMIT 10
    `;

    return {
        period: {
            from: dateFrom.toISOString(),
            to: dateTo.toISOString(),
            label: period || 'custom'
        },
        today: {
            orders: todayStats._count || 0,
            revenue: money(todayStats._sum?.customerPays || 0),
            platformEarnings: money(todayStats._sum?.platformEarnings || 0),
            discounts: money(todayStats._sum?.discountAmount || 0)
        },
        periodStats: {
            totalOrders: deliveredStats._count || 0,
            grossRevenue: money(deliveredStats._sum?.subtotal || 0),
            totalDiscounts: money(deliveredStats._sum?.discountAmount || 0),
            customerRevenue: money(deliveredStats._sum?.customerPays || 0),
            platformFee: money(deliveredStats._sum?.platformFee || 0),
            discountsFromPlatform: money(deliveredStats._sum?.discountFromPlatform || 0),
            platformEarnings: money(deliveredStats._sum?.platformEarnings || 0),
            restaurantPayout: money(deliveredStats._sum?.restaurantShare || 0),
            averageOrderValue: money(deliveredStats._avg?.customerPays || 0)
        },
        cancelled: {
            count: cancelledStats._count || 0,
            lostRevenue: money(cancelledStats._sum?.customerPays || 0)
        },
        activeOrders,
        cancellationRate: deliveredStats._count > 0
            ? ((cancelledStats._count / (deliveredStats._count + cancelledStats._count)) * 100).toFixed(1)
            : '0.0',
        dealsUsed: {
            ordersWithDeals: dealStats._count || 0,
            totalDiscountsGiven: money(dealStats._sum?.discountAmount || 0)
        },
        unsettled: unsettled.summary,
        topItems: topItems.map(item => ({
            name: item.item_name,
            quantity: item.total_quantity,
            revenue: money(item.total_revenue)
        }))
    };
}

/**
 * Admin dashboard — shows what restaurant owes + their revenue.
 */
export async function getAdminDashboard() {
    const unsettled = await getOutstandingCommission();

    // Restaurant's own stats
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todayRevenue = await prisma.order.aggregate({
        where: {
            status: 'delivered',
            deliveredAt: { gte: todayStart }
        },
        _count: true,
        _sum: {
            restaurantShare: true,
            customerPays: true
        }
    });

    const activeOrders = await prisma.order.findMany({
        where: {
            status: { in: ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'] }
        },
        include: {
            items: true,
            user: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'asc' }
    });

    return {
        today: {
            orders: todayRevenue._count || 0,
            restaurantRevenue: money(todayRevenue._sum?.restaurantShare || 0),
            grossRevenue: money(todayRevenue._sum?.customerPays || 0)
        },
        // What restaurant owes the platform
        outstandingCommission: unsettled.summary,
        outstandingDetails: unsettled.orders,
        activeOrders: activeOrders.map(o => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            customer: o.user.name,
            delivery: {
                building: o.buildingName,
                floorSeat: o.floorSeat
            },
            items: o.items.map(i => ({
                name: i.itemName,
                qty: i.quantity
            })),
            total: parseFloat(o.customerPays),
            createdAt: o.createdAt
        }))
    };
}

/**
 * Settlement: Mark a batch of orders as settled.
 * Called when the platform has received payment from the restaurant.
 */
export async function createSettlement(periodStart, periodEnd, notes) {
    const orders = await prisma.order.findMany({
        where: {
            status: 'delivered',
            isSettled: false,
            deliveredAt: {
                gte: new Date(periodStart),
                lte: new Date(periodEnd)
            }
        }
    });

    if (orders.length === 0) {
        return { message: 'No unsettled orders in this period' };
    }

    let totals = {
        grossRevenue: 0, totalDiscounts: 0, customerRevenue: 0,
        platformFeeTotal: 0, platformEarnings: 0, restaurantPayout: 0
    };

    for (const o of orders) {
        totals.grossRevenue += parseFloat(o.subtotal);
        totals.totalDiscounts += parseFloat(o.discountAmount);
        totals.customerRevenue += parseFloat(o.customerPays);
        totals.platformFeeTotal += parseFloat(o.platformFee);
        totals.platformEarnings += parseFloat(o.platformEarnings);
        totals.restaurantPayout += parseFloat(o.restaurantShare);
    }

    const settlement = await prisma.$transaction(async (tx) => {
        const record = await tx.settlement.create({
            data: {
                periodStart: new Date(periodStart),
                periodEnd: new Date(periodEnd),
                totalOrders: orders.length,
                ...Object.fromEntries(
                    Object.entries(totals).map(([k, v]) => [k, money(v)])
                ),
                notes: notes || null,
                status: 'completed',
                settledAt: new Date()
            }
        });

        // Mark orders as settled
        await tx.order.updateMany({
            where: { id: { in: orders.map(o => o.id) } },
            data: { isSettled: true, settledAt: new Date() }
        });

        return record;
    });

    return settlement;
}

/**
 * Get all settlement history.
 */
export async function getSettlementHistory() {
    return prisma.settlement.findMany({
        orderBy: { createdAt: 'desc' }
    });
}

// ── Helpers ──
function money(val) {
    return parseFloat(parseFloat(val || 0).toFixed(2));
}

// ═══════════════════════════════════════════════════════════
// COMMISSION PAYMENTS (restaurant → developer/platform)
// ═══════════════════════════════════════════════════════════

/** Developer's payout UPI ID (where the restaurant sends commission). */
export async function getDevUpi() {
    const s = await prisma.setting.findUnique({ where: { key: DEV_UPI_KEY } });
    return s?.value || '';
}

/** Developer sets/updates the UPI ID at which they receive commission. */
export async function setDevUpi(value) {
    const upiId = String(value || '').trim();
    if (!upiId) throw new AppError('Enter a valid UPI ID', 400, 'VALIDATION_ERROR');
    await prisma.setting.upsert({
        where: { key: DEV_UPI_KEY },
        update: { value: upiId },
        create: { key: DEV_UPI_KEY, value: upiId }
    });
    return upiId;
}

const serializePayment = (p) => ({
    id: p.id,
    amount: parseFloat(p.amount),
    upiId: p.upiId,
    transactionId: p.transactionId,
    note: p.note,
    status: p.status,
    rejectReason: p.rejectReason,
    verifiedAt: p.verifiedAt,
    createdAt: p.createdAt
});

/** Full commission payment history (newest first). */
export async function listCommissionPayments() {
    const payments = await prisma.commissionPayment.findMany({ orderBy: { createdAt: 'desc' } });
    return payments.map(serializePayment);
}

/**
 * Restaurant submits a commission payment for the developer to verify.
 * Validates the amount against what is still payable (outstanding minus
 * already-paid and pending submissions).
 */
export async function createCommissionPayment({ amount, transactionId, note }) {
    const amt = money(amount);
    if (!(amt > 0)) {
        throw new AppError('Enter a valid amount greater than zero', 400, 'VALIDATION_ERROR');
    }
    if (!transactionId || !String(transactionId).trim()) {
        throw new AppError('UPI transaction ID is required', 400, 'VALIDATION_ERROR');
    }

    const upiId = await getDevUpi();
    if (!upiId) {
        throw new AppError('The developer has not configured a payout UPI ID yet', 400, 'NO_DEV_UPI');
    }

    const { summary } = await getOutstandingCommission();
    if (amt > summary.availableToPay + 0.001) {
        throw new AppError(`Amount cannot exceed the outstanding payable (₹${summary.availableToPay})`, 400, 'AMOUNT_TOO_HIGH');
    }

    const payment = await prisma.commissionPayment.create({
        data: {
            amount: amt,
            transactionId: String(transactionId).trim(),
            note: note ? String(note).trim() : null,
            upiId,
            status: 'pending'
        }
    });
    return serializePayment(payment);
}

/** Developer verifies a pending payment → it clears against the outstanding. */
export async function verifyCommissionPayment(id) {
    const p = await prisma.commissionPayment.findUnique({ where: { id } });
    if (!p) throw new AppError('Payment not found', 404, 'NOT_FOUND');
    if (p.status !== 'pending') throw new AppError(`This payment is already ${p.status}`, 400, 'ALREADY_RESOLVED');
    const updated = await prisma.commissionPayment.update({
        where: { id },
        data: { status: 'verified', verifiedAt: new Date() }
    });
    return serializePayment(updated);
}

/** Developer rejects a pending payment (e.g. transaction ID not found). */
export async function rejectCommissionPayment(id, reason) {
    const p = await prisma.commissionPayment.findUnique({ where: { id } });
    if (!p) throw new AppError('Payment not found', 404, 'NOT_FOUND');
    if (p.status !== 'pending') throw new AppError(`This payment is already ${p.status}`, 400, 'ALREADY_RESOLVED');
    const updated = await prisma.commissionPayment.update({
        where: { id },
        data: { status: 'rejected', rejectReason: reason ? String(reason).trim() : null }
    });
    return serializePayment(updated);
}
