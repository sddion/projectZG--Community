require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const path = require('path');
const PORT = process.env.PORT || 3000;

// Middleware
const cookieParser = require('cookie-parser');
app.use(cookieParser());

// CORS configuration - restrict to your domain in production
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // In dev, allow any localhost/127.0.0.1
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        // In prod, check allowlist
        const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '').split(',').map(o => o.trim());
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn('CORS Blocked Origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-refresh-token']
}));

// Content Security Policy
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdnjs.cloudflare.com https://vercel.live", // Added vercel.live
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: https: blob:",
        "connect-src 'self' https://*.supabase.co https://unpkg.com https://vercel.live", // Added vercel.live
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
    ].join('; '));

    // Additional security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    next();
});

app.use(express.json());

// Serve static files from 'public' directory
app.use(express.static(path.join(process.cwd(), 'public')));

// Explicit root handler for Vercel
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

// Serve auth pages with clean URLs

// Auth Pages (catch all auth-related routes and serve the SPA)
const authPagePath = path.join(process.cwd(), 'public/auth/index.html');

const authHandler = (req, res) => res.sendFile(authPagePath);

app.get([
    '/auth', '/auth/*path',
    '/reset-password', '/reset-password/*path',
    '/verify-email', '/verify-email/*path',
    '/onboarding', '/onboarding/*path'
], authHandler);

// API Routes
app.use('/api/auth', require('./api/auth/index'));


// Only listen if run directly (local dev), otherwise export for Vercel
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;
