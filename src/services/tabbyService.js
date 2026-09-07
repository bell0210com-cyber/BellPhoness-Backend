import { tabbyConfig, isTabbyConfigured } from '../config/tabby.js';
import { db, auth, isFirebaseReady } from '../config/firebaseAdmin.js';

/**
 * Formats a phone number for UAE / Tabby compatibility (+971...)
 */
function formatPhoneNumber(phone) {
  if (!phone) return '+971501234567';
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.slice(2);
    } else if (cleaned.startsWith('971')) {
      cleaned = '+' + cleaned;
    } else if (cleaned.startsWith('0')) {
      cleaned = '+971' + cleaned.slice(1);
    } else {
      cleaned = '+971' + cleaned;
    }
  }
  return cleaned;
}

function toDateTimestamp(val) {
  if (!val) return 0;
  if (typeof val.toDate === 'function') {
    return val.toDate().getTime();
  }
  if (val instanceof Date) {
    return val.getTime();
  }
  if (val._seconds) {
    return val._seconds * 1000;
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

function toIsoDate(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') {
    return val.toDate().toISOString();
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (val._seconds) {
    return new Date(val._seconds * 1000).toISOString();
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

const COMPLETED_STATUSES = new Set(['delivered', 'completed', 'shipped', 'confirmed', 'packed', 'paid']);
const COMPLETED_PAYMENT_STATUSES = new Set(['paid', 'captured', 'completed', 'authorized']);

function isOrderCompleted(o) {
  const st = (o.status || '').toLowerCase();
  const paySt = (o.paymentStatus || o.tabby?.status || o.tamara?.status || '').toLowerCase();
  if (st === 'cancelled' || st === 'canceled' || paySt === 'failed' || paySt === 'rejected') {
    return false;
  }
  return COMPLETED_STATUSES.has(st) || COMPLETED_PAYMENT_STATUSES.has(paySt);
}

/**
 * Creates a Tabby checkout session for an order
 * Uses SECRET_KEY for backend session creation and strictly HTTPS for all merchant_urls
 */
export async function createCheckoutSession({ order, user, clientOrigin }) {
  if (!isTabbyConfigured()) {
    console.warn('[Tabby] Keys are not configured. Returning development placeholder session.');
    return {
      checkout_id: `tabby_dev_${order.id}`,
      checkout_url: `https://bellphoness.com/checkout/tabby/callback?paymentStatus=approved&orderId=${order.id}&simulated=true`,
      payment_id: `tabby_payment_${order.id}`,
      status: 'created',
      isSimulated: true,
    };
  }

  const shippingAddr = order.shippingAddress || {};
  const customerName = shippingAddr.fullName || user?.name || 'Bell Customer';
  const customerPhone = formatPhoneNumber(shippingAddr.phone || user?.phone);
  const customerEmail = shippingAddr.email || user?.email || 'customer@bellphoness.com';

  const formattedItems = (order.items || []).map((item) => ({
    title: item.name || 'Smartphone',
    description: item.sku || item.name || 'Bell Phones Item',
    quantity: Number(item.quantity) || 1,
    unit_price: Number(item.unitPrice).toFixed(2),
    discount_amount: '0.00',
    reference_id: item.variantId || item.productId || item.sku || 'SKU',
    category: 'Smartphones',
  }));

  // Fetch past orders and user creation details from Firestore & Firebase Auth
  const userId = user?.id || user?.uid || order?.userId;
  let userOrders = [];
  let registeredSince = null;

  if (isFirebaseReady() && userId && userId !== 'guest') {
    // 1. Fetch user creation date from Firebase Auth
    try {
      const userRecord = await auth().getUser(userId).catch(() => null);
      if (userRecord?.metadata?.creationTime) {
        registeredSince = new Date(userRecord.metadata.creationTime).toISOString();
      }
    } catch (authErr) {
      console.warn('[Tabby] Could not fetch user from Firebase Auth:', authErr.message);
    }

    // 2. Query Firestore orders collection for this user
    try {
      const snapshot = await db()
        .collection('orders')
        .where('userId', '==', userId)
        .get();
      userOrders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (dbErr) {
      console.warn('[Tabby] Could not query user orders from Firestore:', dbErr.message);
    }
  }

  // Fallback: search by customer email if no orders found by userId
  if (isFirebaseReady() && userOrders.length === 0 && customerEmail && customerEmail !== 'customer@bellphoness.com') {
    try {
      const emailSnapshot = await db()
        .collection('orders')
        .where('shippingAddress.email', '==', customerEmail)
        .get();
      userOrders = emailSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch {
      // Ignore fallback lookup error
    }
  }

  // Exclude current order
  const currentOrderId = order?.id;
  const pastOrders = userOrders.filter((o) => o.id !== currentOrderId);

  // Sort past orders descending by creation date (most recent first)
  pastOrders.sort((a, b) => {
    const timeA = toDateTimestamp(a.createdAt);
    const timeB = toDateTimestamp(b.createdAt);
    return timeB - timeA;
  });

  // buyer_history.registered_since:
  // If not available from Firebase Auth, use date of their first order. Fallback to current time.
  if (!registeredSince) {
    if (userOrders.length > 0) {
      const allOrdersSortedAsc = [...userOrders].sort((a, b) => {
        const timeA = toDateTimestamp(a.createdAt);
        const timeB = toDateTimestamp(b.createdAt);
        return timeA - timeB;
      });
      registeredSince = toIsoDate(allOrdersSortedAsc[0]?.createdAt);
    }
    if (!registeredSince) {
      registeredSince = new Date().toISOString();
    }
  }

  // buyer_history.loyalty_level:
  // Count all successfully completed orders by this user in Firestore (any payment method)
  const completedOrdersCount = pastOrders.filter(isOrderCompleted).length;
  const loyaltyLevel = Number.isInteger(completedOrdersCount) ? completedOrdersCount : 0;

  // order_history:
  // Fetch last 5-10 orders for this user from Firestore (any payment method, any status, exclude current order).
  // Include order details (amount, date, status).
  const orderHistory = pastOrders.slice(0, 10).map((o) => {
    const purchasedAt = toIsoDate(o.createdAt) || new Date().toISOString();
    let statusStr = (o.status || o.paymentStatus || 'complete').toLowerCase();
    if (['delivered', 'paid', 'completed', 'captured'].includes(statusStr)) {
      statusStr = 'complete';
    } else if (['cancelled', 'canceled'].includes(statusStr)) {
      statusStr = 'canceled';
    } else if (['refunded'].includes(statusStr)) {
      statusStr = 'refunded';
    } else {
      statusStr = 'processing';
    }

    const historyItem = {
      purchased_at: purchasedAt,
      amount: Number(o.total || o.subtotal || 0).toFixed(2),
      payment_method: o.paymentMethod || 'card',
      status: statusStr,
    };

    if (Array.isArray(o.items) && o.items.length) {
      historyItem.items = o.items.map((it) => ({
        title: it.name || 'Smartphone / Item',
        quantity: Number(it.quantity) || 1,
        unit_price: Number(it.unitPrice || 0).toFixed(2),
        reference_id: it.variantId || it.productId || it.sku || 'SKU',
      }));
    }

    if (o.shippingAddress) {
      historyItem.shipping_address = {
        city: o.shippingAddress.city || o.shippingAddress.emirate || 'Dubai',
        address: [o.shippingAddress.building, o.shippingAddress.street, o.shippingAddress.area].filter(Boolean).join(', ') || 'Sheikh Zayed Road, Dubai',
        zip: o.shippingAddress.postalCode || '00000',
      };
      historyItem.buyer = {
        phone: formatPhoneNumber(o.shippingAddress.phone),
        email: o.shippingAddress.email || customerEmail,
        name: o.shippingAddress.fullName || customerName,
      };
    }

    return historyItem;
  });

  // Ensure base domain strictly uses https://
  let baseDomain = 'https://bellphoness.com';
  if (clientOrigin && !clientOrigin.includes('localhost')) {
    baseDomain = clientOrigin.startsWith('http://')
      ? clientOrigin.replace(/^http:\/\//i, 'https://')
      : clientOrigin.startsWith('https://')
      ? clientOrigin
      : `https://${clientOrigin}`;
  }

  const payload = {
    payment: {
      amount: Number(order.total).toFixed(2),
      currency: 'AED',
      description: `Bell Phones Order #${order.id}`,
      buyer: {
        phone: customerPhone,
        email: customerEmail,
        name: customerName,
      },
      shipping_address: {
        city: shippingAddr.city || shippingAddr.emirate || 'Dubai',
        address: [shippingAddr.building, shippingAddr.street, shippingAddr.area].filter(Boolean).join(', ') || 'Sheikh Zayed Road, Downtown Dubai',
        zip: shippingAddr.postalCode || '00000',
      },
      order: {
        tax_amount: '0.00',
        shipping_amount: Number(order.shipping || 0).toFixed(2),
        discount_amount: '0.00',
        reference_id: order.id,
        items: formattedItems,
      },
      buyer_history: {
        registered_since: registeredSince,
        loyalty_level: loyaltyLevel,
        wishlist_count: 0,
        is_social_networks_connected: false,
        is_phone_number_verified: true,
        is_email_verified: true,
      },
      order_history: orderHistory,
    },
    lang: 'en',
    merchant_code: tabbyConfig.merchantCode || 'ALJA',
    merchant_urls: {
      success: `${baseDomain}/checkout/tabby/callback?paymentStatus=approved&orderId=${order.id}`,
      cancel: `${baseDomain}/checkout/tabby/callback?paymentStatus=cancelled&orderId=${order.id}`,
      failure: `${baseDomain}/checkout/tabby/callback?paymentStatus=rejected&orderId=${order.id}`,
    },
  };

  // Requirement: Use SECRET_KEY for all backend API calls
  const bearerToken = tabbyConfig.secretKey;

  const response = await fetch(`${tabbyConfig.apiUrl}/checkout`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('[Tabby Checkout API Error]:', responseData);
    const rejectionCode =
      responseData.rejection_reason_code ||
      responseData.code ||
      responseData.error;

    let message = responseData.error || responseData.message || 'Failed to create Tabby checkout session.';
    const lower = (String(message) + ' ' + String(rejectionCode || '')).toLowerCase();

    if (
      rejectionCode === 'order_amount_too_high' ||
      lower.includes('order_amount_too_high') ||
      lower.includes('amount too high')
    ) {
      message = 'Your order amount exceeds your available Tabby limit. Please try Tamara or Cash on Delivery instead.';
    } else if (
      rejectionCode === 'order_amount_too_low' ||
      lower.includes('order_amount_too_low') ||
      lower.includes('amount too low')
    ) {
      message = 'Your order amount is below the minimum required for Tabby. Please try Tamara or Cash on Delivery instead.';
    } else if (
      responseData.status === 'rejected' ||
      rejectionCode === 'rejected' ||
      rejectionCode === 'not_available' ||
      lower.includes('rejected') ||
      lower.includes('not_available') ||
      lower.includes('not available') ||
      lower.includes('5000000') ||
      lower.includes('sandbox') ||
      lower.includes('reserved decline test number')
    ) {
      message = 'You are not eligible to use Tabby for this order. Please try another payment method like Tamara or Cash on Delivery.';
    } else {
      message = 'You are not eligible to use Tabby for this order. Please try another payment method like Tamara or Cash on Delivery.';
    }

    throw Object.assign(
      new Error(message),
      { status: response.status || 400, details: responseData, code: rejectionCode || 'not_available' }
    );
  }

  // Extract redirection URL from installments product
  const webUrl =
    responseData.configuration?.available_products?.installments?.[0]?.web_url ||
    responseData.web_url ||
    null;

  if (!webUrl && responseData.status !== 'created') {
    const rejectionCode =
      responseData.rejection_reason_code ||
      responseData.configuration?.available_products?.installments?.[0]?.rejection_reason_code ||
      responseData.configuration?.products?.installments?.rejection_reason_code ||
      responseData.code ||
      'not_available';

    const rawReason =
      responseData.configuration?.products?.installments?.rejection_reason ||
      responseData.configuration?.available_products?.installments?.[0]?.rejection_reason ||
      responseData.rejection_reason ||
      '';

    const lower = (String(rawReason) + ' ' + String(rejectionCode || '')).toLowerCase();

    let message = 'You are not eligible to use Tabby for this order. Please try another payment method like Tamara or Cash on Delivery.';

    if (
      rejectionCode === 'order_amount_too_high' ||
      lower.includes('order_amount_too_high') ||
      lower.includes('amount too high')
    ) {
      message = 'Your order amount exceeds your available Tabby limit. Please try Tamara or Cash on Delivery instead.';
    } else if (
      rejectionCode === 'order_amount_too_low' ||
      lower.includes('order_amount_too_low') ||
      lower.includes('amount too low')
    ) {
      message = 'Your order amount is below the minimum required for Tabby. Please try Tamara or Cash on Delivery instead.';
    } else if (
      responseData.status === 'rejected' ||
      rejectionCode === 'rejected' ||
      rejectionCode === 'not_available' ||
      lower.includes('rejected') ||
      lower.includes('not_available') ||
      lower.includes('not available') ||
      lower.includes('5000000') ||
      lower.includes('sandbox') ||
      lower.includes('reserved decline test number')
    ) {
      message = 'You are not eligible to use Tabby for this order. Please try another payment method like Tamara or Cash on Delivery.';
    }

    throw Object.assign(
      new Error(message),
      { status: 400, details: responseData, code: rejectionCode }
    );
  }

  return {
    checkout_id: responseData.id,
    checkout_url: webUrl,
    payment_id: responseData.payment?.id,
    status: responseData.status,
    raw: responseData,
  };
}

/**
 * Fetches live payment status from Tabby using SECRET_KEY
 * GET https://api.tabby.ai/api/v2/payments/{payment_id}
 */
export async function getPayment(paymentId) {
  const token = tabbyConfig.secretKey;
  if (!isTabbyConfigured() || !paymentId || paymentId.startsWith('tabby_payment_')) {
    return { id: paymentId, status: 'AUTHORIZED', simulated: true };
  }

  const response = await fetch(`${tabbyConfig.apiUrl}/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`[Tabby Get Payment Error] (${paymentId}):`, data);
    return { id: paymentId, status: 'UNKNOWN', error: data.error || data.message };
  }

  return data;
}

/**
 * Captures an authorized Tabby payment using SECRET_KEY
 * POST https://api.tabby.ai/api/v2/payments/{payment_id}/captures
 */
export async function capturePayment(paymentId, amount) {
  const token = tabbyConfig.secretKey;
  if (!isTabbyConfigured() || !paymentId || paymentId.startsWith('tabby_payment_')) {
    return { status: 'CLOSED', simulated: true };
  }

  const payload = amount ? { amount: Number(amount).toFixed(2) } : {};

  const response = await fetch(`${tabbyConfig.apiUrl}/payments/${paymentId}/captures`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn(`[Tabby Capture Warning] (${paymentId}):`, data);
    return data;
  }

  console.log(`[Tabby Capture Success] Payment ${paymentId} captured successfully.`);
  return data;
}

/**
 * Fetches all payments currently stuck in authorized status using SECRET_KEY
 * GET https://api.tabby.ai/api/v2/payments?status=authorized
 */
export async function listAuthorizedPayments() {
  const token = tabbyConfig.secretKey;
  if (!isTabbyConfigured()) {
    return [];
  }

  try {
    const response = await fetch(`${tabbyConfig.apiUrl}/payments?status=authorized`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn('[Tabby List Authorized Payments Error]:', data);
      return [];
    }

    if (Array.isArray(data)) return data;
    if (Array.isArray(data.payments)) return data.payments;
    if (Array.isArray(data.results)) return data.results;
    return [];
  } catch (error) {
    console.error('[Tabby listAuthorizedPayments Exception]:', error.message);
    return [];
  }
}

/**
 * Verifies Tabby Webhook notifications
 */
export function verifyWebhook(req) {
  const secret = (tabbyConfig.webhookSecret || '').trim();
  if (!secret || secret === 'placeholder_webhook_secret') {
    return true;
  }

  const signature = req.headers['x-signature'] || req.headers['x-tabby-signature'];
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  return signature === secret || token === secret;
}
