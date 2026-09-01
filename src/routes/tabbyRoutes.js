import { Router } from 'express';
import * as controller from '../controllers/tabbyController.js';
import { verifyFirebaseToken, optionalFirebaseToken } from '../middleware/authMiddleware.js';

const router = Router();

// 1. Checkout Session Creation
router.post('/create-checkout', verifyFirebaseToken, controller.createCheckout);
router.post('/checkout', verifyFirebaseToken, controller.createCheckout);

// 2. Tabby Webhook Notifications (Public endpoint, verified inside controller)
router.post('/webhook', controller.handleWebhook);

// 3. Live Payment Status Lookup from Tabby
router.get('/payment/:id', optionalFirebaseToken, controller.getPaymentStatus);
router.get('/order/:id', optionalFirebaseToken, controller.getPaymentStatus);

// 4. Return Verification from Tabby redirect callback
router.post('/verify-return', optionalFirebaseToken, controller.verifyReturn);

export default router;
