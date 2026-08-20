import { Router } from 'express';
import * as controller from '../controllers/productController.js';
const router = Router(); router.get('/', controller.publicList); router.get('/:id', controller.publicGet); export default router;
