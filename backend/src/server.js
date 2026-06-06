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

import authRoutes from './routes/auth.routes.js';
import menuRoutes from './routes/menu.routes.js';
import orderRoutes from './routes/order.routes.js';
import adminRoutes from './routes/admin.routes.js';
import deliveryRoutes from './routes/delivery.routes.js';
import devRoutes from './routes/dev.routes.js';

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
app.use(helmet());
app.use(cors());

app.use(express.json());

app.use(express.static('../frontend'));

// ── Health Check ──
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'cafeteria-green-api', timestamp: new Date().toISOString() });
});

// ── Routes ──
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/menu', menuRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/delivery', deliveryRoutes);
app.use('/api/v1/dev', devRoutes);


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
