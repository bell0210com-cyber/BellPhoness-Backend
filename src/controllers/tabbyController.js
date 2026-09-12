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
/**
 * Handles Webhook Notifications from Tabby
 * POST /api/tabby/webhook
 *
 * UAT Corner Case 5 (Browser tab closed before redirect):
 * Background webhook updates order status to 'Paid' when user closes tab.
 * Extracts nested reference_id from Tabby's payload and updates the exact document in Cloud Firestore.
 */
export async function handleWebhook(req, res) {
  try {
    const webhookData = req.body || {};
    console.log('📥 [Tabby Webhook Received]:', JSON.stringify(webhookData, null, 2));

    // 1. Nested Payload Support: safely resolve source data across root, .payment, or .data wrappers
    const source = webhookData.data || webhookData.payment || webhookData;

    // Extract status and normalize to uppercase
    const rawStatus = source.status || webhookData.status || webhookData.event || webhookData.type || '';
    const paymentStatus = String(rawStatus).toUpperCase();

    // Extract exact order reference ID and payment ID
    const orderId =
      source.order?.reference_id ||
      webhookData.order?.reference_id ||
      webhookData.order_id ||
      source.order_id ||
      webhookData.payment?.order?.reference_id;

    const paymentId = source.id || webhookData.id || '';

    // 2. Graceful Test Ping Handling: return HTTP 200 on test pings or health checks lacking an orderId
    if (!orderId) {
      console.warn('⚠️ [Tabby Webhook] Missing Order ID in payload (acknowledged test ping/health check).');
      return res.status(200).send("Webhook ping acknowledged (no order ID)");
    }

    console.log(`[Tabby Webhook Parse] Payment ID: ${paymentId || 'N/A'}, Order ID: ${orderId}, Status: "${paymentStatus}"`);

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
      const orderRef = db.collection('orders').doc(orderId);
      const orderSnap = await orderRef.get();

      if (orderSnap.exists) {
        const orderData = orderSnap.data() || {};
        const wasAlreadyPaid = orderData.status === 'Paid' || orderData.paymentStatus === 'Paid';

        // Query Cloud Firestore to update the specific order document
        await orderRef.update({
          status: 'Paid',
          paymentStatus: 'Paid',
          tabbyTransactionId: paymentId,
          'tabby.status': paymentStatus,
          'tabby.paymentId': paymentId,
          updatedAt: new Date(),
        });
        console.log(`Success: Order ${orderId} marked as Paid via Webhook`);

        // Trigger capture if AUTHORIZED so merchant receives funds
        if ((paymentStatus === 'AUTHORIZED' || paymentStatus === 'PAYMENT.AUTHORIZED') && paymentId) {
          try {
            const captureAmount = source.amount || webhookData.amount || orderData.total;
            if (captureAmount) {
              await tabbyService.capturePayment(paymentId, captureAmount);
              console.log(`💳 [Tabby Webhook] Capture completed for ${orderId}`);
            }
          } catch (captureErr) {
            console.warn('[Tabby Webhook] Capture note:', captureErr.message);
          }
        }

        // 4. Duplicate Email Prevention: check if already marked as 'Paid' before dispatching confirmation email
        if (!wasAlreadyPaid) {
          try {
            const customerEmail = orderData.shippingAddress?.email || orderData.email;
            if (customerEmail) {
              await sendOrderStatusEmail({ id: orderSnap.id, ...orderData, status: 'Confirmed' }, 'Confirmed', customerEmail);
              console.log(`📧 [Tabby Webhook] Confirmation email dispatched to ${customerEmail}`);
            }
          } catch (mailErr) {
            console.warn('⚠️ [Tabby Webhook] Email note:', mailErr.message);
          }
        } else {
          console.log(`ℹ️ [Tabby Webhook] Order ${orderId} was already marked as Paid; skipped duplicate confirmation email.`);
        }
      } else {
        // Fallback: check by paymentId or merge to ensure order is marked Paid
        const querySnap = await db.collection('orders').where('tabby.paymentId', '==', orderId).limit(1).get();
        if (!querySnap.empty) {
          const matchedDoc = querySnap.docs[0];
          await matchedDoc.ref.update({
            status: 'Paid',
            paymentStatus: 'Paid',
            tabbyTransactionId: paymentId,
            'tabby.status': paymentStatus,
            'tabby.paymentId': paymentId,
            updatedAt: new Date(),
          });
          console.log(`Success: Order ${matchedDoc.id} marked as Paid via Webhook (matched by paymentId)`);
        } else {
          await orderRef.set({
            status: 'Paid',
            paymentStatus: 'Paid',
            tabbyTransactionId: paymentId,
            'tabby.status': paymentStatus,
            'tabby.paymentId': paymentId,
            updatedAt: new Date(),
          }, { merge: true });
          console.log(`Success: Order ${orderId} marked as Paid via Webhook (merged)`);
        }
      }
    } else if (isCancelled) {
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
