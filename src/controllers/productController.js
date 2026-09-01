import * as products from '../services/productService.js';
import { uploadProductImages, deleteProductImage } from '../services/storageService.js';

export const publicList = async (req, res, next) => { try { res.json(await products.listProducts({ activeOnly: true, category: req.query.category, search: req.query.search, limit: req.query.limit })); } catch (error) { next(error); } };
export const publicGet = async (req, res, next) => { try { res.json(await products.readProduct(req.params.id, true)); } catch (error) { next(error); } };
export const adminList = async (req, res, next) => { try { res.json(await products.listProducts({ category: req.query.category, search: req.query.search, limit: req.query.limit })); } catch (error) { next(error); } };
export const adminGet = async (req, res, next) => { try { res.json(await products.readProduct(req.params.id)); } catch (error) { next(error); } };
export const create = async (req, res, next) => { try { res.status(201).json(await products.createProduct(req.body)); } catch (error) { next(error); } };
export const update = async (req, res, next) => { try { res.json(await products.updateProduct(req.params.id, req.body)); } catch (error) { next(error); } };
export const status = async (req, res, next) => { try { res.json(await products.setProductStatus(req.params.id, req.body.is_active)); } catch (error) { next(error); } };
export const remove = async (req, res, next) => { try { await products.removeProduct(req.params.id); res.status(204).end(); } catch (error) { next(error); } };
export const uploadImages = async (req, res, next) => { try { if (!req.files?.length) return res.status(400).json({ message: 'Select at least one image.' }); res.status(201).json(await uploadProductImages(req.params.id, req.files, req.body.variantId)); } catch (error) { next(error); } };
export const removeImage = async (req, res, next) => { try { await deleteProductImage(req.body.path); res.status(204).end(); } catch (error) { next(error); } };
