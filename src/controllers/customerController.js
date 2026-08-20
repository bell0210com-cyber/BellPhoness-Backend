import * as customers from '../services/customerService.js';

export const adminList = async (req, res, next) => {
  try {
    res.json(await customers.listCustomers());
  } catch (error) {
    next(error);
  }
};

export const adminGet = async (req, res, next) => {
  try {
    res.json(await customers.readCustomer(req.params.id));
  } catch (error) {
    next(error);
  }
};