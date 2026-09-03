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

app.use(
  cors({
    origin: true,
    credentials: true,
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

// 2. Checkout endpoints limit: 10 requests per 15 minutes per IP
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
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

// Apply General Rate Limiter to all API routes
app.use('/api/', generalLimiter);

// Apply Auth Rate Limiter
app.use('/api/auth', authLimiter);
app.use('/api/admin/auth', authLimiter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    firebaseConfigured: isFirebaseReady(),
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
app.use('/api/tabby', checkoutLimiter, tabbyRoutes);
app.use('/api/payments/tabby', checkoutLimiter, tabbyRoutes);

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