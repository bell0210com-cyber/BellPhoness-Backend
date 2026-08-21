import { db } from '../config/firebaseAdmin.js';
import { readProduct } from './productService.js';

const orders = () => db().collection('orders');

const FREE_SHIPPING_THRESHOLD = 2000;
const STANDARD_SHIPPING_FEE = 35;

function calculateShipping(emirate, subtotal) {
  if (subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  return STANDARD_SHIPPING_FEE;
}

function isDubai(emirate) {
  return (emirate || '').trim().toLowerCase() === 'dubai';
}

export async function createOrder(userId, input) {
  if (!Array.isArray(input.items) || !input.items.length)
    throw Object.assign(new Error('Order must include items.'), { status: 400 });

  const items = await Promise.all(
    input.items.map(async ({ productId, variantId, quantity }) => {
      const product = await readProduct(productId, true);
      const variant = product.variants.find((entry) => entry.id === variantId);

      if (!variant || variant.stock < quantity || quantity < 1)
        throw Object.assign(new Error('One or more items are unavailable.'), { status: 400 });

      const unitPrice = variant.salePrice ?? variant.price;

      return {
        productId,
        variantId,
        name: product.name,
        sku: variant.sku,
        quantity: Number(quantity),
        unitPrice,
        lineTotal: unitPrice * Number(quantity)
      };
    })
  );

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

  const emirate = input.shippingAddress?.emirate || '';
  const shipping = calculateShipping(emirate, subtotal);
  const dubaiOrder = isDubai(emirate);

  const ref = await orders().add({
    userId,
    items,
    shippingAddress: input.shippingAddress || null,
    subtotal,
    shipping,
    discount: 0,
    total: subtotal + shipping,
    // Dubai orders can pay on delivery; orders outside Dubai require
    // prepayment. Until the payment gateway is live, these are flagged
    // for the admin to follow up on manually.
    paymentMethod: dubaiOrder ? 'Cash on Delivery' : 'Prepayment Required',
    paymentStatus: dubaiOrder ? 'Pending' : 'Awaiting Prepayment',
    status: 'Pending',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return { id: ref.id, ...(await ref.get()).data() };
}

export async function listOrders(userId) {
  const snapshot = await orders().where('userId', '==', userId).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function readOrder(id, userId, isAdmin) {
  const snap = await orders().doc(id).get();
  if (!snap.exists) throw Object.assign(new Error('Order not found.'), { status: 404 });
  if (!isAdmin && snap.data().userId !== userId)
    throw Object.assign(new Error('Order access denied.'), { status: 403 });
  return { id: snap.id, ...snap.data() };
}

export async function listAllOrders() {
  const snapshot = await orders().get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function updateOrder(id, input) {
  const allowed = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
  if (!allowed.includes(input.status))
    throw Object.assign(new Error('Invalid order status.'), { status: 400 });
  await orders().doc(id).update({ status: input.status, updatedAt: new Date() });
  return readOrder(id, null, true);
}
