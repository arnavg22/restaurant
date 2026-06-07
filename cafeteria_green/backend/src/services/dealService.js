// ============================================================
// DEAL SERVICE — Discount Management (Developer Only)
// ============================================================
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import { PLATFORM_FEE_RATE } from '../config/constants.js';

const prisma = new PrismaClient();

/**
 * Create a new deal. Only developers can do this.
 *
 * CRITICAL RULE: The discount comes from the platform's 15% share only.
 * The restaurant's revenue is NEVER reduced by a deal.
 *
 * Math:
 *   If order subtotal = ₹1000
 *   Platform's share = ₹150 (15%)
 *   Deal: "₹100 off"
 *   → Discount applied = ₹100 (from platform's ₹150)
 *   → Platform earns = ₹150 - ₹100 = ₹50
 *   → Restaurant still gets ₹850 (unchanged)
 *   → Customer pays = ₹900
 *
 *   Deal is INVALID if discount > platform's 15% share
 *   (e.g., can't give ₹200 off on ₹1000 order — max is ₹150)
 */
export async function createDeal(developerId, dealData) {
    const {
        title,
        description,
        discountType,     // 'flat' | 'percent'
        discountValue,    // ₹ amount or % value
        maxDiscountAmount, // cap for percent discounts
        minOrderAmount,    // minimum cart value to qualify
        applicableItemId,  // specific item only (optional)
        startsAt,
        expiresAt,
        maxTotalUses,
        maxUsesPerUser
    } = dealData;

    // ── Validate ──
    if (!title || !discountType || !discountValue || !expiresAt) {
        throw new AppError('Missing required deal fields', 400, 'VALIDATION_ERROR');
    }

    if (discountType === 'flat' && discountValue <= 0) {
        throw new AppError('Flat discount must be greater than 0', 400, 'VALIDATION_ERROR');
    }

    if (discountType === 'percent' && (discountValue <= 0 || discountValue > 100)) {
        throw new AppError('Percent discount must be between 1 and 100', 400, 'VALIDATION_ERROR');
    }

    if (new Date(expiresAt) <= new Date()) {
        throw new AppError('Expiry date must be in the future', 400, 'VALIDATION_ERROR');
    }

    // ── Validate applicable item if specified ──
    if (applicableItemId) {
        const item = await prisma.menuItem.findUnique({
            where: { id: applicableItemId }
        });
        if (!item) {
            throw new AppError('Applicable menu item not found', 404, 'ITEM_NOT_FOUND');
        }
    }

    const deal = await prisma.deal.create({
        data: {
            title,
            description: description || null,
            discountType,
            discountValue,
            maxDiscountAmount: maxDiscountAmount || null,
            minOrderAmount: minOrderAmount || 0,
            applicableItemId: applicableItemId || null,
            startsAt: startsAt ? new Date(startsAt) : new Date(),
            expiresAt: new Date(expiresAt),
            maxTotalUses: maxTotalUses || null,
            maxUsesPerUser: maxUsesPerUser || 1,
            createdBy: developerId
        }
    });

    return deal;
}

/**
 * Update an existing deal. Only developers can do this.
 */
export async function updateDeal(dealId, developerId, updates) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });

    if (!deal) {
        throw new AppError('Deal not found', 404, 'DEAL_NOT_FOUND');
    }

    if (deal.createdBy !== developerId) {
        throw new AppError('You can only update deals you created', 403, 'FORBIDDEN');
    }

    // Only allow updating certain fields
    const allowedUpdates = {};
    const updatableFields = [
        'title', 'description', 'discountType', 'discountValue',
        'maxDiscountAmount', 'minOrderAmount', 'applicableItemId',
        'startsAt', 'expiresAt', 'maxTotalUses', 'maxUsesPerUser', 'isActive'
    ];

    for (const field of updatableFields) {
        if (updates[field] !== undefined) {
            allowedUpdates[field] = updates[field];
        }
    }

    if (Object.keys(allowedUpdates).length === 0) {
        throw new AppError('No valid fields to update', 400, 'NO_UPDATES');
    }

    const updated = await prisma.deal.update({
        where: { id: dealId },
        data: allowedUpdates
    });

    return updated;
}

/**
 * Deactivate a deal (soft delete).
 */
export async function deactivateDeal(dealId, developerId) {
    return updateDeal(dealId, developerId, { isActive: false });
}

/**
 * Get all active deals (for customer-facing display).
 */
export async function getActiveDeals() {
    return prisma.deal.findMany({
        where: {
            isActive: true,
            startsAt: { lte: new Date() },
            expiresAt: { gte: new Date() },
            OR: [
                { maxTotalUses: null },
                { currentUses: { lt: prisma.deal.fields.maxTotalUses } }
            ]
        },
        include: {
            applicableItem: {
                select: { id: true, name: true, price: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
}

/**
 * Get all deals (developer view — includes inactive/expired).
 */
export async function getAllDeals() {
    return prisma.deal.findMany({
        include: {
            applicableItem: {
                select: { id: true, name: true, price: true }
            },
            _count: {
                select: { usages: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
}

/**
 * Get deal usage stats.
 */
export async function getDealStats(dealId) {
    const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: {
            usages: {
                include: {
                    order: {
                        select: {
                            orderNumber: true,
                            discountAmount: true,
                            customerPays: true,
                            deliveredAt: true,
                            status: true
                        }
                    },
                    user: {
                        select: { id: true, name: true, email: true }
                    }
                }
            }
        }
    });

    if (!deal) {
        throw new AppError('Deal not found', 404, 'DEAL_NOT_FOUND');
    }

    const totalDiscountGiven = deal.usages.reduce(
        (sum, u) => sum + parseFloat(u.order.discountAmount || 0), 0
    );

    return {
        deal,
        totalUsages: deal.usages.length,
        totalDiscountGiven: totalDiscountGiven.toFixed(2),
        averageDiscount: deal.usages.length > 0
            ? (totalDiscountGiven / deal.usages.length).toFixed(2)
            : '0.00'
    };
}
