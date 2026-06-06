// ============================================================
// ADMIN ROUTES — Restaurant Admin Dashboard
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import { transitionOrderStatus, cancelOrder } from '../services/orderService.js';
import { getAdminDashboard } from '../services/revenueService.js';
import { AppError } from '../middleware/errorHandler.js';
import { ROLES } from '../config/constants.js';

const router = Router();
const prisma = new PrismaClient();

// All routes require admin authentication
router.use(authenticate, authorize('admin'));

// ──────────────────────────────────────────────
// DASHBOARD
// ──────────────────────────────────────────────

router.get('/dashboard', async (req, res, next) => {
    try {
        const dashboard = await getAdminDashboard();
        res.json(dashboard);
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// ORDER MANAGEMENT
// ──────────────────────────────────────────────

// ── GET /admin/orders — All orders (filterable) ──
router.get('/orders', async (req, res, next) => {
    try {
        const {
            status,
            dateFrom,
            dateTo,
            search,
            page = 1,
            limit = 50
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const where = {};

        if (status) {
            where.status = status;
        }

        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) where.createdAt.gte = new Date(dateFrom);
            if (dateTo) where.createdAt.lte = new Date(dateTo);
        }

        if (search) {
            where.OR = [
                { orderNumber: { contains: search, mode: 'insensitive' } },
                { deliveryName: { contains: search, mode: 'insensitive' } },
                { buildingName: { contains: search, mode: 'insensitive' } },
                { user: { name: { contains: search, mode: 'insensitive' } } }
            ];
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    items: true,
                    user: { select: { id: true, name: true, email: true, phone: true } },
                    appliedDeal: { select: { id: true, title: true } }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit)
            }),
            prisma.order.count({ where })
        ]);

        res.json({
            orders: orders.map(o => ({
                id: o.id,
                orderNumber: o.orderNumber,
                status: o.status,
                customer: {
                    id: o.user.id,
                    name: o.user.name,
                    email: o.user.email,
                    phone: o.user.phone
                },
                delivery: {
                    name: o.deliveryName,
                    phone: o.deliveryPhone,
                    building: o.buildingName,
                    floorSeat: o.floorSeat,
                    notes: o.deliveryNotes
                },
                items: o.items.map(i => ({
                    name: i.itemName,
                    quantity: i.quantity,
                    unitPrice: parseFloat(i.unitPrice),
                    total: parseFloat(i.itemTotal)
                })),
                financials: {
                    subtotal: parseFloat(o.subtotal),
                    discount: parseFloat(o.discountAmount),
                    customerPays: parseFloat(o.customerPays),
                    restaurantShare: parseFloat(o.restaurantShare),
                    platformEarnings: parseFloat(o.platformEarnings)
                },
                deal: o.appliedDeal?.title || null,
                payment: {
                    transactionId: o.transactionId,
                    paidAt: o.paidAt
                },
                timestamps: {
                    created: o.createdAt,
                    delivered: o.deliveredAt
                }
            })),
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

// ── GET /admin/orders/:id — Single order detail ──
router.get('/orders/:id', async (req, res, next) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                items: true,
                user: { select: { id: true, name: true, email: true, phone: true } },
                appliedDeal: { select: { id: true, title: true, discountType: true, discountValue: true } },
                cancelledByUser: { select: { id: true, name: true } },
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
                at: l.createdAt
            }))
        });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /admin/orders/:id/status — Update order status ──
router.patch('/orders/:id/status', async (req, res, next) => {
    try {
        const { status, notes } = req.body;
        const order = await transitionOrderStatus(req.params.id, {
            newStatus: status,
            changedBy: req.user.id,
            changedByRole: ROLES.ADMIN,
            notes: notes
        });

        // Notify customer
        emitToCustomer(req, order.id, 'order:status_changed', {
            orderId: order.id,
            orderNumber: order.orderNumber,
            newStatus: status,
            message: `Your order status has been updated to ${status}`
        });

        res.json({ message: `Order status updated to ${status}`, order: { id: order.id, status: order.status } });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /admin/orders/:id/accept — Accept order ──
router.patch('/orders/:id/accept', async (req, res, next) => {
    try {
        const order = await transitionOrderStatus(req.params.id, {
            newStatus: 'accepted',
            changedBy: req.user.id,
            changedByRole: ROLES.ADMIN,
            notes: req.body.notes || 'Order accepted by restaurant'
        });

        // Notify customer
        emitToCustomer(req, order.id, 'order:status_changed', {
            orderId: order.id,
            orderNumber: order.orderNumber,
            newStatus: 'accepted',
            message: 'Your order has been accepted!'
        });

        res.json({ message: 'Order accepted', order: { id: order.id, status: order.status } });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /admin/orders/:id/prepare — Start preparing ──
router.patch('/orders/:id/prepare', async (req, res, next) => {
    try {
        const order = await transitionOrderStatus(req.params.id, {
            newStatus: 'preparing',
            changedBy: req.user.id,
            changedByRole: ROLES.ADMIN,
            notes: req.body.notes || 'Order is being prepared'
        });

        emitToCustomer(req, order.id, 'order:status_changed', {
            orderId: order.id,
            orderNumber: order.orderNumber,
            newStatus: 'preparing',
            message: 'Your food is being prepared!'
        });

        res.json({ message: 'Order now preparing', order: { id: order.id, status: order.status } });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /admin/orders/:id/ready — Mark ready for pickup ──
router.patch('/orders/:id/ready', async (req, res, next) => {
    try {
        const order = await transitionOrderStatus(req.params.id, {
            newStatus: 'ready',
            changedBy: req.user.id,
            changedByRole: ROLES.ADMIN,
            notes: req.body.notes || 'Order ready for delivery pickup'
        });

        // Notify customer
        emitToCustomer(req, order.id, 'order:status_changed', {
            orderId: order.id,
            orderNumber: order.orderNumber,
            newStatus: 'ready',
            message: 'Your order is ready and will be delivered soon!'
        });

        // Notify delivery feed
        const io = req.app.get('io');
        if (io) {
            io.to('delivery_feed').emit('order:ready', {
                orderId: order.id,
                orderNumber: order.orderNumber,
                building: order.buildingName,
                floorSeat: order.floorSeat,
                items: order.items?.length || 0
            });
        }

        res.json({ message: 'Order ready for delivery', order: { id: order.id, status: order.status } });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /admin/orders/:id/cancel — Cancel order ──
router.patch('/orders/:id/cancel', async (req, res, next) => {
    try {
        const { reason } = req.body;

        const order = await cancelOrder(req.params.id, req.user.id, reason);

        // Notify customer
        emitToCustomer(req, order.id, 'order:cancelled', {
            orderId: order.id,
            orderNumber: order.orderNumber,
            reason: reason,
            message: `Your order has been cancelled. ${order.paymentVerified ? 'Refund will be processed.' : ''}`
        });

        res.json({
            message: 'Order cancelled',
            order: { id: order.id, status: order.status },
            refundInitiated: order.paymentVerified
        });
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// ORDER HISTORY (with full financial details)
// ──────────────────────────────────────────────

router.get('/history', async (req, res, next) => {
    try {
        const { dateFrom, dateTo, status, page = 1, limit = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = {};
        if (status) where.status = status;
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) where.createdAt.gte = new Date(dateFrom);
            if (dateTo) where.createdAt.lte = new Date(dateTo);
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    items: true,
                    user: { select: { name: true, email: true } },
                    appliedDeal: { select: { title: true } }
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
                customer: o.user.name,
                status: o.status,
                items: o.items.map(i => `${i.itemName} ×${i.quantity}`).join(', '),
                subtotal: parseFloat(o.subtotal),
                discount: parseFloat(o.discountAmount),
                customerPaid: parseFloat(o.customerPays),
                restaurantShare: parseFloat(o.restaurantShare),
                platformEarnings: parseFloat(o.platformEarnings),
                deal: o.appliedDeal?.title || '-',
                date: o.createdAt,
                deliveredAt: o.deliveredAt
            })),
            pagination: { page: parseInt(page), limit: parseInt(limit), total }
        });
    } catch (err) {
        next(err);
    }
});

// ── Helper: emit to customer's room ──
function emitToCustomer(req, orderId, event, data) {
    const io = req.app.get('io');
    if (io) {
        io.to(`order:${orderId}`).emit(event, data);
    }
}

export default router;
