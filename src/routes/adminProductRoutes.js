import { Router } from 'express';
import * as controller from '../controllers/productController.js';
import { verifyFirebaseToken } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';
import { imageUpload } from '../middleware/uploadMiddleware.js';
const router = Router(); router.use(verifyFirebaseToken, requireAdmin); router.get('/', controller.adminList); router.post('/', controller.create); router.get('/:id', controller.adminGet); router.put('/:id', controller.update); router.delete('/:id', controller.remove); router.patch('/:id/status', controller.status); router.post('/:id/images', imageUpload.array('images', 10), controller.uploadImages); router.delete('/:id/images', controller.removeImage); export default router;
