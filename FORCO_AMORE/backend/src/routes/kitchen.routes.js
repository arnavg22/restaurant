// ============================================================
// KITCHEN ROUTES — Kitchen Display System
// Kitchen sees orders once payment is verified (status 'accepted'),
// cooks them (preparing) and marks them ready. No pricing/payment data.
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import { transitionOrderStatus } from '../services/orderService.js';
import { AppError } from '../middleware/errorHandler.js';
import { ROLES } from '../config/constants.js';

const router = Router();
const prisma = new PrismaClient();

// Admin can also use the kitchen board; kitchen staff are the primary users
router.use(authenticate, authorize('kitchen', 'admin'));

// ── GET /kitchen/orders — active tickets (accepted → preparing → ready) ──
router.get('/orders', async (req, res, next) => {
    try {
        const orders = await prisma.order.findMany({
            where: { status: { in: ['accepted', 'preparing', 'ready'] } },
            include: { items: { select: { itemName: true, quantity: true } } },
            orderBy: { createdAt: 'asc' }   // oldest first = most urgent
        });

        res.json(orders.map(o => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            items: o.items.map(i => ({ name: i.itemName, quantity: i.quantity })),
            specialRequest: o.specialRequest,   // customer's cooking notes
            deliveryNotes: o.deliveryNotes,
            building: o.buildingName,
            floorSeat: o.floorSeat,
            acceptedAt: o.updatedAt,
            createdAt: o.createdAt
        })));
    } catch (err) {
        next(err);
    }
});

// ── PATCH /kitchen/orders/:id/prepare — start preparing ──
router.patch('/orders/:id/prepare', async (req, res, next) => {
    try {
        const order = await transitionOrderStatus(req.params.id, {
            newStatus: 'preparing',
            changedBy: req.user.id,
            changedByRole: req.user.role === 'admin' ? ROLES.ADMIN : ROLES.KITCHEN,
            notes: 'Kitchen started preparing'
        });
        notify(req, order, 'preparing', 'Your food is being prepared!');
        res.json({ message: 'Order is now preparing', order: { id: order.id, status: order.status } });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /kitchen/orders/:id/ready — mark ready for delivery pickup ──
router.patch('/orders/:id/ready', async (req, res, next) => {
    try {
        const order = await transitionOrderStatus(req.params.id, {
            newStatus: 'ready',
            changedBy: req.user.id,
            changedByRole: req.user.role === 'admin' ? ROLES.ADMIN : ROLES.KITCHEN,
            notes: 'Kitchen marked order ready'
        });
        notify(req, order, 'ready', 'Your order is ready — a delivery partner will be assigned shortly!');

        // Let admin know it's ready to assign a delivery person
        const io = req.app.get('io');
        if (io) io.to('admin_feed').emit('order:ready_for_assign', { orderId: order.id, orderNumber: order.orderNumber });

        res.json({ message: 'Order ready for delivery', order: { id: order.id, status: order.status } });
    } catch (err) {
        next(err);
    }
});

function notify(req, order, newStatus, message) {
    const io = req.app.get('io');
    if (io) {
        io.to(`order:${order.id}`).emit('order:status_changed', {
            orderId: order.id, orderNumber: order.orderNumber, newStatus, message
        });
    }
}

export default router;
