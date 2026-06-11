// ============================================================
// MENU ROUTES
// Public: Browse menu | Admin: Full CRUD
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import { clampDevDiscount, visiblePrice, parseVariants } from '../services/orderService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const prisma = new PrismaClient();

// ── GET /menu — Public: list available items grouped by category ──
router.get('/', async (req, res, next) => {
    try {
        const items = await prisma.menuItem.findMany({
            where: { isAvailable: true },
            orderBy: [
                { category: 'asc' },
                { sortOrder: 'asc' },
                { name: 'asc' }
            ]
        });

        res.json(items.map(item => {
            const disc = clampDevDiscount(item.price, item.developerDiscount);
            const variants = parseVariants(item.variants);
            const hasVariants = variants.length > 0;
            return {
                id: item.id,
                name: item.name,
                description: item.description,
                // For sized Bar items show the lowest variant price ("from ₹X"); else visible price
                price: hasVariants ? Math.min(...variants.map(v => v.price)) : visiblePrice(item.price, item.developerDiscount),
                originalPrice: parseFloat(item.price),
                developerDiscount: hasVariants ? 0 : disc,
                category: item.category,
                section: item.section || 'Food',
                hasVariants,
                variants,
                imageUrl: item.imageUrl,
                isAvailable: item.isAvailable
            };
        }));
    } catch (err) {
        next(err);
    }
});

// ── GET /menu/all — Admin: list ALL items (including unavailable) ──
router.get('/all', authenticate, authorize('admin', 'developer'), async (req, res, next) => {
    try {
        const items = await prisma.menuItem.findMany({
            orderBy: [
                { category: 'asc' },
                { sortOrder: 'asc' },
                { name: 'asc' }
            ]
        });

        res.json(items.map(i => ({
            ...i,
            price: parseFloat(i.price),
            developerDiscount: clampDevDiscount(i.price, i.developerDiscount),
            visiblePrice: visiblePrice(i.price, i.developerDiscount),
            section: i.section || 'Food',
            variants: parseVariants(i.variants)
        })));
    } catch (err) {
        next(err);
    }
});

// ── GET /menu/:id — Single item ──
router.get('/:id', async (req, res, next) => {
    try {
        const item = await prisma.menuItem.findUnique({
            where: { id: req.params.id }
        });

        if (!item) {
            throw new AppError('Menu item not found', 404, 'NOT_FOUND');
        }

        res.json({
            ...item,
            price: parseFloat(item.price),
            developerDiscount: clampDevDiscount(item.price, item.developerDiscount),
            visiblePrice: visiblePrice(item.price, item.developerDiscount)
        });
    } catch (err) {
        next(err);
    }
});

// ── POST /menu — Admin: create item ──
router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const { name, description, price, category, imageUrl, sortOrder, section, variants } = req.body;

        if (!name || !price || !category) {
            throw new AppError('Name, price, and category are required', 400, 'VALIDATION_ERROR');
        }

        if (price <= 0) {
            throw new AppError('Price must be greater than 0', 400, 'VALIDATION_ERROR');
        }

        const cleanVariants = parseVariants(variants);
        const item = await prisma.menuItem.create({
            data: {
                name,
                description: description || null,
                price,
                category,
                section: ['Bar', 'Combo'].includes(section) ? section : 'Food',
                variants: cleanVariants.length ? cleanVariants : undefined,
                imageUrl: imageUrl || null,
                sortOrder: sortOrder || 0
            }
        });

        res.status(201).json({ ...item, price: parseFloat(item.price), variants: parseVariants(item.variants) });
    } catch (err) {
        next(err);
    }
});

// ── PUT /menu/:id — Admin: update item ──
router.put('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const { name, description, price, category, imageUrl, sortOrder, section, variants } = req.body;

        const existing = await prisma.menuItem.findUnique({
            where: { id: req.params.id }
        });

        if (!existing) {
            throw new AppError('Menu item not found', 404, 'NOT_FOUND');
        }

        const item = await prisma.menuItem.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(price !== undefined && { price }),
                ...(category !== undefined && { category }),
                ...(imageUrl !== undefined && { imageUrl }),
                ...(sortOrder !== undefined && { sortOrder }),
                ...(section !== undefined && { section: ['Bar', 'Combo'].includes(section) ? section : 'Food' }),
                ...(variants !== undefined && { variants: parseVariants(variants) })
            }
        });

        res.json({ ...item, price: parseFloat(item.price), variants: parseVariants(item.variants) });
    } catch (err) {
        next(err);
    }
});

// ── PATCH /menu/:id/availability — Admin: toggle availability ──
router.patch('/:id/availability', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const item = await prisma.menuItem.findUnique({
            where: { id: req.params.id }
        });

        if (!item) {
            throw new AppError('Menu item not found', 404, 'NOT_FOUND');
        }

        const updated = await prisma.menuItem.update({
            where: { id: req.params.id },
            data: { isAvailable: !item.isAvailable }
        });

        res.json({
            ...updated,
            price: parseFloat(updated.price),
            message: `Item ${updated.isAvailable ? 'enabled' : 'disabled'}`
        });
    } catch (err) {
        next(err);
    }
});

// ── DELETE /menu/:id — Admin: soft delete (set unavailable) ──
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const item = await prisma.menuItem.update({
            where: { id: req.params.id },
            data: { isAvailable: false }
        });

        res.json({ message: 'Item removed from menu', id: item.id });
    } catch (err) {
        next(err);
    }
});

export default router;
