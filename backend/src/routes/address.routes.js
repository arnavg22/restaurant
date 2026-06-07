// ============================================================
// ADDRESS ROUTES (Customer address book)
// Save multiple delivery addresses and reuse them at checkout.
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateDeliveryInfo } from '../services/orderService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate, authorize('customer'));

function format(a) {
    return {
        id: a.id,
        label: a.label,
        deliveryName: a.deliveryName,
        deliveryPhone: a.deliveryPhone,
        buildingName: a.buildingName,
        floorSeat: a.floorSeat,
    };
}

// ── GET /addresses — list the customer's saved addresses ──
router.get('/', async (req, res, next) => {
    try {
        const addresses = await prisma.address.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' },
        });
        res.json(addresses.map(format));
    } catch (err) {
        next(err);
    }
});

// ── POST /addresses — save a new address ──
router.post('/', async (req, res, next) => {
    try {
        const { label, deliveryName, deliveryPhone, buildingName, floorSeat } = req.body;

        // Reuse the same strict validation/sanitization as order delivery info
        const delivery = { deliveryName, deliveryPhone, buildingName, floorSeat };
        validateDeliveryInfo(delivery);

        const address = await prisma.address.create({
            data: {
                userId: req.user.id,
                label: (label && String(label).trim().slice(0, 40)) || null,
                deliveryName: delivery.deliveryName,
                deliveryPhone: delivery.deliveryPhone,
                buildingName: delivery.buildingName,
                floorSeat: delivery.floorSeat,
            },
        });
        res.status(201).json(format(address));
    } catch (err) {
        next(err);
    }
});

// ── DELETE /addresses/:id — remove a saved address ──
router.delete('/:id', async (req, res, next) => {
    try {
        const existing = await prisma.address.findFirst({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!existing) throw new AppError('Address not found', 404, 'NOT_FOUND');

        await prisma.address.delete({ where: { id: req.params.id } });
        res.json({ message: 'Address removed', id: req.params.id });
    } catch (err) {
        next(err);
    }
});

export default router;
