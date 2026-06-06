// ============================================================
// DELIVERY ROUTES — Delivery Person Dashboard
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import { transitionOrderStatus } from '../services/orderService.js';
import { AppError } from '../middleware/errorHandler.js';
import { ROLES } from '../config/constants.js';

const router = Router();
const prisma = new PrismaClient();

// All routes require delivery person authentication
router.use(authenticate, authorize('delivery'));

// ── GET /delivery/orders — Orders available for pickup / in delivery ──
router.get('/orders', async (req, res, next) => {
    try {
        const orders = await prisma.order.findMany({
            where: {
                status: { in: ['ready', 'out_for_delivery'] }
            },
            include: {
                items: {
                    select: { itemName: true, quantity: true }
                },
                user: { select: { name: true, phone: true } }
            },
            orderBy: { updatedAt: 'asc' }  // oldest ready first
        });

        res.json(orders.map(o => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            customer: {
                name: o.user.name,
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
                quantity: i.quantity
            })),
            total: parseFloat(o.customerPays),
            readySince: o.updatedAt
        })));
    } catch (err) {
        next(err);
    }
});

// ── GET /delivery/orders/:id — Order detail ──
router.get('/orders/:id', async (req, res, next) => {
    try {
        const order = await prisma.order.findFirst({
            where: {
                id: req.params.id,
                status: { in: ['ready', 'out_for_delivery'] }
            },
            include: {
                items: true,
                user: { select: { name: true, phone: true, email: true } }
            }
        });

        if (!order) {
            throw new AppError('Order not found or not available for delivery', 404, 'NOT_FOUND');
        }

        res.json({
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            customer: {
                name: order.user.name,
                phone: order.user.phone,
                email: order.user.email
            },
            delivery: {
                name: order.deliveryName,
                phone: order.deliveryPhone,
                building: order.buildingName,
                floorSeat: order.floorSeat,
                notes: order.deliveryNotes
            },
            items: order.items.map(i => ({
                name: i.itemName,
                quantity: i.quantity,
                price: parseFloat(i.unitPrice)
            })),
            total: parseFloat(order.customerPays),
            createdAt: order.createdAt,
            readySince: order.updatedAt
        });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /delivery/orders/:id/status — Update order status ──
router.patch('/orders/:id/status', async (req, res, next) => {
    try {
        const { status } = req.body;
        const order = await transitionOrderStatus(req.params.id, {
            newStatus: status,
            changedBy: req.user.id,
            changedByRole: ROLES.DELIVERY,
            notes: `Status updated by ${req.user.name}`
        });

        // Notify customer
        const io = req.app.get('io');
        if (io) {
            io.to(`order:${order.id}`).emit('order:status_changed', {
                orderId: order.id,
                orderNumber: order.orderNumber,
                newStatus: status,
                message: `Your order is now ${status}`
            });
        }

        res.json({
            message: `Order status updated to ${status}`,
            order: {
                id: order.id,
                status: order.status,
            }
        });
    } catch (err) {
        next(err);
    }
});

export default router;
