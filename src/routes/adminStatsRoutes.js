import { Router } from 'express';
import * as controller from '../controllers/statsController.js';
import { verifyFirebaseToken } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';

const router = Router();
router.use(verifyFirebaseToken, requireAdmin);

router.get('/', controller.getStats);

export default router;
