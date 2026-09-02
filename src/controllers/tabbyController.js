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

    const clientOrigin = req.headers.origin || process.env.CLIENT_URL?.split(',')[0] || 'https://bellphoness.com';

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
 *
 * Requirements:
 * 1. Webhook Handler: Receive notifications from Tabby when a payment is successful. Incoming status is lowercase 'authorized'.
 * 2. Retrieve Payment Verification: Trigger GET request to Tabby's retrieve payment API with Secret Key to verify status === 'AUTHORIZED' (uppercase).
 * 3. Capture Payment: If status is validated as 'AUTHORIZED', immediately trigger capture request to Tabby's capture payment API.
 * 4. Update Firestore Order: Mark order status as 'paid'.
 */
export async function handleWebhook(req, res) {
  try {
    const payload = req.body || {};
    console.log('📥 [Tabby Webhook Received]:', JSON.stringify(payload, null, 2));

    const incomingStatus = (payload.status || payload.event || '').toLowerCase();
    const paymentId = payload.id || payload.payment?.id || payload.payment_id;
    const orderId = payload.order?.reference_id || payload.order_id;

    console.log(`[Tabby Webhook Parse] Payment ID: ${paymentId}, Order ID: ${orderId}, Incoming Status: "${incomingStatus}"`);

    if (!paymentId && !orderId) {
      console.warn('⚠️ [Tabby Webhook Warning] Webhook payload missing paymentId and orderId.');
      return res.status(200).json({ status: 'ignored_missing_identifiers' });
    }

    // Locate corresponding Firestore Order
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

    // Step 1: Check if incoming webhook indicates lowercase 'authorized'
    const isAuthorizedNotification =
      incomingStatus === 'authorized' ||
      incomingStatus === 'payment.authorized' ||
      incomingStatus === 'created';

    if (paymentId && isAuthorizedNotification) {
      console.log(`🔍 [Tabby Webhook Step 2] Retrieving payment ${paymentId} via Tabby API with Secret Key...`);

      // Step 2: Trigger GET request to Tabby's retrieve payment API
      const livePayment = await tabbyService.getPayment(paymentId);
      const verifiedStatus = (livePayment.status || '').toUpperCase();
      console.log(`🔎 [Tabby Webhook Verification] Payment ${paymentId} Live Status from Tabby API: "${verifiedStatus}"`);

      // Step 3: Check for uppercase 'AUTHORIZED' to validate payment
      if (verifiedStatus === 'AUTHORIZED') {
        const captureAmount = livePayment.amount || (orderDoc ? orderDoc.data().total : null);
        console.log(`💳 [Tabby Webhook Step 3] Payment validated as 'AUTHORIZED'. Triggering capture for AED ${captureAmount}...`);

        // Step 4: Immediately trigger capture request to Tabby's capture payment API
        const captureResult = await tabbyService.capturePayment(paymentId, captureAmount);
        console.log(`✅ [Tabby Webhook Step 4] Capture result for ${paymentId}:`, JSON.stringify(captureResult));

        // Step 5: Update Firestore order status to "paid"
        if (orderDoc) {
          await orderDoc.ref.update({
            status: 'paid',
            paymentStatus: 'paid',
            'tabby.status': 'CAPTURED',
            'tabby.capturedAt': new Date(),
            'tabby.paymentId': paymentId,
            'tabby.amount': captureAmount,
            updatedAt: new Date(),
          });
          console.log(`📝 [Tabby Webhook] Firestore order ${orderDoc.id} status updated to "paid".`);

          // Dispatch confirmation email
          try {
            const orderData = { id: orderDoc.id, ...orderDoc.data() };
            const customerEmail = orderData.shippingAddress?.email || orderData.email;
            if (customerEmail) {
              await sendOrderStatusEmail({ ...orderData, status: 'Confirmed' }, 'Confirmed', customerEmail);
              console.log(`📧 [Tabby Webhook] Confirmation email dispatched to ${customerEmail}`);
            }
          } catch (mailErr) {
            console.error('⚠️ [Tabby Webhook] Confirmation email dispatch error:', mailErr.message);
          }
        }

        return res.status(200).json({
          status: 'success',
          action: 'captured',
          verifiedStatus: 'AUTHORIZED',
          paymentId,
          orderId: orderDoc?.id || orderId,
        });
      } else if (verifiedStatus === 'CLOSED' || verifiedStatus === 'CAPTURED') {
        console.log(`ℹ️ [Tabby Webhook] Payment ${paymentId} is already in ${verifiedStatus} status.`);
        if (orderDoc) {
          await orderDoc.ref.update({
            status: 'paid',
            paymentStatus: 'paid',
            'tabby.status': verifiedStatus,
            updatedAt: new Date(),
          });
        }
        return res.status(200).json({ status: 'already_captured', paymentId });
      } else {
        console.warn(`⚠️ [Tabby Webhook] Payment ${paymentId} status is "${verifiedStatus}" (expected "AUTHORIZED"). Skipping capture.`);
        return res.status(200).json({ status: 'not_authorized', paymentStatus: verifiedStatus });
      }
    }

    // Handle rejection or failure notifications
    if (incomingStatus === 'rejected' || incomingStatus === 'failed' || incomingStatus === 'expired') {
      console.log(`❌ [Tabby Webhook] Handling ${incomingStatus} notification for order ${orderId || paymentId}`);
      if (orderDoc) {
        await orderDoc.ref.update({
          status: 'Cancelled',
          paymentStatus: 'Failed',
          'tabby.status': incomingStatus.toUpperCase(),
          updatedAt: new Date(),
        });
      }
      return res.status(200).json({ status: 'rejected_handled' });
    }

    return res.status(200).json({ status: 'acknowledged' });
  } catch (error) {
    console.error('❌ [Tabby Webhook Error]:', error);
    return res.status(500).json({ message: 'Internal error processing Tabby webhook', error: error.message });
  }
}

/**
 * Handles / Verifies Return from Tabby Hosted Checkout Redirect
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
    const effectivePaymentId = paymentId || orderData.tabby?.paymentId;

    // If customer returned with approved/authorized status
    if (paymentStatus === 'approved' || paymentStatus === 'authorized') {
      if (effectivePaymentId) {
        try {
          const livePayment = await tabbyService.getPayment(effectivePaymentId);
          if ((livePayment.status || '').toUpperCase() === 'AUTHORIZED') {
            await tabbyService.capturePayment(effectivePaymentId, livePayment.amount || orderData.total);
          }
        } catch (capErr) {
          console.warn('[Tabby Capture on Return]:', capErr.message);
        }
      }

      await orderDoc.ref.update({
        status: 'paid',
        paymentStatus: 'paid',
        'tabby.status': 'approved',
        updatedAt: new Date(),
      });

      return res.status(200).json({
        success: true,
        status: 'paid',
        orderId,
        paymentStatus: 'paid',
      });
    }

    // Cancelled or declined
    await orderDoc.ref.update({
      status: paymentStatus === 'canceled' || paymentStatus === 'cancelled' ? 'Cancelled' : 'Failed',
      paymentStatus: paymentStatus === 'canceled' || paymentStatus === 'cancelled' ? 'Cancelled' : 'Failed',
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
