// ============================================================
// APPLICATION CONSTANTS
// ============================================================

export const PLATFORM_FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.15');
export const RESTAURANT_SHARE_RATE = 1 - PLATFORM_FEE_RATE; // 0.85
export const TAX_RATE = parseFloat(process.env.TAX_RATE || '0.05'); // 5% tax on order subtotal (fallback only)
export const ORDER_PAYMENT_TIMEOUT = parseInt(process.env.ORDER_PAYMENT_TIMEOUT_MINUTES || '10');

// ── GST ──
// Default GST applied to an item (as a percentage) when none is set.
export const DEFAULT_GST_RATE = parseFloat(process.env.DEFAULT_GST_RATE || '5'); // 5%
// Beers are always charged 18% GST, regardless of the item's own gstRate.
export const BEER_GST_RATE = 18;

/**
 * Combos & thalis: these items (and any cart containing one) never receive a
 * discount — neither a per-item developer discount nor a cart-level offer/deal.
 */
export function isComboItem(item) {
    const cat = (item?.category || '').toLowerCase();
    const name = (item?.name || '').toLowerCase();
    return /combo|thali/.test(cat) || /combo|thali/.test(name);
}

/** Beers always attract 18% GST. Matched by category or name. */
export function isBeerItem(item) {
    const cat = (item?.category || '').toLowerCase();
    const name = (item?.name || '').toLowerCase();
    return cat.includes('beer') || name.includes('beer');
}

// Valid status transitions
export const STATUS_TRANSITIONS = {
    // Customer places order with a UPI transaction ID → awaits MANUAL payment verification by admin
    payment_verification_pending: ['accepted', 'cancelled', 'payment_expired'],
    accepted:        ['preparing', 'cancelled'],
    preparing:       ['ready', 'cancelled'],
    ready:           ['out_for_delivery', 'completed', 'cancelled'],
    out_for_delivery: ['delivered'],
    // Terminal states — no transitions out
    delivered:       [],
    completed:       [],
    cancelled:       [],
    payment_expired: []
};

// Who can transition to each status
export const STATUS_AUTHORIZERS = {
    accepted:          ['admin'],                 // admin manually verifies the UPI transaction ID
    preparing:         ['admin', 'kitchen'],      // kitchen cooks
    ready:             ['admin', 'kitchen'],
    out_for_delivery:  ['admin', 'delivery'],
    delivered:         ['delivery'],
    completed:         ['admin'],
    cancelled:         ['admin'],
    payment_expired:   ['system']
};

// Roles
export const ROLES = {
    CUSTOMER:  'customer',
    ADMIN:     'admin',
    KITCHEN:   'kitchen',
    DELIVERY:  'delivery',
    DEVELOPER: 'developer'
};

// Terminal statuses (orders in these states won't change)
export const TERMINAL_STATUSES = ['delivered', 'completed', 'cancelled', 'payment_expired'];
