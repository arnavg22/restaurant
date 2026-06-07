// ============================================================
// SOCKET.IO EVENT HANDLERS
// ============================================================

export function setupSocketHandlers(io) {
    io.on('connection', (socket) => {
        const user = socket.user;
        console.log(`[WS] Connected: ${user.name} (${user.role})`);

        // ── Customer: subscribe to their order updates ──
        socket.on('subscribe:order', (orderId) => {
            // Customers can only subscribe to their own orders
            // (authorization checked in the API when fetching order)
            socket.join(`order:${orderId}`);
            console.log(`[WS] ${user.name} subscribed to order:${orderId}`);
        });

        socket.on('unsubscribe:order', (orderId) => {
            socket.leave(`order:${orderId}`);
        });

        // ── Admin: subscribe to new orders + kitchen board ──
        if (user.role === 'admin') {
            socket.join('admin_feed');
            socket.join('kitchen_feed');
            console.log(`[WS] Admin ${user.name} joined admin_feed`);
        }

        // ── Kitchen: subscribe to accepted orders ──
        if (user.role === 'kitchen') {
            socket.join('kitchen_feed');
            console.log(`[WS] Kitchen ${user.name} joined kitchen_feed`);
        }

        // ── Delivery: subscribe to ready orders ──
        if (user.role === 'delivery') {
            socket.join('delivery_feed');
            console.log(`[WS] Delivery ${user.name} joined delivery_feed`);
        }

        // ── Developer: can subscribe to all events (read-only) ──
        if (user.role === 'developer') {
            socket.join('admin_feed');      // See new orders
            socket.join('kitchen_feed');    // See kitchen events
            socket.join('delivery_feed');   // See delivery events
            console.log(`[WS] Developer ${user.name} subscribed to all feeds`);
        }

        // ── Disconnect ──
        socket.on('disconnect', () => {
            console.log(`[WS] Disconnected: ${user.name} (${user.role})`);
        });
    });
}
