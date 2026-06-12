// ============================================================
// ORDER SERVICE — Core Business Logic & Math
// ============================================================
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import {
    PLATFORM_FEE_RATE,
    RESTAURANT_SHARE_RATE,
    TAX_RATE,
    STATUS_TRANSITIONS,
    STATUS_AUTHORIZERS,
    ORDER_PAYMENT_TIMEOUT,
    TERMINAL_STATUSES,
    ROLES
} from '../config/constants.js';

const prisma = new PrismaClient();

// ============================================================
// FINANCIAL CALCULATIONS
// ============================================================

/**
 * Calculate all financials for an order.
 *
 * The key rule: DISCOUNTS COME FROM PLATFORM'S SHARE ONLY.
 * Restaurant always gets their 96% of the original subtotal.
 *
 * ┌────────────────────────────────────────────────────┐
 * │  subtotal       = Σ(item.price × quantity)         │
 * │  discount       = min(calculated_discount, cap)    │
 * │  customer_pays  = subtotal - discount              │
 * │  platform_fee   = subtotal × 0.04  (gross)         │
 * │  platform_earnings = platform_fee - discount       │
 * │  restaurant_share  = subtotal × 0.96               │
 * │                                                     │
 * │  VERIFICATION:                                      │
 * │  customer_pays = restaurant_share + platform_earnings│
 * │  (subtotal - discount) = (subtotal×0.96) + (fee-disc)│
 * │  = (subtotal×0.96) + (subtotal×0.04) - discount     │
 * │  = subtotal - discount  ✓                           │
 * └────────────────────────────────────────────────────┘
 */
/**
 * Calculate all financials for an order.
 *
 * Developer gets 4% of what the customer actually pays (after discount, before tax).
 * Restaurant gets the rest.
 *
 * ┌────────────────────────────────────────────────────┐
 * │  subtotal       = Σ(item.price × quantity)         │
 * │  discount       = applied deal/promo discount      │
 * │  afterDiscount  = subtotal - discount              │
 * │  platform_fee   = afterDiscount × 0.04             │
 * │  restaurant_share = afterDiscount - platform_fee   │
 * │  tax            = afterDiscount × 0.05             │
 * │  customer_pays  = afterDiscount + tax              │
 * └────────────────────────────────────────────────────┘
 */
export function calculateOrderFinancials(subtotal, discountAmount = 0, exemptSubtotal = 0) {
    const cappedDiscount = roundMoney(Math.max(0, Math.min(discountAmount, subtotal)));

    // After discount = what the customer is actually paying (before tax)
    const afterDiscount = roundMoney(subtotal - cappedDiscount);

    // Developer gets 4% of the after-discount amount (excluding exempt items' share)
    const exemptAfterDiscount = roundMoney(Math.min(exemptSubtotal, afterDiscount));
    const feeableAmount = roundMoney(afterDiscount - exemptAfterDiscount);

    const platformFee = roundMoney(feeableAmount * PLATFORM_FEE_RATE);
    const platformEarnings = platformFee;

    // Restaurant gets the rest
    const restaurantShare = roundMoney(afterDiscount - platformFee);

    // 5% tax on afterDiscount
    const taxAmount = roundMoney(afterDiscount * TAX_RATE);
    const customerPays = roundMoney(afterDiscount + taxAmount);

    return {
        subtotal: roundMoney(subtotal),
        discountAmount: cappedDiscount,
        taxAmount,
        customerPays,
        platformFee,
        discountFromPlatform: 0,
        platformEarnings,
        restaurantShare
    };
}

/**
 * Calculate discount for a specific deal on an order.
 * Returns the discount amount. Deals are now absorbed by the restaurant,
 * not capped by the platform's share.
 *
 * NOTE: Combos are NOT eligible for discounts. Pass `discountableSubtotal`
 * (the cart subtotal excluding any Combo items) so percent discounts apply
 * only to the non-combo portion and flat discounts are capped to it.
 * The deal's minimum-order qualification still uses the full `subtotal`.
 */
export function calculateDealDiscount(deal, subtotal, userId, discountableSubtotal = subtotal) {
    // Check if deal is valid
    const now = new Date();
    if (!deal.isActive) return 0;
    if (now < deal.startsAt || now > deal.expiresAt) return 0;
    if (deal.maxTotalUses && deal.currentUses >= deal.maxTotalUses) return 0;
    if (subtotal < parseFloat(deal.minOrderAmount)) return 0;

    // No discount applies to combo items — only the non-combo subtotal is eligible.
    const eligible = Math.max(0, discountableSubtotal);
    if (eligible <= 0) return 0;

    let discount = 0;

    if (deal.discountType === 'flat') {
        discount = parseFloat(deal.discountValue);
    } else if (deal.discountType === 'percent') {
        discount = eligible * (parseFloat(deal.discountValue) / 100);
        // Apply max cap if set
        if (deal.maxDiscountAmount) {
            discount = Math.min(discount, parseFloat(deal.maxDiscountAmount));
        }
    }

    // Discount cannot exceed the eligible (non-combo) subtotal.
    discount = Math.min(discount, eligible);

    return roundMoney(discount);
}

/**
 * Round to 2 decimal places (standard money rounding).
 */
function roundMoney(amount) {
    return Math.round(amount * 100) / 100;
}

/**
 * The developer can only discount out of their 4% share, so a per-item
 * developer discount is clamped to [0, price * PLATFORM_FEE_RATE].
 */
export function clampDevDiscount(price, discount) {
    const p = parseFloat(price) || 0;
    const d = parseFloat(discount) || 0;
    return roundMoney(Math.min(Math.max(d, 0), p * PLATFORM_FEE_RATE));
}

/** Customer-visible price = base price − (clamped) developer discount. */
export function visiblePrice(price, discount) {
    return roundMoney((parseFloat(price) || 0) - clampDevDiscount(price, discount));
}

/** Normalize a MenuItem.variants Json value into a clean [{name, price}] array. */
export function parseVariants(v) {
    if (!v) return [];
    let arr = v;
    if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { return []; } }
    if (!Array.isArray(arr)) return [];
    return arr
        .filter(x => x && x.name != null && x.price != null && !isNaN(parseFloat(x.price)))
        .map(x => ({ name: String(x.name).trim(), price: roundMoney(parseFloat(x.price)) }));
}

/**
 * Resolve the unit price, display name and (developer) discount for one cart line.
 * Bar items priced by size MUST specify a valid variant; their developer discount is 0.
 * Non-variant items use base price minus the per-item developer discount.
 */
export function resolveLine(menuItem, variantName) {
    // Combos are never discounted (no developer per-item discount).
    const isCombo = menuItem.section === 'Combo';
    const variants = parseVariants(menuItem.variants);
    if (variants.length) {
        if (!variantName) {
            throw new AppError(`Please choose an option for ${menuItem.name}`, 400, 'VARIANT_REQUIRED');
        }
        const v = variants.find(x => x.name === variantName);
        if (!v) throw new AppError(`Invalid option for ${menuItem.name}`, 400, 'INVALID_VARIANT');
        return { unitPrice: v.price, itemName: `${menuItem.name} · ${v.name}`, variant: v.name, devDiscount: 0, isCombo };
    }
    return {
        unitPrice: parseFloat(menuItem.price),
        itemName: menuItem.name,
        variant: null,
        devDiscount: isCombo ? 0 : clampDevDiscount(menuItem.price, menuItem.developerDiscount),
        isCombo
    };
}



// ============================================================
// PAYMENT VERIFICATION (Automatic via Razorpay Webhook)
// ============================================================



// ============================================================
// ORDER STATUS TRANSITIONS
// ============================================================

/**
 * Transition an order from one status to another.
 * Validates the transition is legal and records it in the audit log.
 */
export async function transitionOrderStatus(orderId, options) {
    const { newStatus, changedBy, changedByRole, notes, metadata } = options;

    const order = await prisma.order.findUnique({
        where: { id: orderId }
    });

    if (!order) {
        throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    const currentStatus = order.status;

    // Validate transition
    const allowedTargets = STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedTargets.includes(newStatus)) {
        throw new AppError(
            `Cannot transition from '${currentStatus}' to '${newStatus}'`,
            400,
            'INVALID_TRANSITION'
        );
    }

    // Validate authorization
    const authorizedRoles = STATUS_AUTHORIZERS[newStatus] || [];
    if (!authorizedRoles.includes(changedByRole) && !authorizedRoles.includes('system')) {
        throw new AppError(
            `Role '${changedByRole}' cannot transition to '${newStatus}'`,
            403,
            'UNAUTHORIZED_TRANSITION'
        );
    }

    // Perform transition in a transaction
    const result = await prisma.$transaction(async (tx) => {
        const updateData = {
            status: newStatus,
            updatedAt: new Date()
        };

        // Set delivered timestamp
        if (newStatus === 'delivered' || newStatus === 'completed') {
            updateData.deliveredAt = new Date();
            updateData.paidAt = new Date();
        }

        // Set cancellation info
        if (newStatus === 'cancelled') {
            updateData.cancelledBy = changedBy;
            updateData.cancelReason = notes;
        }

        const updated = await tx.order.update({
            where: { id: orderId },
            data: updateData,
            include: {
                items: true,
                user: { select: { id: true, name: true, phone: true } }
            }
        });

        // Audit log
        await tx.orderLog.create({
            data: {
                orderId,
                fromStatus: currentStatus,
                toStatus: newStatus,
                changedBy,
                changedByRole,
                notes: notes || null,
                metadata: metadata || null
            }
        });

        return updated;
    });

    return result;
}

// ============================================================
// ORDER CANCELLATION (Admin)
// ============================================================

export async function cancelOrder(orderId, adminUserId, reason) {
    if (!reason || reason.trim().length === 0) {
        throw new AppError('Cancellation reason is required', 400, 'REASON_REQUIRED');
    }

    const order = await transitionOrderStatus(orderId, {
        newStatus: 'cancelled',
        changedBy: adminUserId,
        changedByRole: ROLES.ADMIN,
        notes: reason
    });

    return order;
}

// ============================================================
// ORDER PAYMENT TIMEOUT
// ============================================================

/**
 * Auto-expire orders that haven't been verified within the timeout window.
 * Called by a cron job every minute.
 */
export async function expirePaymentVerification() {
    const cutoff = new Date(Date.now() - ORDER_PAYMENT_TIMEOUT * 60 * 1000);

    const expiredOrders = await prisma.order.findMany({
        where: {
            status: 'payment_verification_pending',
            createdAt: { lt: cutoff }
        }
    });

    for (const order of expiredOrders) {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: order.id },
                data: { status: 'cancelled' }
            });

            await tx.orderLog.create({
                data: {
                    orderId: order.id,
                    fromStatus: 'payment_verification_pending',
                    toStatus: 'cancelled',
                    changedByRole: 'system',
                    notes: `Payment verification expired after ${ORDER_PAYMENT_TIMEOUT} minutes`
                }
            });

            // Reverse deal usage
            if (order.appliedDealId) {
                await tx.dealUsage.deleteMany({
                    where: { orderId: order.id }
                });
                await tx.deal.update({
                    where: { id: order.appliedDealId },
                    data: { currentUses: { decrement: 1 } }
                });
            }
        });
    }

    return expiredOrders.length;
}


// ============================================================
// VALIDATION HELPERS
// ============================================================

/**
 * MANDATORY delivery info validation.
 *
 * This is the GATEKEEPER — without passing this validation,
 * no Razorpay order is created, no QR code is generated,
 * and the customer CANNOT pay.
 *
 * Required fields:
 *   - deliveryName    → Who is receiving (person's name)
 *   - deliveryPhone   → Contact number for delivery person
 *   - buildingName    → Office building / company name
 *   - floorSeat       → Exact location (floor, desk number, wing, etc.)
 *
 * These are stored on the ORDER itself (not just user profile)
 * because the same user might order from different offices/desks.
 */
export function validateOrderContext(data, orderType) {
    const errors = [];
    const sanitized = {};

    if (!data || typeof data !== 'object') {
        throw new AppError('Order context is required.', 400, 'VALIDATION_ERROR');
    }

    if (orderType === 'DELIVERY') {
        const fields = {
            deliveryName:  { label: 'Your name',         min: 2,  max: 100 },
            deliveryPhone: { label: 'Phone number',      min: 10, max: 15  },
            buildingName:  { label: 'Office building / company name', min: 2, max: 200 },
            floorSeat:     { label: 'Floor, desk, or seat location',  min: 2, max: 100 }
        };

        for (const [field, rules] of Object.entries(fields)) {
            const value = data[field];
            if (!value || typeof value !== 'string' || value.trim().length === 0) {
                errors.push(`${rules.label} is required`);
                continue;
            }
            const trimmed = value.trim();
            if (trimmed.length < rules.min) errors.push(`${rules.label} must be at least ${rules.min} characters`);
            if (trimmed.length > rules.max) errors.push(`${rules.label} must be under ${rules.max} characters`);
        }

        if (data.deliveryPhone && !errors.some(e => e.includes('Phone'))) {
            const digits = data.deliveryPhone.replace(/\D/g, '');
            const cleanPhone = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
            if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
                errors.push('Please enter a valid 10-digit Indian mobile number');
            }
        }
        sanitized.deliveryName = data.deliveryName?.trim();
        sanitized.deliveryPhone = data.deliveryPhone?.replace(/\D/g, '').slice(-10);
        sanitized.buildingName = data.buildingName?.trim();
        sanitized.floorSeat = data.floorSeat?.trim();

    } else if (orderType === 'TAKEAWAY') {
        if (!data.deliveryName || data.deliveryName.trim().length < 2) errors.push('Your name is required for takeaway');
        if (!data.deliveryPhone) errors.push('Your phone number is required for takeaway');
        if (data.deliveryPhone) {
            const digits = data.deliveryPhone.replace(/\D/g, '');
            const cleanPhone = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
            if (!/^[6-9]\d{9}$/.test(cleanPhone)) errors.push('Please enter a valid 10-digit Indian mobile number');
        }
        sanitized.deliveryName = data.deliveryName?.trim();
        sanitized.deliveryPhone = data.deliveryPhone?.replace(/\D/g, '').slice(-10);

    } else if (orderType === 'DINE_IN') {
        if (!data.tableNumber || data.tableNumber.trim().length === 0) errors.push('Table number is required for dine-in');
        sanitized.tableNumber = data.tableNumber?.trim();
        if (data.deliveryName) sanitized.deliveryName = data.deliveryName.trim();
    }

    if (errors.length > 0) {
        throw new AppError(`Please complete the required details:\n• ${errors.join('\n• ')}`, 400, 'VALIDATION_ERROR');
    }

    if (data.deliveryNotes) {
        sanitized.deliveryNotes = data.deliveryNotes.trim().slice(0, 500);
    }
    
    return sanitized;
}

/**
 * MANDATORY delivery info validation for DELIVERY orders.
 * Kept for backward compatibility with validate-delivery endpoint.
 */
export function validateDeliveryInfo(delivery) {
    return validateOrderContext(delivery, 'DELIVERY');
}
