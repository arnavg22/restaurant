// ============================================================
// AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// ============================================================
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Extracts and verifies JWT from Authorization header.
 * Attaches user object to req.user
 */
export function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    const queryToken = req.query?.token;
    
    let token;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (queryToken) {
        token = queryToken;
    } else {
        return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {
            id: payload.sub,
            name: payload.name,
            email: payload.email,
            role: payload.role
        };
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
}

/**
 * Role-based access control.
 * Usage: authorize('admin', 'developer')
 */
export function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                required: allowedRoles,
                current: req.user.role
            });
        }
        next();
    };
}

/**
 * Socket.IO authentication middleware.
 * Verifies token from handshake query or auth header.
 */
export async function authenticateSocket(socket, next) {
    try {
        const token = socket.handshake.auth?.token ||
                      socket.handshake.query?.token;

        if (!token) {
            return next(new Error('Authentication required'));
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = {
            id: payload.sub,
            name: payload.name,
            email: payload.email,
            role: payload.role
        };
        next();
    } catch (err) {
        next(new Error('Invalid or expired token'));
    }
}
