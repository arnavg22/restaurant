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

export default router;
