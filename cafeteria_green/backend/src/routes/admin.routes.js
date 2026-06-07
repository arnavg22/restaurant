// ============================================================
// ADMIN ROUTES — Restaurant Admin Dashboard
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcrypt';
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
// DELIVERY PERSONNEL
// ──────────────────────────────────────────────

// ── GET /admin/delivery-persons — list active delivery accounts (to assign orders) ──
router.get('/delivery-persons', async (req, res, next) => {
    try {
        const people = await prisma.user.findMany({
            where: { role: 'delivery', isActive: true },
            select: { id: true, name: true, phone: true },
            orderBy: { name: 'asc' }
        });

        // Active (out_for_delivery) load per person
        const active = await prisma.order.groupBy({
            by: ['assignedDeliveryId'],
            where: { status: { in: ['ready', 'out_for_delivery'] }, assignedDeliveryId: { not: null } },
            _count: true
        });
        const loadMap = new Map(active.map(a => [a.assignedDeliveryId, a._count]));

        res.json(people.map(p => ({ ...p, activeOrders: loadMap.get(p.id) || 0 })));
    } catch (err) {
        next(err);
    }
});

// ── POST /admin/delivery-persons — create a delivery person account ──
router.post('/delivery-persons', async (req, res, next) => {
    try {
        const { name, phone, email, password } = req.body;

        if (!name || !phone || !email || !password) {
            throw new AppError('Name, contact number, email and password are all required', 400, 'VALIDATION_ERROR');
        }
        const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
            throw new AppError('Enter a valid 10-digit Indian mobile number', 400, 'VALIDATION_ERROR');
        }
        if (String(password).length < 6) {
            throw new AppError('Password must be at least 6 characters', 400, 'VALIDATION_ERROR');
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) throw new AppError('That email is already registered', 409, 'EMAIL_EXISTS');

        const passwordHash = await bcrypt.hash(password, 10);
        const person = await prisma.user.create({
            data: { name: name.trim(), email: email.trim().toLowerCase(), phone: cleanPhone, passwordHash, role: 'delivery' },
            select: { id: true, name: true, email: true, phone: true }
        });

        res.status(201).json({ ...person, message: 'Delivery person created' });
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
                    appliedDeal: { select: { id: true, title: true } },
                    assignedDelivery: { select: { id: true, name: true, phone: true } }
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
                specialRequest: o.specialRequest,
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
                assignedDelivery: o.assignedDelivery
                    ? { id: o.assignedDelivery.id, name: o.assignedDelivery.name, phone: o.assignedDelivery.phone }
                    : null,
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

// ── PATCH /admin/orders/:id/confirm-payment — Manually verify UPI payment ──
// Admin checks the customer-supplied transaction ID against their UPI account,
// then confirms. This records paidAt and moves the order to 'accepted' so it can proceed.
router.patch('/orders/:id/confirm-payment', async (req, res, next) => {
    try {
        const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!existing) throw new AppError('Order not found', 404, 'NOT_FOUND');
        if (existing.status !== 'payment_verification_pending') {
            throw new AppError(`Payment for this order is already verified (status: ${existing.status})`, 400, 'ALREADY_VERIFIED');
        }

        // Stamp the payment as received, then advance the order
        await prisma.order.update({ where: { id: req.params.id }, data: { paidAt: new Date() } });

        const order = await transitionOrderStatus(req.params.id, {
            newStatus: 'accepted',
            changedBy: req.user.id,
            changedByRole: ROLES.ADMIN,
            notes: `Payment verified manually. Txn ID: ${existing.transactionId}`,
            metadata: { transactionId: existing.transactionId, verifiedBy: req.user.name }
        });

        emitToCustomer(req, order.id, 'order:status_changed', {
            orderId: order.id,
            orderNumber: order.orderNumber,
            newStatus: 'accepted',
            message: 'Payment verified! Your order has been accepted.'
        });

        // Push the accepted order to the kitchen feed
        const io = req.app.get('io');
        if (io) {
            io.to('kitchen_feed').emit('order:accepted', {
                orderId: order.id,
                orderNumber: order.orderNumber
            });
        }

        res.json({ message: 'Payment verified and order accepted', order: { id: order.id, status: order.status } });
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

// ── PATCH /admin/orders/:id/assign-delivery — Assign order to a delivery person ──
// Does not change the order status; it routes the order into that delivery person's
// queue. The delivery person then picks it up (out_for_delivery) and delivers it.
router.patch('/orders/:id/assign-delivery', async (req, res, next) => {
    try {
        const { deliveryId } = req.body;
        if (!deliveryId) throw new AppError('A delivery person is required', 400, 'VALIDATION_ERROR');

        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) throw new AppError('Order not found', 404, 'NOT_FOUND');
        if (!['accepted', 'preparing', 'ready'].includes(order.status)) {
            throw new AppError(`Cannot assign delivery for an order that is '${order.status}'`, 400, 'INVALID_STATE');
        }

        const person = await prisma.user.findFirst({ where: { id: deliveryId, role: 'delivery', isActive: true } });
        if (!person) throw new AppError('Delivery person not found', 404, 'NOT_FOUND');

        const updated = await prisma.$transaction(async (tx) => {
            const o = await tx.order.update({
                where: { id: req.params.id },
                data: { assignedDeliveryId: deliveryId }
            });
            await tx.orderLog.create({
                data: {
                    orderId: o.id,
                    fromStatus: o.status,
                    toStatus: o.status,
                    changedBy: req.user.id,
                    changedByRole: ROLES.ADMIN,
                    notes: `Assigned to delivery person: ${person.name}`,
                    metadata: { assignedDeliveryId: deliveryId, assignedDeliveryName: person.name }
                }
            });
            return o;
        });

        // Notify the delivery feed + the customer
        const io = req.app.get('io');
        if (io) {
            io.to('delivery_feed').emit('order:assigned', {
                orderId: updated.id,
                orderNumber: updated.orderNumber,
                assignedTo: deliveryId,
                building: updated.buildingName,
                floorSeat: updated.floorSeat
            });
        }
        emitToCustomer(req, updated.id, 'order:status_changed', {
            orderId: updated.id,
            orderNumber: updated.orderNumber,
            newStatus: updated.status,
            message: `${person.name} will deliver your order`
        });

        res.json({ message: `Order assigned to ${person.name}`, order: { id: updated.id, assignedDeliveryId: deliveryId } });
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
