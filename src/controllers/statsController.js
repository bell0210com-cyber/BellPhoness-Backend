import * as stats from '../services/statsService.js';

export const getStats = async (req, res, next) => {
  try {
    const data = await stats.getDashboardStats();
    res.json(data);
  } catch (error) {
    next(error);
  }
};
