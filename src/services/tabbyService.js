import { tabbyConfig, isTabbyConfigured } from '../config/tabby.js';

/**
 * Formats a phone number for UAE / Tabby compatibility (+971...)
 */
function formatPhoneNumber(phone) {
  if (!phone) return '+971500000001';
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

/**
 * Creates a Tabby checkout session for an order
 */
export async function createCheckoutSession({ order, user, clientOrigin }) {
  if (!isTabbyConfigured()) {
    console.warn('[Tabby] Keys are not configured. Returning development placeholder session.');
    return {
      checkout_id: `tabby_sandbox_${order.id}`,
      checkout_url: `${clientOrigin}/checkout/tabby/callback?paymentStatus=approved&orderId=${order.id}&simulated=true`,
      payment_id: `tabby_payment_${order.id}`,
      status: 'created',
      isSimulated: true,
    };
  }

  const shippingAddr = order.shippingAddress || {};
  const customerName = shippingAddr.fullName || user.name || 'Bell Customer';
  const customerPhone = formatPhoneNumber(shippingAddr.phone || user.phone);
  const customerEmail = shippingAddr.email || user.email || 'card.success@tabby.ai';

  const formattedItems = (order.items || []).map((item) => ({
    title: item.name || 'Smartphone',
    description: item.sku || item.name || 'Bell Phones Item',
    quantity: Number(item.quantity) || 1,
    unit_price: Number(item.unitPrice).toFixed(2),
    discount_amount: '0.00',
    reference_id: item.variantId || item.productId || item.sku || 'SKU',
    category: 'Smartphones',
  }));

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
        registered_since: new Date().toISOString(),
        loyalty_level: 0,
        wishlist_count: 0,
        is_social_networks_connected: false,
        is_phone_number_verified: true,
        is_email_verified: true,
      },
      order_history: [],
    },
    lang: 'en',
    merchant_code: tabbyConfig.merchantCode || 'ALJA',
    merchant_urls: {
      success: `${clientOrigin}/checkout/tabby/callback?paymentStatus=approved&orderId=${order.id}`,
      cancel: `${clientOrigin}/checkout/tabby/callback?paymentStatus=canceled&orderId=${order.id}`,
      failure: `${clientOrigin}/checkout/tabby/callback?paymentStatus=declined&orderId=${order.id}`,
    },
  };

  // Tabby checkout creation accepts public or secret key as bearer token
  const bearerToken = tabbyConfig.publicKey || tabbyConfig.secretKey;

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
    throw Object.assign(
      new Error(responseData.error || responseData.message || 'Failed to create Tabby checkout session.'),
      { status: response.status || 500, details: responseData }
    );
  }

  // Extract redirection URL from installments product
  const webUrl =
    responseData.configuration?.available_products?.installments?.[0]?.web_url ||
    responseData.web_url ||
    null;

  if (!webUrl && responseData.status !== 'created') {
    let message = 'Tabby installments are not available for this transaction.';
    if (responseData.rejection_reason_code === 'not_available' || responseData.status === 'rejected') {
      if (customerPhone.endsWith('0002')) {
        message = 'Tabby Sandbox: +971500000002 is the reserved Decline Test number. For successful checkout approval, please use +971500000001 or +971501234567.';
      } else {
        message = responseData.configuration?.products?.installments?.rejection_reason ||
          responseData.rejection_reason ||
          'Tabby installments are not available for this buyer/amount. In Sandbox, please test with +971 50 000 0001.';
      }
    }

    throw Object.assign(
      new Error(message),
      { status: 400, details: responseData }
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
 * Captures an authorized Tabby payment
 */
export async function capturePayment(paymentId, amount) {
  const token = tabbyConfig.secretKey || tabbyConfig.publicKey;
  if (!isTabbyConfigured() || !paymentId || paymentId.startsWith('tabby_payment_')) {
    return { status: 'CLOSED', simulated: true };
  }

  const response = await fetch(`${tabbyConfig.apiUrl}/payments/${paymentId}/captures`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ amount: Number(amount).toFixed(2) }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn('[Tabby Capture Warning]:', data);
    return data;
  }

  return data;
}

/**
 * Fetches live payment status from Tabby
 */
export async function getPayment(paymentId) {
  const token = tabbyConfig.secretKey || tabbyConfig.publicKey;
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
    return { id: paymentId, status: 'UNKNOWN', error: data.error };
  }

  return data;
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
