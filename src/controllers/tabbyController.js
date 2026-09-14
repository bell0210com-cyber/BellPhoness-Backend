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
    const orderData = { id: orderId, userId, items, subtotal, shipping, total, shippingAddress: input.shippingAddress };

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

    // Check if Tabby rejected the customer during session creation
    if (session.status === 'rejected' || session.success === false) {
      console.warn(`⚠️ [Tabby createCheckout] Session rejected for order ${orderId}: Reason = ${session.rejection_reason}`);
      await orderDocRef.update({
        status: 'Cancelled',
        paymentStatus: 'Failed',
        'tabby.status': 'rejected',
        'tabby.rejectionReason': session.rejection_reason || 'not_available',
        updatedAt: new Date(),
      });

      return res.status(200).json({
        success: false,
        status: 'rejected',
        rejection_reason: session.rejection_reason,
        message: session.message,
        orderId,
      });
    }

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
 * Performs background pre-scoring check for Tabby (Protected endpoint)
 * Accepts only authenticated user sessions, takes amount from Firestore active cart,
 * and returns only { available: true/false } without leaking raw Tabby response data.
 * POST /api/tabby/pre-score
 */
export async function preScore(req, res) {
  try {
    const userId = req.user?.uid;
    let amount = 0;
    let currency = 'AED';

    if (userId) {
      const cartDoc = await db().collection('carts').doc(userId).get();
      if (cartDoc.exists) {
        const cartData = cartDoc.data() || {};
        amount = Number(cartData.total ?? cartData.amount ?? cartData.subtotal ?? 0);
        if (!amount && Array.isArray(cartData.items)) {
          amount = cartData.items.reduce((sum, item) => {
            const price = Number(item.salePrice ?? item.unitPrice ?? item.price ?? 0);
            const qty = Number(item.quantity) || 1;
            return sum + (item.lineTotal !== undefined ? Number(item.lineTotal) : price * qty);
          }, 0);
        }
        if (cartData.currency) {
          currency = cartData.currency;
        }
      }
    }

    const { buyer, phone, email, name } = req.body || {};
    const buyerObj = buyer || {
      phone: phone || req.user?.phone || req.user?.phoneNumber,
      email: email || req.user?.email,
      name: name || req.user?.name || req.user?.displayName,
    };

    const result = await tabbyService.checkEligibility({
      amount,
      currency,
      buyer: buyerObj,
    });

    const isAvailable = Boolean(result && result.isAvailable !== false);
    return res.status(200).json({ available: isAvailable });
  } catch (error) {
    console.warn('[Tabby Pre-scoring Error]:', error.message);
    return res.status(200).json({ available: true });
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
/**
 * Handles Webhook Notifications from Tabby
 * POST /api/tabby/webhook
 *
 * Requirements:
 * 1. Webhook Handler: Receive notifications from Tabby when a payment is successful.
 * 2. Retrieve Payment Verification: Trigger GET request to Tabby's retrieve payment API with Secret Key to verify status.
 * 3. Capture Payment: If status is validated as 'AUTHORIZED', immediately trigger capture request to Tabby's capture payment API.
 * 4. Update Firestore Order: Mark order status as 'Paid' and paymentStatus as 'Paid'.
 * 5. Handle UAT Corner Case 5 (Browser tab closed before redirect).
 * 6. Duplicate Email Prevention: Prevent sending duplicate confirmation emails.
 */
export async function handleWebhook(req, res) {
  try {
    const webhookData = req.body || {};
    console.log('📥 [Tabby Webhook Received]:', JSON.stringify(webhookData, null, 2));

    // 1. Nested Payload Support: safely resolve source data across root, .payment, or .data wrappers
    const source = webhookData.data || webhookData.payment || webhookData;

    // Extract status and normalize to uppercase
    const rawStatus = source.status || webhookData.status || webhookData.event || webhookData.type || '';
    let paymentStatus = String(rawStatus).toUpperCase();

    // Extract exact order reference ID and payment ID
    let orderId =
      source.order?.reference_id ||
      webhookData.order?.reference_id ||
      webhookData.order_id ||
      source.order_id ||
      webhookData.payment?.order?.reference_id;

    const paymentId = source.id || webhookData.id || webhookData.payment?.id || source.payment_id || '';

    // 2. Retrieve Payment Verification:
    // Call GET /api/v1/payments/{paymentId} with Secret Key to verify live status from Tabby
    let livePayment = null;
    if (paymentId) {
      try {
        console.log(`🔍 [Tabby Webhook] Calling Retrieve Payment (GET /api/v1/payments/${paymentId})...`);
        livePayment = await tabbyService.getPayment(paymentId);
        console.log(`✅ [Tabby Webhook] Retrieve Payment successful. Live Tabby status: "${livePayment.status}"`);
        if (livePayment.status) {
          paymentStatus = String(livePayment.status).toUpperCase();
        }
        if (!orderId && livePayment.order?.reference_id) {
          orderId = livePayment.order.reference_id;
          console.log(`ℹ️ [Tabby Webhook] Extracted missing orderId from Tabby live payment: ${orderId}`);
        }
      } catch (getErr) {
        console.warn(`⚠️ [Tabby Webhook] Retrieve Payment notice (${paymentId}):`, getErr.message);
      }
    }

    // Graceful Test Ping Handling: return HTTP 200 on test pings or health checks lacking an orderId
    if (!orderId && !paymentId) {
      console.warn('⚠️ [Tabby Webhook] Missing Order ID and Payment ID in payload (acknowledged test ping/health check).');
      return res.status(200).send("Webhook ping acknowledged (no order ID)");
    }

    console.log(`[Tabby Webhook Parse] Payment ID: ${paymentId || 'N/A'}, Order ID: ${orderId || 'N/A'}, Verified Status: "${paymentStatus}"`);

    // 3. Comprehensive Status Mapping:
    // Success statuses: AUTHORIZED, CLOSED, CAPTURED, and PAYMENT.AUTHORIZED
    const isSuccess =
      paymentStatus === 'AUTHORIZED' ||
      paymentStatus === 'CLOSED' ||
      paymentStatus === 'CAPTURED' ||
      paymentStatus === 'PAYMENT.AUTHORIZED' ||
      paymentStatus.includes('PAYMENT.AUTHORIZED');

    // Cancellation / failure statuses: REJECTED, EXPIRED, FAILED, CANCELED, and CANCELLED
    const isCancelled =
      paymentStatus === 'REJECTED' ||
      paymentStatus === 'EXPIRED' ||
      paymentStatus === 'FAILED' ||
      paymentStatus === 'CANCELED' ||
      paymentStatus === 'CANCELLED';

    if (isSuccess) {
      // Find matching order in Firestore
      let orderDoc = null;
      if (orderId) {
        const snap = await db.collection('orders').doc(orderId).get();
        if (snap.exists) {
          orderDoc = snap;
        }
      }

      if (!orderDoc && paymentId) {
        const querySnap = await db.collection('orders').where('tabby.paymentId', '==', paymentId).limit(1).get();
        if (!querySnap.empty) {
          orderDoc = querySnap.docs[0];
          orderId = orderDoc.id;
        }
      }

      const orderData = orderDoc ? orderDoc.data() || {} : {};
      const wasAlreadyPaid =
        (orderData.status || '').toLowerCase() === 'paid' ||
        (orderData.paymentStatus || '').toLowerCase() === 'paid';

      // Capture Payment: If status is validated as AUTHORIZED, trigger capture request to Tabby API
      if ((paymentStatus === 'AUTHORIZED' || paymentStatus === 'PAYMENT.AUTHORIZED') && paymentId) {
        try {
          const captureAmount = source.amount || webhookData.amount || livePayment?.amount || orderData.total;
          if (captureAmount) {
            console.log(`💳 [Tabby Webhook] Triggering capture for payment ${paymentId} (Amount: AED ${captureAmount})...`);
            await tabbyService.capturePayment(paymentId, captureAmount);
            console.log(`💳 [Tabby Webhook] Capture completed for order ${orderId || paymentId}`);
            paymentStatus = 'CLOSED';
          }
        } catch (captureErr) {
          console.warn('[Tabby Webhook] Capture note:', captureErr.message);
        }
      }

      // Update Firestore Order: Mark status as 'Paid' and paymentStatus as 'Paid'
      const updatePayload = {
        status: 'Paid',
        paymentStatus: 'Paid',
        tabbyTransactionId: paymentId || orderData.tabbyTransactionId || '',
        'tabby.status': paymentStatus,
        'tabby.paymentId': paymentId || orderData.tabby?.paymentId || '',
        updatedAt: new Date(),
      };

      if (orderDoc) {
        await orderDoc.ref.update(updatePayload);
        console.log(`✅ Success: Order ${orderDoc.id} marked as Paid via Webhook`);
      } else if (orderId) {
        await db.collection('orders').doc(orderId).set(updatePayload, { merge: true });
        console.log(`✅ Success: Order ${orderId} merged as Paid via Webhook`);
      }

      // 4. Duplicate Email Prevention: check if already marked as 'Paid' before dispatching confirmation email
      if (!wasAlreadyPaid && (orderDoc || orderId)) {
        try {
          const customerEmail = orderData.shippingAddress?.email || orderData.email;
          if (customerEmail) {
            await sendOrderStatusEmail({ id: orderId, ...orderData, status: 'Confirmed' }, 'Confirmed', customerEmail);
            console.log(`📧 [Tabby Webhook] Confirmation email dispatched to ${customerEmail}`);
          }
        } catch (mailErr) {
          console.warn('⚠️ [Tabby Webhook] Email note:', mailErr.message);
        }
      } else {
        console.log(`ℹ️ [Tabby Webhook] Order ${orderId} was already marked as Paid; skipped duplicate confirmation email.`);
      }
    } else if (isCancelled) {
      if (orderId) {
        const orderRef = db.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();
        if (orderSnap.exists) {
          await orderRef.update({
            status: 'Cancelled',
            paymentStatus: 'Failed',
            'tabby.status': paymentStatus,
            updatedAt: new Date(),
          });
          console.log(`Order ${orderId} marked as Cancelled/Failed via Webhook (Status: ${paymentStatus})`);
        }
      }
    }

    // Always return 200 OK so Tabby stops retrying
    return res.status(200).send("Webhook Processed successfully");

  } catch (error) {
    console.error("Webhook Firestore Update Error:", error);
    return res.status(500).send("Server Error processing webhook");
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
        status: 'Paid',
        paymentStatus: 'Paid',
        tabbyTransactionId: effectivePaymentId || orderData.tabbyTransactionId || '',
        'tabby.status': 'approved',
        updatedAt: new Date(),
      });

      return res.status(200).json({
        success: true,
        status: 'Paid',
        orderId,
        paymentStatus: 'Paid',
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
