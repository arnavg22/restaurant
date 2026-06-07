// ============================================================
// AUTH ROUTES
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// ── Register (Customer only) ──
router.post('/register', async (req, res, next) => {
    try {
        const { name, email, phone, password } = req.body;

        if (!name || !email || !phone || !password) {
            throw new AppError('All fields are required', 400, 'VALIDATION_ERROR');
        }

        if (password.length < 6) {
            throw new AppError('Password must be at least 6 characters', 400, 'VALIDATION_ERROR');
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: { name, email, phone, passwordHash, role: 'customer' },
            select: { id: true, name: true, email: true, phone: true, role: true }
        });

        const tokens = generateTokens(user);

        res.status(201).json({ user, ...tokens });
    } catch (err) {
        next(err);
    }
});

// ── Login (All roles) ──
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            throw new AppError('Email and password required', 400, 'VALIDATION_ERROR');
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
            throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
        }

        const tokens = generateTokens(user);

        // Store refresh token
        await prisma.session.create({
            data: {
                userId: user.id,
                refreshToken: tokens.refreshToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                deviceInfo: req.headers['user-agent']
            }
        });

        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role
            },
            ...tokens
        });
    } catch (err) {
        next(err);
    }
});

// ── Forgot Password ──
router.post('/forgot-password', async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) {
            throw new AppError('Email is required', 400, 'VALIDATION_ERROR');
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

            await prisma.passwordReset.create({
                data: {
                    email,
                    token,
                    expiresAt
                }
            });

            console.log(`Password reset link for ${email}: http://localhost:3000/reset-password.html?token=${token}`);
        }

        res.json({ message: 'If a user with that email exists, a password reset link has been sent to your email address.' });
    } catch (err) {
        next(err);
    }
});

// ── Reset Password ──
router.post('/reset-password', async (req, res, next) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            throw new AppError('Token and password are required', 400, 'VALIDATION_ERROR');
        }

        const passwordReset = await prisma.passwordReset.findUnique({ where: { token } });

        if (!passwordReset || passwordReset.expiresAt < new Date()) {
            throw new AppError('Invalid or expired password reset token', 400, 'VALIDATION_ERROR');
        }

        const passwordHash = await bcrypt.hash(password, 10);

        await prisma.user.update({
            where: { email: passwordReset.email },
            data: { passwordHash }
        });

        await prisma.passwordReset.delete({ where: { token } });

        res.json({ message: 'Password has been reset successfully.' });
    } catch (err) {
        next(err);
    }
});

// ── Refresh Token ──
router.post('/refresh', async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            throw new AppError('Refresh token required', 400, 'VALIDATION_ERROR');
        }

        const session = await prisma.session.findFirst({
            where: {
                refreshToken,
                expiresAt: { gt: new Date() }
            },
            include: { user: true }
        });

        if (!session) {
            throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH');
        }

        const tokens = generateTokens(session.user);

        // Update refresh token
        await prisma.session.update({
            where: { id: session.id },
            data: {
                refreshToken: tokens.refreshToken,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            }
        });

        res.json(tokens);
    } catch (err) {
        next(err);
    }
});

// ── Logout ──
router.post('/logout', authenticate, async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        if (refreshToken) {
            await prisma.session.deleteMany({
                where: { userId: req.user.id, refreshToken }
            });
        }
        res.json({ message: 'Logged out' });
    } catch (err) {
        next(err);
    }
});

// ── Get Current User ──
router.get('/me', authenticate, async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true }
        });
        res.json(user);
    } catch (err) {
        next(err);
    }
});

// ── Helpers ──
function generateTokens(user) {
    const accessToken = jwt.sign(
        { sub: user.id, name: user.name, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
    );

    const refreshToken = jwt.sign(
        { sub: user.id, type: 'refresh' },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
    );

    return { accessToken, refreshToken };
}

export default router;
