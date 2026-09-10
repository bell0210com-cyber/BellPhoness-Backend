import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

import productRoutes from './routes/productRoutes.js';
import adminProductRoutes from './routes/adminProductRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import adminOrderRoutes from './routes/adminOrderRoutes.js';

import adminCustomerRoutes from './routes/adminCustomerRoutes.js';
import adminSettingsRoutes from './routes/adminSettingsRoutes.js';
import adminStatsRoutes from './routes/adminStatsRoutes.js';
import heroSlideRoutes from './routes/heroSlideRoutes.js';
import adminHeroSlideRoutes from './routes/adminHeroSlideRoutes.js';
import tamaraRoutes from './routes/tamaraRoutes.js';
import tabbyRoutes from './routes/tabbyRoutes.js';

import { isFirebaseReady } from './config/firebaseAdmin.js';
import { errorHandler, notFound } from './middleware/errorMiddleware.js';
import { startTabbyCronJob } from './services/tabbyCron.js';

const app = express();

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
  'https://bellphoness.com',
  'https://www.bellphoness.com',
  'https://admin.bellphoness.com',
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map((s) => s.trim()) : []),
]);

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (hostname === 'bellphoness.com' || hostname.endsWith('.bellphoness.com')) return true;
  } catch {
    return false;
  }
  return false;
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, origin || true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-signature', 'x-tabby-signature'],
  })
);

// HTTP Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '1mb' }));

// --- Rate Limiting Configuration ---

// Whitelist/bypass legitimate return verification and webhook notifications from rate limiting
const isBypassedEndpoint = (req) => {
  const url = req.originalUrl || req.url || '';
  return (
    url.includes('/verify-return') ||
    url.includes('/webhook') ||
    url.includes('tabby/callback') ||
    url.includes('tamara/callback')
  );
};

// 1. General API limit: 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBypassedEndpoint,
  message: { message: 'Too many requests, please try again later.' },
});

// 2. Checkout endpoints limit: 50 requests per 15 minutes per IP
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBypassedEndpoint,
  message: { message: 'Too many requests, please try again later.' },
});

// 3. Auth endpoints limit: 5 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});

// 4. Tabby payment endpoint limit: 50 requests per 15 minutes per IP
const tabbyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBypassedEndpoint,
  message: { message: 'Too many requests, please try again later.' },
});

// Apply General Rate Limiter to all API routes
app.use('/api/', generalLimiter);

// Apply Auth Rate Limiter
app.use('/api/auth', authLimiter);
app.use('/api/admin/auth', authLimiter);

// Root status endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'BELL Backend API is running successfully.',
    service: 'BELL Backend API',
    firebaseConfigured: isFirebaseReady(),
    endpoints: {
      health: '/api/health',
      products: '/api/products',
      orders: '/api/orders',
      tabby: '/api/tabby',
      tamara: '/api/tamara',
    },
    storefront: 'http://localhost:5173',
    adminPanel: 'http://localhost:5173/admin/login',
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BELL Backend API',
    firebaseConfigured: isFirebaseReady(),
  });
});

app.get('/api', (req, res) => {
  res.json({
    status: 'ok',
    message: 'BELL API Base Endpoint',
    endpoints: {
      health: '/api/health',
      products: '/api/products',
      orders: '/api/orders',
      tabby: '/api/tabby',
      tamara: '/api/tamara',
    },
  });
});

// API routes
app.use('/api/hero-slides', heroSlideRoutes);
app.use('/api/products', productRoutes);
app.use('/api/admin/products', adminProductRoutes);

app.use('/api/orders', orderRoutes);
app.use('/api/admin/orders', adminOrderRoutes);

// Apply Checkout Rate Limiter to Tabby & Tamara payment routes
app.use('/api/tamara', checkoutLimiter, tamaraRoutes);
app.use('/api/payments/tamara', checkoutLimiter, tamaraRoutes);
app.use('/api/tabby', tabbyLimiter, tabbyRoutes);
app.use('/api/payments/tabby', tabbyLimiter, tabbyRoutes);

// Admin Routes
app.use('/api/admin/customers', adminCustomerRoutes);
app.use('/api/admin/settings', adminSettingsRoutes);
app.use('/api/admin/stats', adminStatsRoutes);
app.use('/api/admin/hero-slides', adminHeroSlideRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`BELL API listening on ${PORT}`);
  startTabbyCronJob();
});