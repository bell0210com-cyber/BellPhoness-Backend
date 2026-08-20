import { Router } from 'express';
import * as controller from '../controllers/orderController.js';
import { verifyFirebaseToken } from '../middleware/authMiddleware.js';
const router = Router(); router.use(verifyFirebaseToken); router.post('/', controller.create); router.get('/', controller.listOwn); router.get('/:id', controller.getOwn); export default router;
