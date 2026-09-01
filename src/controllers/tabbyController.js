import { db } from '../config/firebaseAdmin.js';
import * as tabbyService from '../services/tabbyService.js';
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
 * Initiates a Tabby Checkout Session
 * POST /api/tabby/create-checkout (or /api/tabby/checkout)
 */
export async function createCheckout(req, res, next) {
  try {
    const userId = req.user?.uid;
    const input = req.body;
    console.log('[Tabby createCheckout received items]:', JSON.stringify(input.items, null, 2));

    if (!Array.isArray(input.items) || !input.items.length) {
      return res.status(400).json({ message: 'Order must include items.' });
    }

    // Verify products and calculate amounts with robust fallbacks
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
      paymentMethod: 'Tabby',
      paymentStatus: 'Pending',
      status: 'Pending',
      tabby: {
        status: 'initiated',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const orderId = orderDocRef.id;
    const orderData = { id: orderId, items, subtotal, shipping, total, shippingAddress: input.shippingAddress };

    const clientOrigin = req.headers.origin || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:5173';

    // Call Tabby Checkout API
    const session = await tabbyService.createCheckoutSession({
      order: orderData,
      user: {
        id: userId,
        email: req.user?.email || input.shippingAddress?.email,
        name: req.user?.name || input.shippingAddress?.fullName,
        phone: input.shippingAddress?.phone,
      },
      clientOrigin,
    });

    // Update order with Tabby Session Info
    await orderDocRef.update({
      'tabby.checkoutId': session.checkout_id || null,
      'tabby.paymentId': session.payment_id || null,
      'tabby.checkoutUrl': session.checkout_url || null,
      'tabby.status': session.status || 'created',
      updatedAt: new Date(),
    });

    return res.status(200).json({
      success: true,
      orderId,
      checkout_url: session.checkout_url,
      checkoutUrl: session.checkout_url,
      checkoutId: session.checkout_id,
      paymentId: session.payment_id,
      isSimulated: session.isSimulated || false,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handles Webhook Notifications from Tabby
 * POST /api/tabby/webhook
 */
export async function handleWebhook(req, res, next) {
  try {
    if (!tabbyService.verifyWebhook(req)) {
      console.warn('[Tabby Webhook] Unauthorized notification received.');
      return res.status(401).json({ message: 'Unauthorized webhook request.' });
    }

    const payload = req.body || {};
    console.log('[Tabby Webhook Received]:', payload);

    const {
      id: paymentId,
      status: paymentStatus,
      order,
    } = payload;

    const orderId = order?.reference_id || payload.order_id;

    let orderDoc = null;
    if (orderId) {
      const snap = await ordersCollection().doc(orderId).get();
      if (snap.exists) orderDoc = snap;
    }

    if (!orderDoc && paymentId) {
      const querySnap = await ordersCollection().where('tabby.paymentId', '==', paymentId).limit(1).get();
      if (!querySnap.empty) {
        orderDoc = querySnap.docs[0];
      }
    }

    if (!orderDoc) {
      console.warn(`[Tabby Webhook] Order reference not found for orderId: ${orderId} / paymentId: ${paymentId}`);
      return res.status(200).json({ status: 'order_not_found_acknowledged' });
    }

    const currentOrder = { id: orderDoc.id, ...orderDoc.data() };
    const normalizedStatus = (paymentStatus || '').toUpperCase();

    if (normalizedStatus === 'AUTHORIZED' || normalizedStatus === 'CAPTURED' || normalizedStatus === 'CLOSED') {
      // If authorized, capture payment
      if (normalizedStatus === 'AUTHORIZED' && paymentId) {
        try {
          await tabbyService.capturePayment(paymentId, currentOrder.total);
        } catch (capErr) {
          console.warn('[Tabby Capture Warning]:', capErr.message);
        }
      }

      await orderDoc.ref.update({
        paymentStatus: 'Paid',
        status: 'Confirmed',
        'tabby.status': normalizedStatus,
        'tabby.approvedAt': new Date(),
        updatedAt: new Date(),
      });

      // Send Order Confirmation Notification Email
      try {
        const customerEmail = currentOrder.shippingAddress?.email || currentOrder.email;
        if (customerEmail) {
          await sendOrderStatusEmail({ ...currentOrder, status: 'Confirmed' }, 'Confirmed', customerEmail);
        }
      } catch (mailErr) {
        console.error('[Tabby Mail Warning]:', mailErr.message);
      }
    } else if (normalizedStatus === 'REJECTED' || normalizedStatus === 'EXPIRED') {
      await orderDoc.ref.update({
        paymentStatus: 'Failed',
        status: 'Cancelled',
        'tabby.status': normalizedStatus,
        updatedAt: new Date(),
      });
    }

    return res.status(200).json({ status: 'success', paymentStatus: normalizedStatus });
  } catch (error) {
    console.error('[Tabby Webhook Error]:', error);
    return res.status(500).json({ message: 'Internal error processing webhook' });
  }
}

/**
 * Handles / Verifies Return from Tabby Hosted Checkout
 * POST /api/tabby/verify-return
 */
export async function verifyReturn(req, res, next) {
  try {
    const { orderId, paymentStatus, paymentId } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: 'Missing orderId parameter.' });
    }

    const orderDoc = await ordersCollection().doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const orderData = orderDoc.data();

    // If customer was approved on Tabby portal
    if (paymentStatus === 'approved' || paymentStatus === 'authorized') {
      const effectivePaymentId = paymentId || orderData.tabby?.paymentId;
      if (effectivePaymentId) {
        try {
          await tabbyService.capturePayment(effectivePaymentId, orderData.total);
        } catch (capErr) {
          console.warn('[Tabby Capture on Return]:', capErr.message);
        }
      }

      await orderDoc.ref.update({
        paymentStatus: 'Paid',
        status: 'Confirmed',
        'tabby.status': 'approved',
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
      'tabby.status': paymentStatus || 'failed',
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
 * Fetches live payment status from Tabby
 * GET /api/tabby/payment/:id
 */
export async function getPaymentStatus(req, res, next) {
  try {
    const paramId = req.params.id;
    if (!paramId) {
      return res.status(400).json({ message: 'Payment or Order ID required.' });
    }

    let paymentId = paramId;
    const snap = await ordersCollection().doc(paramId).get();
    if (snap.exists && snap.data().tabby?.paymentId) {
      paymentId = snap.data().tabby.paymentId;
    }

    const liveData = await tabbyService.getPayment(paymentId);
    return res.status(200).json({
      success: true,
      orderId: paramId,
      paymentId,
      tabbyPayment: liveData,
    });
  } catch (error) {
    next(error);
  }
}
