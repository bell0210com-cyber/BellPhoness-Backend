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

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
  'https://bellphoness.com',
  'https://admin.bellphoness.com',
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map((s) => s.trim()) : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isAllowed =
        origin === 'http://localhost:5173' ||
        origin === 'http://127.0.0.1:5173' ||
        origin.includes('localhost') ||
        origin.includes('bellphoness.com') ||
        allowedOrigins.includes(origin);
      return callback(null, isAllowed ? origin : true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-signature', 'x-tabby-signature'],
  })
);

app.use(express.json({ limit: '1mb' }));

// --- Rate Limiting Configuration ---

// 1. General API limit: 100 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});

// 2. Checkout endpoints limit: 50 requests per 15 minutes per IP
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
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