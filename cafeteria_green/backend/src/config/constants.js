// ============================================================
// APPLICATION CONSTANTS
// ============================================================

export const PLATFORM_FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.15');
export const RESTAURANT_SHARE_RATE = 1 - PLATFORM_FEE_RATE; // 0.85
export const ORDER_PAYMENT_TIMEOUT = parseInt(process.env.ORDER_PAYMENT_TIMEOUT_MINUTES || '10');

// Valid status transitions
export const STATUS_TRANSITIONS = {
    // Customer places order with a UPI transaction ID → awaits MANUAL payment verification by admin
    payment_verification_pending: ['accepted', 'cancelled', 'payment_expired'],
    accepted:        ['preparing', 'cancelled'],
    preparing:       ['ready', 'cancelled'],
    ready:           ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered'],
    // Terminal states — no transitions out
    delivered:       [],
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
export const TERMINAL_STATUSES = ['delivered', 'cancelled', 'payment_expired'];
