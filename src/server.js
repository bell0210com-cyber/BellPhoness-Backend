import express from 'express';
import cors from 'cors';
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

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL?.split(',') || true,
  })
);

app.use(express.json({ limit: '1mb' }));

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
app.use('/api/tamara', tamaraRoutes);
app.use('/api/payments/tamara', tamaraRoutes);
app.use('/api/tabby', tabbyRoutes);
app.use('/api/payments/tabby', tabbyRoutes);



// --- Naye Routes Yahan Add Kiye Hain ---
app.use('/api/admin/customers', adminCustomerRoutes);
app.use('/api/admin/settings', adminSettingsRoutes);
app.use('/api/admin/stats', adminStatsRoutes);
app.use('/api/admin/hero-slides', adminHeroSlideRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

import { startTabbyCronJob } from './services/tabbyCron.js';

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`BELL API listening on ${PORT}`);
  startTabbyCronJob();
});
