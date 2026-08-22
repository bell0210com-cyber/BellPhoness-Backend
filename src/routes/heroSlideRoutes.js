import express from 'express';
import { listHeroSlides } from '../services/heroSlideService.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const slides = await listHeroSlides(true); // activeOnly = true
    res.json(slides);
  } catch (error) {
    next(error);
  }
});

export default router;
