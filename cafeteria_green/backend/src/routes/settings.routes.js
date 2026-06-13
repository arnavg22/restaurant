// ============================================================
// SETTINGS ROUTES (Public)
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.get('/upi', async (req, res, next) => {
    try {
        const upiIdSetting = await prisma.setting.findUnique({
            where: { key: 'upi_id' },
        });
        res.json({ upi_id: upiIdSetting?.value || '' });
    } catch (err) {
        next(err);
    }
});

// Public tax rates (percentages) so the cart can show an accurate estimate.
// GST applies to non-alcohol items, VAT to alcohol (Bar) items.
router.get('/tax', async (req, res, next) => {
    try {
        const rows = await prisma.setting.findMany({
            where: { key: { in: ['gst_rate', 'vat_rate'] } }
        });
        const map = Object.fromEntries(rows.map(r => [r.key, parseFloat(r.value)]));
        res.json({
            gst_rate: Number.isFinite(map.gst_rate) ? map.gst_rate : 5,
            vat_rate: Number.isFinite(map.vat_rate) ? map.vat_rate : 18
        });
    } catch (err) {
        next(err);
    }
});

export default router;
