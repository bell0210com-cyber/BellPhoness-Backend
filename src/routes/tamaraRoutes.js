import { Router } from 'express';
import * as controller from '../controllers/tamaraController.js';
import { verifyFirebaseToken, optionalFirebaseToken } from '../middleware/authMiddleware.js';

const router = Router();

// 1. Checkout Session Creation (Accepts both /create-checkout and /checkout)
router.post('/create-checkout', verifyFirebaseToken, controller.createCheckout);
router.post('/checkout', verifyFirebaseToken, controller.createCheckout);

// 2. Tamara Webhook Notifications (Public endpoint, verified via Notification Token JWT / Header)
router.post('/webhook', controller.handleWebhook);

// 3. Live Order Status Lookup from Tamara
router.get('/order/:id', optionalFirebaseToken, controller.getOrderStatus);

// 4. Return Verification from Tamara redirect callback
router.post('/verify-return', optionalFirebaseToken, controller.verifyReturn);

export default router;
