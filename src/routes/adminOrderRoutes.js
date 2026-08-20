import { Router } from 'express';
import * as controller from '../controllers/orderController.js';
import { verifyFirebaseToken } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';
const router = Router(); router.use(verifyFirebaseToken, requireAdmin); router.get('/', controller.listAdmin); router.get('/:id', controller.getAdmin); router.put('/:id', controller.updateAdmin); export default router;
