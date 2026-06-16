// ============================================================
// MENU ROUTES
// Public: Browse menu | Admin: Full CRUD
// ============================================================
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.js';
import { clampDevDiscount, visiblePrice, parseVariants, effectiveGstRate } from '../services/orderService.js';
import { isComboItem, isBeerItem, DEFAULT_GST_RATE, BEER_GST_RATE } from '../config/constants.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();
const prisma = new PrismaClient();

/** Sanitize an incoming GST rate (percent). Returns null if not provided/invalid. */
function parseGstRate(value) {
    if (value === undefined || value === null || value === '') return null;
    const r = parseFloat(value);
    if (isNaN(r) || r < 0 || r > 100) return null;
    return Math.round(r * 100) / 100;
}

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
            const variants = parseVariants(item.variants);
            const hasVariants = variants.length > 0;
            // Combos & thalis never carry a discount.
            const combo = isComboItem(item);
            const disc = (hasVariants || combo) ? 0 : clampDevDiscount(item.price, item.developerDiscount);
            return {
                id: item.id,
                name: item.name,
                description: item.description,
                // For sized Bar items show the lowest variant price ("from ₹X"); else visible price
                price: hasVariants ? Math.min(...variants.map(v => v.price)) : (combo ? parseFloat(item.price) : visiblePrice(item.price, item.developerDiscount)),
                originalPrice: parseFloat(item.price),
                developerDiscount: disc,
                category: item.category,
                section: item.section || 'Food',
                isCombo: combo,
                gstRate: effectiveGstRate(item),
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
            gstRate: parseFloat(i.gstRate),
            effectiveGstRate: effectiveGstRate(i),
            isCombo: isComboItem(i),
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
            visiblePrice: visiblePrice(item.price, item.developerDiscount),
            gstRate: parseFloat(item.gstRate),
            effectiveGstRate: effectiveGstRate(item)
        });
    } catch (err) {
        next(err);
    }
});

// ── POST /menu — Admin: create item ──
router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const { name, description, price, category, imageUrl, sortOrder, section, variants, gstRate } = req.body;

        if (!name || !price || !category) {
            throw new AppError('Name, price, and category are required', 400, 'VALIDATION_ERROR');
        }

        if (price <= 0) {
            throw new AppError('Price must be greater than 0', 400, 'VALIDATION_ERROR');
        }

        // GST: use the supplied rate; beers default to 18%, everything else to the default rate.
        const beer = isBeerItem({ name, category });
        const resolvedGst = parseGstRate(gstRate) ?? (beer ? BEER_GST_RATE : DEFAULT_GST_RATE);

        const cleanVariants = parseVariants(variants);
        const item = await prisma.menuItem.create({
            data: {
                name,
                description: description || null,
                price,
                category,
                section: section === 'Bar' ? 'Bar' : 'Food',
                gstRate: resolvedGst,
                variants: cleanVariants.length ? cleanVariants : undefined,
                imageUrl: imageUrl || null,
                sortOrder: sortOrder || 0
            }
        });

        res.status(201).json({ ...item, price: parseFloat(item.price), gstRate: parseFloat(item.gstRate), variants: parseVariants(item.variants) });
    } catch (err) {
        next(err);
    }
});

// ── PUT /menu/:id — Admin: update item ──
router.put('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const { name, description, price, category, imageUrl, sortOrder, section, variants, gstRate } = req.body;

        const existing = await prisma.menuItem.findUnique({
            where: { id: req.params.id }
        });

        if (!existing) {
            throw new AppError('Menu item not found', 404, 'NOT_FOUND');
        }

        let gstUpdate = {};
        if (gstRate !== undefined) {
            const parsed = parseGstRate(gstRate);
            if (parsed === null) {
                throw new AppError('GST rate must be a number between 0 and 100', 400, 'VALIDATION_ERROR');
            }
            gstUpdate = { gstRate: parsed };
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
                ...(section !== undefined && { section: section === 'Bar' ? 'Bar' : 'Food' }),
                ...(variants !== undefined && { variants: parseVariants(variants) }),
                ...gstUpdate
            }
        });

        res.json({ ...item, price: parseFloat(item.price), gstRate: parseFloat(item.gstRate), variants: parseVariants(item.variants) });
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

// ── DELETE /menu/:id — Admin: permanently remove an item ──
// Order history is preserved: order_items keep their snapshot (name/price) and
// their menu_item_id is set to NULL via the FK's ON DELETE SET NULL rule.
// Any deal targeting this item is also detached (deals.applicable_item_id SET NULL).
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const existing = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
        if (!existing) {
            throw new AppError('Menu item not found', 404, 'NOT_FOUND');
        }

        await prisma.menuItem.delete({ where: { id: req.params.id } });

        res.json({ message: 'Item permanently deleted', id: req.params.id });
    } catch (err) {
        next(err);
    }
});

export default router;
