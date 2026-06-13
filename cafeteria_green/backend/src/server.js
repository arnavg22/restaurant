// ============================================================
// CAFETERIA GREEN — MAIN SERVER
// ============================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import authRoutes from './routes/auth.routes.js';
import menuRoutes from './routes/menu.routes.js';
import orderRoutes from './routes/order.routes.js';
import addressRoutes from './routes/address.routes.js';
import adminRoutes from './routes/admin.routes.js';
import kitchenRoutes from './routes/kitchen.routes.js';
import deliveryRoutes from './routes/delivery.routes.js';
import devRoutes from './routes/dev.routes.js';
import discountRoutes from './routes/discount.routes.js';
import settingsRoutes from './routes/settings.routes.js';

import { authenticateSocket } from './middleware/auth.js';
import { setupSocketHandlers } from './websocket/socketHandler.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const httpServer = createServer(app);

// ── Socket.IO ──
const io = new SocketIO(httpServer, {
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST']
    }
});

// Make io accessible in routes
app.set('io', io);
app.set('prisma', new PrismaClient());

// ── Middleware ──
// CSP tuned for the served dashboards: same-origin scripts/styles + the few
// inline bits they use, Google Fonts, data: images (UPI QR), and same-origin
// WebSocket (Socket.IO). upgrade-insecure-requests is disabled so it works on local http.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'script-src': ["'self'", "'unsafe-inline'"],
            'script-src-attr': ["'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'font-src': ["'self'", 'https://fonts.gstatic.com'],
            'img-src': ["'self'", 'data:'],
            'connect-src': ["'self'"],
            'upgrade-insecure-requests': null,
        },
    },
}));
app.use(cors());

// Quiet favicon 404s for the dashboards
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use(express.json());

// ── Pretty URL Routes ──
const sendPage = (page) => (req, res) => res.sendFile(page, { root: '../cafeteria-green' });
app.get('/', sendPage('index.html'));
app.get('/admin', sendPage('admin.html'));
app.get('/customer', sendPage('customer.html'));
app.get('/delivery', sendPage('delivery.html'));
app.get('/developer', sendPage('developer.html'));
app.get('/discount', sendPage('discount.html'));
app.get('/kitchen', sendPage('kitchen.html'));

// Serve the connected Cafeteria Green app (customer/admin/delivery/developer) same-origin.
// Available at both / and /app for convenience.
app.use(express.static('../cafeteria-green'));
app.use('/app', express.static('../cafeteria-green'));

// ── Health Check ──
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'cafeteria-green-api', timestamp: new Date().toISOString() });
});

// ── Routes ──
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/menu', menuRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/kitchen', kitchenRoutes);
app.use('/api/v1/delivery', deliveryRoutes);
app.use('/api/v1/dev', devRoutes);
app.use('/api/v1/discount', discountRoutes);
app.use('/api/v1/settings', settingsRoutes);


// ── Error Handler ──
app.use(errorHandler);

// ── Socket.IO Auth & Handlers ──
io.use(authenticateSocket);
setupSocketHandlers(io);

// ── Start ──
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🌿 Cafeteria Green API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

export { io };
