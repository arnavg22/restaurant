// ============================================================
// APPLICATION CONSTANTS
// ============================================================

export const PLATFORM_FEE_RATE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.04');
export const RESTAURANT_SHARE_RATE = 1 - PLATFORM_FEE_RATE; // 0.96
export const TAX_RATE = parseFloat(process.env.TAX_RATE || '0.05'); // legacy single tax (fallback)
// Two tax regimes:
//   GST → applied to non-alcohol items (Food / Combo) — default 5%
//   VAT → applied to alcohol items (Bar section)       — default 18%
// These defaults are overridable by the admin via Settings (stored in the DB).
export const DEFAULT_GST_RATE = parseFloat(process.env.GST_RATE || '0.05'); // 5%
export const DEFAULT_VAT_RATE = parseFloat(process.env.VAT_RATE || '0.18'); // 18%
export const ORDER_PAYMENT_TIMEOUT = parseInt(process.env.ORDER_PAYMENT_TIMEOUT_MINUTES || '10');

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
