// ============================================================
// ADMIN ROUTES — Restaurant Admin Dashboard
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcrypt';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import { transitionOrderStatus, cancelOrder } from '../services/orderService.js';
import { getAdminDashboard, getOutstandingCommission, getDevUpi, createCommissionPayment, listCommissionPayments } from '../services/revenueService.js';
import { AppError } from '../middleware/errorHandler.js';
import { ROLES } from '../config/constants.js';

const router = Router();
const prisma = new PrismaClient();

// Payee label shown inside the UPI app when the restaurant pays the platform.
const PLATFORM_PAYEE_NAME = process.env.PLATFORM_PAYEE_NAME || 'Cafeteria Green Platform';
const money = (v) => parseFloat(parseFloat(v || 0).toFixed(2));

// Build a standard UPI deep-link with the amount prefilled (same scheme the
// customer→restaurant flow uses).
function buildUpiUri(amount, note, vpa, payeeName) {
    const params = new URLSearchParams({
        pa: vpa,
        pn: payeeName || PLATFORM_PAYEE_NAME,
        am: Number(amount).toFixed(2),
        cu: 'INR',
        tn: note || 'Commission settlement'
    });
    return `upi://pay?${params.toString()}`;
}

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
// COMMISSION PAYMENTS (restaurant → developer)
// ──────────────────────────────────────────────

// ── GET /admin/commission — outstanding owed + developer UPI + payment history ──
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

// ── POST /admin/commission/payment-qr — generate a UPI QR to pay the developer ──
router.post('/commission/payment-qr', async (req, res, next) => {
    try {
        const amount = money(req.body.amount);
        if (!(amount > 0)) {
            throw new AppError('Enter a valid amount greater than zero', 400, 'VALIDATION_ERROR');
        }

        const devUpi = await getDevUpi();
        if (!devUpi) {
            throw new AppError('The developer has not configured a payout UPI ID yet', 400, 'NO_DEV_UPI');
        }

        const { summary } = await getOutstandingCommission();
        if (amount > summary.availableToPay + 0.001) {
            throw new AppError(`Amount cannot exceed the outstanding payable (₹${summary.availableToPay})`, 400, 'AMOUNT_TOO_HIGH');
        }

        const upiUri = buildUpiUri(amount, 'Commission settlement', devUpi, PLATFORM_PAYEE_NAME);
        const qr = await QRCode.toDataURL(upiUri, { width: 320, margin: 1, color: { dark: '#1a2e22', light: '#ffffff' } });

        res.json({ amount, currency: 'INR', upiUri, qr, payeeVpa: devUpi, payeeName: PLATFORM_PAYEE_NAME });
    } catch (err) {
        next(err);
    }
});

// ── POST /admin/commission/payments — record a payment for developer verification ──
router.post('/commission/payments', async (req, res, next) => {
    try {
        const { amount, transactionId, note } = req.body;
        const payment = await createCommissionPayment({ amount, transactionId, note });
        res.status(201).json({ message: 'Payment submitted for verification', payment });
    } catch (err) {
        next(err);
    }
});

// ──────────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────────

router.get('/settings', async (req, res, next) => {
    try {
        const rows = await prisma.setting.findMany({
            where: { key: { in: ['upi_id', 'gst_rate', 'vat_rate'] } }
        });
        const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
        res.json({
            upi_id: map.upi_id || '',
            // Tax rates as percentages; defaults GST 5%, VAT 18%
            gst_rate: map.gst_rate ?? '5',
            vat_rate: map.vat_rate ?? '18'
        });
    } catch (err) {
        next(err);
    }
});

router.put('/settings', async (req, res, next) => {
    try {
        const { upi_id, gst_rate, vat_rate } = req.body;

        const upserts = [];

        if (upi_id !== undefined) {
            if (typeof upi_id !== 'string') {
                throw new AppError('Invalid UPI ID format', 400, 'VALIDATION_ERROR');
            }
            upserts.push(['upi_id', upi_id]);
        }

        // Validate and queue tax rates (stored as percentage strings)
        for (const [key, val] of [['gst_rate', gst_rate], ['vat_rate', vat_rate]]) {
            if (val === undefined) continue;
            const num = parseFloat(val);
            if (!Number.isFinite(num) || num < 0 || num > 100) {
                throw new AppError('Tax rate must be a number between 0 and 100', 400, 'VALIDATION_ERROR');
            }
            upserts.push([key, String(num)]);
        }

        if (upserts.length === 0) {
            throw new AppError('No settings provided to update', 400, 'VALIDATION_ERROR');
        }

        for (const [key, value] of upserts) {
            await prisma.setting.upsert({
                where: { key },
                update: { value },
                create: { key, value }
            });
        }

        res.json({ message: 'Settings updated successfully' });
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

// ── DELETE /admin/delivery-persons/:id — Remove (deactivate) a delivery person account ──
router.delete('/delivery-persons/:id', async (req, res, next) => {
    try {
        const person = await prisma.user.findFirst({
            where: { id: req.params.id, role: 'delivery' }
        });
        if (!person) throw new AppError('Delivery person not found', 404, 'NOT_FOUND');

        await prisma.user.update({
            where: { id: req.params.id },
            data: { isActive: false }
        });

        res.json({ message: `${person.name} has been removed from the delivery team` });
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
                orderType: o.orderType || 'DELIVERY',
                paymentMethod: o.paymentMethod || 'ONLINE',
                tableNumber: o.tableNumber || null,
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

// ── PATCH /admin/orders/:id/complete — Mark dine-in/takeaway as completed ──
router.patch('/orders/:id/complete', async (req, res, next) => {
    try {
        const order = await transitionOrderStatus(req.params.id, {
            newStatus: 'completed',
            changedBy: req.user.id,
            changedByRole: ROLES.ADMIN,
            notes: req.body.notes || 'Order completed'
        });

        emitToCustomer(req, order.id, 'order:status_changed', {
            orderId: order.id,
            orderNumber: order.orderNumber,
            newStatus: 'completed',
            message: 'Your order is complete!'
        });

        res.json({ message: 'Order completed', order: { id: order.id, status: order.status } });
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

// ──────────────────────────────────────────────
// ORDER LOGS — CSV Downloads (today / this week / this month)
// ──────────────────────────────────────────────

router.get('/logs/csv', async (req, res, next) => {
    try {
        const { period = 'today' } = req.query;
        const now = new Date();
        let dateFrom;

        if (period === 'today') {
            dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period === 'week') {
            const dayOfWeek = now.getDay() || 7; // Mon=1
            dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
        } else if (period === 'month') {
            dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        } else {
            throw new AppError('Invalid period. Use today, week, or month', 400, 'VALIDATION_ERROR');
        }

        const orders = await prisma.order.findMany({
            where: { createdAt: { gte: dateFrom } },
            include: {
                items: true,
                user: { select: { name: true, phone: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Build CSV
        const headers = ['Order #', 'Date', 'Time', 'Customer', 'Phone', 'Order Type', 'Payment', 'Status', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total Paid', 'Restaurant Share', 'Platform Earnings', 'Transaction ID'];
        const rows = orders.map(o => {
            const d = new Date(o.createdAt);
            const date = d.toLocaleDateString('en-IN');
            const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            const itemsList = o.items.map(i => `${i.itemName} x${i.quantity}`).join(' | ');
            return [
                o.orderNumber,
                date,
                time,
                o.user.name,
                o.user.phone,
                o.orderType || 'DELIVERY',
                o.paymentMethod || 'ONLINE',
                o.status,
                `"${itemsList}"`,
                parseFloat(o.subtotal).toFixed(2),
                parseFloat(o.discountAmount).toFixed(2),
                parseFloat(o.taxAmount || 0).toFixed(2),
                parseFloat(o.customerPays).toFixed(2),
                parseFloat(o.restaurantShare).toFixed(2),
                parseFloat(o.platformEarnings).toFixed(2),
                o.transactionId || '-'
            ].join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const filename = `orders_${period}_${now.toISOString().slice(0, 10)}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (err) {
        next(err);
    }
});

// ── GET /admin/logs — Order logs JSON (for dashboard display) ──
router.get('/logs', async (req, res, next) => {
    try {
        const { period = 'today' } = req.query;
        const now = new Date();
        let dateFrom;

        if (period === 'today') {
            dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period === 'week') {
            const dayOfWeek = now.getDay() || 7;
            dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
        } else if (period === 'month') {
            dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        } else {
            throw new AppError('Invalid period', 400, 'VALIDATION_ERROR');
        }

        const orders = await prisma.order.findMany({
            where: { createdAt: { gte: dateFrom } },
            include: {
                items: true,
                user: { select: { name: true, phone: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const summary = {
            totalOrders: orders.length,
            totalRevenue: orders.reduce((s, o) => s + parseFloat(o.customerPays), 0),
            totalRestaurantShare: orders.reduce((s, o) => s + parseFloat(o.restaurantShare), 0),
            totalPlatformEarnings: orders.reduce((s, o) => s + parseFloat(o.platformEarnings), 0),
            byStatus: {}
        };
        orders.forEach(o => { summary.byStatus[o.status] = (summary.byStatus[o.status] || 0) + 1; });

        res.json({
            period,
            dateFrom,
            summary,
            orders: orders.map(o => ({
                orderNumber: o.orderNumber,
                date: o.createdAt,
                customer: o.user.name,
                phone: o.user.phone,
                orderType: o.orderType || 'DELIVERY',
                paymentMethod: o.paymentMethod || 'ONLINE',
                status: o.status,
                items: o.items.map(i => ({ name: i.itemName, qty: i.quantity, total: parseFloat(i.itemTotal) })),
                subtotal: parseFloat(o.subtotal),
                discount: parseFloat(o.discountAmount),
                tax: parseFloat(o.taxAmount || 0),
                customerPays: parseFloat(o.customerPays),
                restaurantShare: parseFloat(o.restaurantShare),
                platformEarnings: parseFloat(o.platformEarnings),
                transactionId: o.transactionId
            }))
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
