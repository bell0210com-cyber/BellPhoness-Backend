import { Router } from 'express';
import * as controller from '../controllers/settingsController.js';
import { verifyFirebaseToken } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';

const router = Router();

router.use(verifyFirebaseToken, requireAdmin);

router.get('/', controller.get);
router.put('/', controller.update);

export default router;