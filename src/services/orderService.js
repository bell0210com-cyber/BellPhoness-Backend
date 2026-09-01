import { db, auth } from '../config/firebaseAdmin.js';
import { readProduct } from './productService.js';
import { sendOrderStatusEmail } from './mailService.js';

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
    input.items.map(async (rawItem) => {
      const lookupId = rawItem.productId || rawItem.id || rawItem.variantId;
      const quantity = Number(rawItem.quantity) || 1;
      const product = await readProduct(lookupId, true);
      const variant = product.variants.find((entry) => entry.id === rawItem.variantId || entry.id === lookupId) || product.variants[0];

      if (!variant || variant.stock < quantity || quantity < 1)
        throw Object.assign(new Error('One or more items are unavailable.'), { status: 400 });

      const unitPrice = variant.salePrice ?? variant.price;

      return {
        productId: product.id,
        variantId: variant.id,
        name: product.name,
        sku: variant.sku,
        quantity,
        unitPrice,
        lineTotal: unitPrice * quantity
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

export async function listAllOrders({ limit: limitCount } = {}) {
  let query = orders();
  try {
    query = query.orderBy('createdAt', 'desc');
    if (limitCount && Number(limitCount) > 0) query = query.limit(Number(limitCount));
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    const snapshot = await orders().get();
    let list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    if (limitCount && Number(limitCount) > 0) list = list.slice(0, Number(limitCount));
    return list;
  }
}

export async function updateOrder(id, input) {
  const allowed = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
  if (!allowed.includes(input.status))
    throw Object.assign(new Error('Invalid order status.'), { status: 400 });
    
  await orders().doc(id).update({ status: input.status, updatedAt: new Date() });
  const updatedOrder = await readOrder(id, null, true);

  // Attempt to send email notification
  try {
    let customerEmail = updatedOrder.shippingAddress?.email || updatedOrder.email;
    
    // Fallback: try to fetch email from Firebase Auth if not in the order document
    if (!customerEmail && updatedOrder.userId) {
      const userRecord = await auth().getUser(updatedOrder.userId);
      customerEmail = userRecord.email;
    }

    if (customerEmail) {
      // We don't await this so it doesn't block the API response
      sendOrderStatusEmail(updatedOrder, customerEmail);
    }
  } catch (error) {
    console.error(`Failed to trigger email for order ${id}:`, error);
  }

  return updatedOrder;
}
