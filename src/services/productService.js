import { db } from '../config/firebaseAdmin.js';

const products = () => db().collection('products');

// In-memory cache on backend for instant responses (<2ms)
let cachedActiveProducts = null;
let lastCacheTime = 0;
const SERVER_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export function invalidateProductCache() {
  cachedActiveProducts = null;
  lastCacheTime = 0;
}

const cleanVariant = (variant) => ({
  id: variant.id,
  sku: variant.sku,
  color: variant.color || null,
  colorHex: variant.colorHex || null,
  ram: variant.ram || null,
  storage: variant.storage || null,
  condition: variant.condition || null,
  price: Number(variant.price),
  salePrice: variant.salePrice === '' || variant.salePrice == null ? null : Number(variant.salePrice),
  stock: Number(variant.stock),
  images: Array.isArray(variant.images) ? variant.images : [],
});

export function validateProduct(input) {
  if (!input.name?.trim() || !input.brand?.trim() || !input.category?.trim()) {
    throw Object.assign(new Error('Name, brand, and category are required.'), { status: 400 });
  }
  if (!Array.isArray(input.variants) || !input.variants.length) {
    throw Object.assign(new Error('At least one product variant is required.'), { status: 400 });
  }
  const variants = input.variants.map(cleanVariant);
  const skus = new Set();
  const combinations = new Set();
  variants.forEach((variant) => {
    if (!variant.id || !variant.sku || !(variant.price > 0) || variant.stock < 0) {
      throw Object.assign(new Error('Every variant needs an ID, SKU, positive price, and non-negative stock.'), { status: 400 });
    }
    if (variant.salePrice && variant.salePrice > variant.price) {
      throw Object.assign(new Error('Sale price cannot exceed regular price.'), { status: 400 });
    }
    if (skus.has(variant.sku)) {
      throw Object.assign(new Error('Variant SKUs must be unique.'), { status: 400 });
    }
    skus.add(variant.sku);
    const key = [variant.color, variant.ram, variant.storage, variant.condition].join('|');
    if (combinations.has(key)) {
      throw Object.assign(new Error('Variant combinations must be unique.'), { status: 400 });
    }
    combinations.add(key);
  });

  return {
    name: input.name.trim(),
    brand: input.brand.trim(),
    category: input.category.trim(),
    description: input.description?.trim() || '',
    warranty: input.warranty?.trim() || '',
    images: Array.isArray(input.images) ? input.images : [],
    variants,
    processor: input.processor?.trim() || null,
    display: input.display?.trim() || null,
    camera: input.camera?.trim() || null,
    battery: input.battery?.trim() || null,
    ram: input.ram?.trim() || null,
    screenSize: input.screenSize?.trim() || null,
    os: input.os?.trim() || null,
    weight: input.weight?.trim() || null,
    specsIntro: input.specsIntro?.trim() || null,
    boxContents: Array.isArray(input.boxContents) ? input.boxContents.filter(Boolean) : [],
    is_active: Boolean(input.is_active),
    featured: Boolean(input.featured),
    bestseller: Boolean(input.bestseller),
    isNewArrival: Boolean(input.isNewArrival),
  };
}

export async function listProducts({ activeOnly = false, category, search, limit: limitCount } = {}) {
  const isDefaultActiveQuery = activeOnly && !category && !search && !limitCount;
  const now = Date.now();

  if (isDefaultActiveQuery && cachedActiveProducts && (now - lastCacheTime < SERVER_CACHE_TTL)) {
    return cachedActiveProducts;
  }

  let query = products();
  if (activeOnly) query = query.where('is_active', '==', true);
  if (category) query = query.where('category', '==', category);
  if (limitCount && Number(limitCount) > 0) query = query.limit(Number(limitCount));

  const snapshot = await query.get();
  const list = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((product) => !search || `${product.name} ${product.brand}`.toLowerCase().includes(search.toLowerCase()));

  if (isDefaultActiveQuery) {
    cachedActiveProducts = list;
    lastCacheTime = now;
  }

  return list;
}

export async function readProduct(id, activeOnly = false) {
  if (!id) throw Object.assign(new Error('Product not found.'), { status: 404 });

  // 1. Check in-memory cache first
  if (cachedActiveProducts) {
    const cached = cachedActiveProducts.find((p) =>
      p.id === id || (p.variants || []).some((v) => v.id === id || v.sku === id)
    );
    if (cached) return cached;
  }

  // 2. Direct document ID lookup
  try {
    const snapshot = await products().doc(id).get();
    if (snapshot.exists) {
      const data = snapshot.data();
      if (!activeOnly || data.is_active) {
        return { id: snapshot.id, ...data };
      }
    }
  } catch (err) {
    // If doc ID had invalid chars, proceed to search
  }

  // 3. Fallback search across active products
  try {
    let query = products();
    if (activeOnly) query = query.where('is_active', '==', true);
    const snap = await query.get();

    for (const doc of snap.docs) {
      const data = doc.data();
      if (doc.id === id) {
        return { id: doc.id, ...data };
      }
      const hasVariant = (data.variants || []).some((v) => v.id === id || v.sku === id);
      if (hasVariant) {
        return { id: doc.id, ...data };
      }
      if (typeof id === 'string' && data.name && (data.name.toLowerCase() === id.toLowerCase() || id.toLowerCase().includes(data.name.toLowerCase()))) {
        return { id: doc.id, ...data };
      }
    }
  } catch (err) {
    console.error('Error during fallback product lookup:', err);
  }

  throw Object.assign(new Error('Product not found.'), { status: 404 });
}

export async function createProduct(input) {
  invalidateProductCache();
  const data = validateProduct(input);
  const timestamp = new Date();
  const ref = await products().add({ ...data, createdAt: timestamp, updatedAt: timestamp });
  return readProduct(ref.id);
}

export async function updateProduct(id, input) {
  invalidateProductCache();
  const data = validateProduct(input);
  await products().doc(id).update({ ...data, updatedAt: new Date() });
  return readProduct(id);
}

export async function setProductStatus(id, is_active) {
  invalidateProductCache();
  await products().doc(id).update({ is_active: Boolean(is_active), updatedAt: new Date() });
  return readProduct(id);
}

export async function removeProduct(id) {
  invalidateProductCache();
  await products().doc(id).update({ is_active: false, updatedAt: new Date() });
}
