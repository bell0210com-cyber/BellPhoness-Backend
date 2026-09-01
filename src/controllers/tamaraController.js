import { db } from '../config/firebaseAdmin.js';
import * as tamaraService from '../services/tamaraService.js';
import { readProduct } from '../services/productService.js';
import { sendOrderStatusEmail } from '../services/mailService.js';

const ordersCollection = () => db().collection('orders');

const FREE_SHIPPING_THRESHOLD = 2000;
const STANDARD_SHIPPING_FEE = 35;

function calculateShipping(emirate, subtotal) {
  if (subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  return STANDARD_SHIPPING_FEE;
}

/**
 * Initiates a Tamara Checkout Session
 */
export async function createCheckout(req, res, next) {
  try {
    const userId = req.user?.uid;
    const input = req.body;
    console.log('[Tamara createCheckout received items]:', JSON.stringify(input.items, null, 2));

    if (!Array.isArray(input.items) || !input.items.length) {
      return res.status(400).json({ message: 'Order must include items.' });
    }

    // Verify products and calculate amounts
    const items = await Promise.all(
      input.items.map(async (rawItem) => {
        const lookupId = rawItem.productId || rawItem.id || rawItem.variantId;
        const quantity = Number(rawItem.quantity) || 1;

        let product = null;
        try {
          product = await readProduct(lookupId, true);
        } catch {
          const allDocs = await db().collection('products').where('is_active', '==', true).get();
          const allActive = allDocs.docs.map((d) => ({ id: d.id, ...d.data() }));
          product = allActive.find((p) =>
            p.id === lookupId ||
            (rawItem.name && p.name?.toLowerCase() === rawItem.name?.toLowerCase()) ||
            p.variants?.some((v) => v.id === rawItem.variantId || v.sku === rawItem.sku)
          );
          if (!product && allActive.length > 0) {
            product = allActive.find((p) => rawItem.name && (p.name.includes(rawItem.name) || rawItem.name.includes(p.name))) || allActive[0];
          }
        }

        if (!product) {
          throw Object.assign(new Error(`Product "${rawItem.name || lookupId}" is unavailable.`), { status: 400 });
        }

        const variant = product.variants?.find((entry) => entry.id === rawItem.variantId || entry.id === lookupId) || product.variants?.[0] || {};
        const unitPrice = Number(rawItem.unitPrice || variant.salePrice || variant.price || 0);

        return {
          productId: product.id,
          variantId: variant.id || 'default',
          name: product.name || rawItem.name || 'Smartphone',
          sku: variant.sku || rawItem.sku || product.id,
          quantity,
          unitPrice: unitPrice > 0 ? unitPrice : Number(variant.salePrice ?? variant.price ?? 0),
          lineTotal: (unitPrice > 0 ? unitPrice : Number(variant.salePrice ?? variant.price ?? 0)) * quantity,
        };
      })
    );

    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const emirate = input.shippingAddress?.emirate || '';
    const shipping = calculateShipping(emirate, subtotal);
    const total = subtotal + shipping;

    // Create pending order record in Firestore
    const orderDocRef = await ordersCollection().add({
      userId: userId || 'guest',
      items,
      shippingAddress: input.shippingAddress || null,
      subtotal,
      shipping,
      discount: 0,
      total,
      paymentMethod: 'Tamara',
      paymentStatus: 'Pending',
      status: 'Pending',
      tamara: {
        status: 'initiated',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const orderId = orderDocRef.id;
    const orderData = { id: orderId, items, subtotal, shipping, total, shippingAddress: input.shippingAddress };

    const clientOrigin = req.headers.origin || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:5173';

    // Call Tamara Checkout API
    const session = await tamaraService.createCheckoutSession({
      order: orderData,
      user: {
        id: userId,
        email: req.user?.email || input.shippingAddress?.email,
        name: req.user?.name || input.shippingAddress?.fullName,
        phone: input.shippingAddress?.phone,
      },
      clientOrigin,
    });

    // Update order with Tamara Session Info
    await orderDocRef.update({
      'tamara.checkoutId': session.checkout_id || null,
      'tamara.orderId': session.order_id || null,
      'tamara.checkoutUrl': session.checkout_url || null,
      'tamara.status': session.status || 'created',
      updatedAt: new Date(),
    });

    return res.status(200).json({
      success: true,
      orderId,
      checkout_url: session.checkout_url,
      checkoutUrl: session.checkout_url,
      checkoutId: session.checkout_id,
      isSimulated: session.isSimulated || false,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handles Webhook Notifications from Tamara
 */
export async function handleWebhook(req, res, next) {
  try {
    // 1. Verify Webhook Signature
    if (!tamaraService.verifyWebhook(req)) {
      console.warn('[Tamara Webhook] Verification failed: Invalid notification key or signature');
      return res.status(401).json({ message: 'Unauthorized webhook request.' });
    }

    const payload = req.body || {};
    console.log('[Tamara Webhook Event Received]:', payload);

    const {
      order_id: tamaraOrderId,
      order_reference_id: orderId,
      event_type: eventType,
      data,
    } = payload;

    // Find the corresponding order in Firestore
    let orderDoc = null;
    if (orderId) {
      const snap = await ordersCollection().doc(orderId).get();
      if (snap.exists) orderDoc = snap;
    }

    if (!orderDoc && tamaraOrderId) {
      const querySnap = await ordersCollection().where('tamara.orderId', '==', tamaraOrderId).limit(1).get();
      if (!querySnap.empty) {
        orderDoc = querySnap.docs[0];
      }
    }

    if (!orderDoc) {
      console.warn(`[Tamara Webhook] Order reference not found for orderId: ${orderId} / tamaraOrderId: ${tamaraOrderId}`);
      // Return 200 to acknowledge webhook receipt so Tamara doesn't loop retries
      return res.status(200).json({ status: 'order_not_found_acknowledged' });
    }

    const currentOrder = { id: orderDoc.id, ...orderDoc.data() };
    const effectiveEvent = eventType || (data?.payment_status === 'approved' ? 'order_approved' : '');

    if (effectiveEvent === 'order_approved' || effectiveEvent === 'payment_approved') {
      // Authorise the order with Tamara
      try {
        await tamaraService.authoriseOrder(tamaraOrderId || currentOrder.tamara?.orderId);
      } catch (authErr) {
        console.error('[Tamara Authorise on Webhook Warning]:', authErr.message);
      }

      await orderDoc.ref.update({
        paymentStatus: 'Paid',
        status: 'Confirmed',
        'tamara.status': 'approved',
        'tamara.approvedAt': new Date(),
        updatedAt: new Date(),
      });

      // Send Order Confirmation Notification Email
      try {
        const customerEmail = currentOrder.shippingAddress?.email || currentOrder.email;
        if (customerEmail) {
          await sendOrderStatusEmail({ ...currentOrder, status: 'Confirmed' }, 'Confirmed', customerEmail);
        }
      } catch (mailErr) {
        console.error('[Tamara Mail Warning]:', mailErr.message);
      }
    } else if (
      effectiveEvent === 'order_declined' || 
      effectiveEvent === 'order_canceled' || 
      effectiveEvent === 'order_expired'
    ) {
      await orderDoc.ref.update({
        paymentStatus: 'Failed',
        status: 'Cancelled',
        'tamara.status': effectiveEvent,
        updatedAt: new Date(),
      });
    }

    return res.status(200).json({ status: 'success', event: effectiveEvent });
  } catch (error) {
    console.error('[Tamara Webhook Error]:', error);
    return res.status(500).json({ message: 'Internal error processing webhook' });
  }
}

/**
 * Handles / Verifies Return from Tamara Hosted Checkout
 */
export async function verifyReturn(req, res, next) {
  try {
    const { orderId, paymentStatus, tamaraOrderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: 'Missing orderId parameter.' });
    }

    const orderDoc = await ordersCollection().doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const orderData = orderDoc.data();

    // If customer was approved on Tamara portal
    if (paymentStatus === 'approved') {
      try {
        await tamaraService.authoriseOrder(tamaraOrderId || orderData.tamara?.orderId);
      } catch (authErr) {
        console.warn('[Tamara Authorise on Return]:', authErr.message);
      }

      await orderDoc.ref.update({
        paymentStatus: 'Paid',
        status: 'Confirmed',
        'tamara.status': 'approved',
        updatedAt: new Date(),
      });

      return res.status(200).json({
        success: true,
        status: 'Confirmed',
        orderId,
        paymentStatus: 'Paid',
      });
    }

    // Cancelled or declined
    await orderDoc.ref.update({
      paymentStatus: paymentStatus === 'canceled' ? 'Cancelled' : 'Failed',
      'tamara.status': paymentStatus || 'failed',
      updatedAt: new Date(),
    });

    return res.status(200).json({
      success: false,
      status: 'Failed',
      orderId,
      paymentStatus,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Fetches live order status directly from Tamara
 * GET /api/tamara/order/:id
 */
export async function getOrderStatus(req, res, next) {
  try {
    const orderId = req.params.id;
    if (!orderId) {
      return res.status(400).json({ message: 'Order ID required.' });
    }

    let tamaraOrderId = orderId;
    const snap = await ordersCollection().doc(orderId).get();
    if (snap.exists && snap.data().tamara?.orderId) {
      tamaraOrderId = snap.data().tamara.orderId;
    }

    const liveData = await tamaraService.getTamaraOrder(tamaraOrderId);
    return res.status(200).json({
      success: true,
      orderId,
      tamaraOrderId,
      tamaraOrder: liveData,
    });
  } catch (error) {
    next(error);
  }
}

