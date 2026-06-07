// ============================================================
// ORDER SERVICE — Core Business Logic & Math
// ============================================================
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import {
    PLATFORM_FEE_RATE,
    RESTAURANT_SHARE_RATE,
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
 * Restaurant always gets their 85% of the original subtotal.
 *
 * ┌────────────────────────────────────────────────────┐
 * │  subtotal       = Σ(item.price × quantity)         │
 * │  discount       = min(calculated_discount, cap)    │
 * │  customer_pays  = subtotal - discount              │
 * │  platform_fee   = subtotal × 0.15  (gross)         │
 * │  platform_earnings = platform_fee - discount       │
 * │  restaurant_share  = subtotal × 0.85               │
 * │                                                     │
 * │  VERIFICATION:                                      │
 * │  customer_pays = restaurant_share + platform_earnings│
 * │  (subtotal - discount) = (subtotal×0.85) + (fee-disc)│
 * │  = (subtotal×0.85) + (subtotal×0.15) - discount     │
 * │  = subtotal - discount  ✓                           │
 * └────────────────────────────────────────────────────┘
 */
export function calculateOrderFinancials(subtotal, discountAmount = 0) {
    // Ensure discount never exceeds what platform can absorb
    const maxDiscount = subtotal * PLATFORM_FEE_RATE;
    const cappedDiscount = Math.min(discountAmount, maxDiscount);

    const platformFee = roundMoney(subtotal * PLATFORM_FEE_RATE);
    const restaurantShare = roundMoney(subtotal * RESTAURANT_SHARE_RATE);
    const customerPays = roundMoney(subtotal - cappedDiscount);
    const platformEarnings = roundMoney(platformFee - cappedDiscount);
    const discountFromPlatform = roundMoney(cappedDiscount);

    return {
        subtotal: roundMoney(subtotal),
        discountAmount: discountFromPlatform,    // actual discount applied
        customerPays,
        platformFee,
        discountFromPlatform,
        platformEarnings,
        restaurantShare
    };
}

/**
 * Calculate discount for a specific deal on an order.
 * Returns the discount amount (capped at platform's share).
 */
export function calculateDealDiscount(deal, subtotal, userId) {
    // Check if deal is valid
    const now = new Date();
    if (!deal.isActive) return 0;
    if (now < deal.startsAt || now > deal.expiresAt) return 0;
    if (deal.maxTotalUses && deal.currentUses >= deal.maxTotalUses) return 0;
    if (subtotal < parseFloat(deal.minOrderAmount)) return 0;

    let discount = 0;

    if (deal.discountType === 'flat') {
        discount = parseFloat(deal.discountValue);
    } else if (deal.discountType === 'percent') {
        discount = subtotal * (parseFloat(deal.discountValue) / 100);
        // Apply max cap if set
        if (deal.maxDiscountAmount) {
            discount = Math.min(discount, parseFloat(deal.maxDiscountAmount));
        }
    }

    // CRITICAL: Discount cannot exceed platform's 15% share
    const maxDiscount = subtotal * PLATFORM_FEE_RATE;
    discount = Math.min(discount, maxDiscount);

    return roundMoney(discount);
}

/**
 * Round to 2 decimal places (standard money rounding).
 */
function roundMoney(amount) {
    return Math.round(amount * 100) / 100;
}

/**
 * The developer can only discount out of their 15% share, so a per-item
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
    const variants = parseVariants(menuItem.variants);
    if (variants.length) {
        if (!variantName) {
            throw new AppError(`Please choose an option for ${menuItem.name}`, 400, 'VARIANT_REQUIRED');
        }
        const v = variants.find(x => x.name === variantName);
        if (!v) throw new AppError(`Invalid option for ${menuItem.name}`, 400, 'INVALID_VARIANT');
        return { unitPrice: v.price, itemName: `${menuItem.name} · ${v.name}`, variant: v.name, devDiscount: 0 };
    }
    return {
        unitPrice: parseFloat(menuItem.price),
        itemName: menuItem.name,
        variant: null,
        devDiscount: clampDevDiscount(menuItem.price, menuItem.developerDiscount)
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
        if (newStatus === 'delivered') {
            updateData.deliveredAt = new Date();
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
export function validateDeliveryInfo(delivery) {
    if (!delivery || typeof delivery !== 'object') {
        throw new AppError(
            'Delivery information is required. Please provide your name, phone number, office building, and desk/floor location before placing an order.',
            400,
            'MISSING_DELIVERY_INFO'
        );
    }

    // ── Field presence checks ──
    const fields = {
        deliveryName:  { label: 'Your name',         min: 2,  max: 100 },
        deliveryPhone: { label: 'Phone number',      min: 10, max: 15  },
        buildingName:  { label: 'Office building / company name', min: 2, max: 200 },
        floorSeat:     { label: 'Floor, desk, or seat location',  min: 2, max: 100 }
    };

    const errors = [];

    for (const [field, rules] of Object.entries(fields)) {
        const value = delivery[field];

        if (!value || typeof value !== 'string' || value.trim().length === 0) {
            errors.push(`${rules.label} is required`);
            continue;
        }

        const trimmed = value.trim();

        if (trimmed.length < rules.min) {
            errors.push(`${rules.label} must be at least ${rules.min} characters`);
        }

        if (trimmed.length > rules.max) {
            errors.push(`${rules.label} must be under ${rules.max} characters`);
        }
    }

    // ── Phone number validation (Indian mobile) ──
    if (delivery.deliveryPhone && !errors.some(e => e.includes('Phone'))) {
        const digits = delivery.deliveryPhone.replace(/\D/g, '');

        // Indian mobile: starts with 6/7/8/9, 10 digits
        // Also accept with +91 prefix (12 digits total)
        const cleanPhone = digits.length === 12 && digits.startsWith('91')
            ? digits.slice(2)
            : digits;

        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
            errors.push('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9');
        }
    }

    // ── Building name: reject pure numbers or gibberish ──
    if (delivery.buildingName && !errors.some(e => e.includes('building'))) {
        const building = delivery.buildingName.trim();
        if (/^\d+$/.test(building)) {
            errors.push('Office building name should include actual text, not just a number');
        }
    }

    // ── Floor/seat: should contain some useful location info ──
    if (delivery.floorSeat && !errors.some(e => e.includes('Floor'))) {
        const location = delivery.floorSeat.trim();
        if (location.length < 2) {
            errors.push('Please provide a more specific location (e.g., "3rd Floor, Desk 42" or "Ground Floor, Near Reception")');
        }
    }

    // ── Throw all errors at once ──
    if (errors.length > 0) {
        throw new AppError(
            `Please complete your delivery details:\n• ${errors.join('\n• ')}`,
            400,
            'MISSING_DELIVERY_INFO'
        );
    }

    // ── Sanitize: trim all fields ──
    delivery.deliveryName  = delivery.deliveryName.trim();
    delivery.deliveryPhone = delivery.deliveryPhone.replace(/\D/g, '').slice(-10); // store last 10 digits
    delivery.buildingName  = delivery.buildingName.trim();
    delivery.floorSeat     = delivery.floorSeat.trim();
    if (delivery.deliveryNotes) {
        delivery.deliveryNotes = delivery.deliveryNotes.trim().slice(0, 500);
    }
}
