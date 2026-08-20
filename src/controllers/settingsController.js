import * as settings from '../services/settingsService.js';

export const get = async (req, res, next) => {
  try {
    res.json(await settings.readSettings());
  } catch (error) {
    next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    res.json(await settings.updateSettings(req.body));
  } catch (error) {
    next(error);
  }
};