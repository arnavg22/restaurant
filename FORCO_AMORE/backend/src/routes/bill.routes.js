import express from 'express';
import { clubOrders, completeBill } from '../services/billService.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// All routes in this file are for admins only
router.use(authenticate, authorize('admin'));

// Club multiple orders under a single bill
router.post('/club', async (req, res, next) => {
    const { orderIds, tableNumber } = req.body;
    try {
        const billId = await clubOrders(orderIds, tableNumber);
        res.status(201).json({ billId });
    } catch (error) {
        next(error);
    }
});

// Mark a bill as paid and complete all associated orders
router.post('/:billId/complete', async (req, res, next) => {
    const { billId } = req.params;
    try {
        await completeBill(billId);
        res.status(200).json({ message: 'Bill completed successfully.' });
    } catch (error) {
        next(error);
    }
});

export default router;
