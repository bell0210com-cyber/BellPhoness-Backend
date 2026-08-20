import { Router } from 'express';
import * as controller from '../controllers/customerController.js';
import { verifyFirebaseToken } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';

const router = Router();

router.use(verifyFirebaseToken, requireAdmin);

router.get('/', controller.adminList);
router.get('/:id', controller.adminGet);

export default router;