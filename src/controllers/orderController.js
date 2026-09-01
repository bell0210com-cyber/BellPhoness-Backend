import * as orders from '../services/orderService.js';
export const create = async (req, res, next) => { try { res.status(201).json(await orders.createOrder(req.user.uid, req.body)); } catch (error) { next(error); } };
export const listOwn = async (req, res, next) => { try { res.json(await orders.listOrders(req.user.uid)); } catch (error) { next(error); } };
export const getOwn = async (req, res, next) => { try { res.json(await orders.readOrder(req.params.id, req.user.uid, false)); } catch (error) { next(error); } };
export const listAdmin = async (req, res, next) => { try { res.json(await orders.listAllOrders({ limit: req.query.limit })); } catch (error) { next(error); } };
export const getAdmin = async (req, res, next) => { try { res.json(await orders.readOrder(req.params.id, req.user.uid, true)); } catch (error) { next(error); } };
export const updateAdmin = async (req, res, next) => { try { res.json(await orders.updateOrder(req.params.id, req.body)); } catch (error) { next(error); } };
