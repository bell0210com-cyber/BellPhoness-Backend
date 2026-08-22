import express from 'express';
import {
  listHeroSlides,
  getHeroSlide,
  createHeroSlide,
  updateHeroSlide,
  deleteHeroSlide,
} from '../services/heroSlideService.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';
import { verifyFirebaseToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyFirebaseToken, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const slides = await listHeroSlides(false);
    res.json(slides);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const slide = await getHeroSlide(req.params.id);
    res.json(slide);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const slide = await createHeroSlide(req.body);
    res.status(201).json(slide);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const slide = await updateHeroSlide(req.params.id, req.body);
    res.json(slide);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await deleteHeroSlide(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
