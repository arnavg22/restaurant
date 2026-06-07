// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

export class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}

export function errorHandler(err, req, res, _next) {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            error: err.message,
            code: err.code
        });
    }

    // Prisma known errors
    if (err.code === 'P2025') {
        return res.status(404).json({ error: 'Record not found', code: 'NOT_FOUND' });
    }
    if (err.code === 'P2002') {
        return res.status(409).json({ error: 'Duplicate entry', code: 'CONFLICT' });
    }

    // Default
    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message,
        code: 'INTERNAL_ERROR'
    });
}
