// ============================================================
// APPLICATION CONSTANTS
// ============================================================

export const PLATFORM_FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.15');
export const RESTAURANT_SHARE_RATE = 1 - PLATFORM_FEE_RATE; // 0.85
export const ORDER_PAYMENT_TIMEOUT = parseInt(process.env.ORDER_PAYMENT_TIMEOUT_MINUTES || '10');

// Valid status transitions
export const STATUS_TRANSITIONS = {
    pending_payment: ['placed', 'payment_expired'],
    placed:          ['accepted', 'cancelled'],
    accepted:        ['preparing', 'cancelled'],
    preparing:       ['ready', 'cancelled'],
    ready:           ['out_for_delivery'],
    out_for_delivery: ['delivered'],
    // Terminal states — no transitions out
    delivered:       [],
    cancelled:       [],
    payment_expired: []
};

// Who can transition to each status
export const STATUS_AUTHORIZERS = {
    placed:            ['system'],           // auto via webhook
    accepted:          ['admin'],
    preparing:         ['admin'],
    ready:             ['admin'],
    out_for_delivery:  ['admin', 'delivery'],
    delivered:         ['delivery'],
    cancelled:         ['admin'],
    payment_expired:   ['system']
};

// Roles
export const ROLES = {
    CUSTOMER:  'customer',
    ADMIN:     'admin',
    DELIVERY:  'delivery',
    DEVELOPER: 'developer'
};

// Terminal statuses (orders in these states won't change)
export const TERMINAL_STATUSES = ['delivered', 'cancelled', 'payment_expired'];
