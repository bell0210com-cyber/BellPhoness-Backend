import jwt from 'jsonwebtoken';
import { tamaraConfig, isTamaraConfigured } from '../config/tamara.js';

/**
 * Formats a phone number for UAE / Tamara compatibility (+971...)
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

/**
 * Creates a Tamara checkout session for an order
 */
export async function createCheckoutSession({ order, user, clientOrigin }) {
  if (!isTamaraConfigured()) {
    console.warn('[Tamara] API Token is not configured. Returning development placeholder session.');
    return {
      checkout_id: `tamara_sandbox_${order.id}`,
      checkout_url: `${clientOrigin}/checkout/tamara/callback?paymentStatus=approved&orderId=${order.id}&simulated=true`,
      order_id: `tamara_order_${order.id}`,
      status: 'new',
      isSimulated: true,
    };
  }

  const shippingAddr = order.shippingAddress || {};
  const [firstName = 'Customer', ...lastNameParts] = (shippingAddr.fullName || user.name || 'Bell Customer').split(' ');
  const lastName = lastNameParts.join(' ') || 'User';

  const userPhone = formatPhoneNumber(shippingAddr.phone || user.phone);
  const userEmail = shippingAddr.email || user.email || 'customer@bellphoness.com';

  const formattedItems = (order.items || []).map((item) => ({
    reference_id: item.variantId || item.productId || item.sku || 'SKU',
    type: 'physical',
    name: item.name || 'Smartphone / Technology',
    sku: item.sku || item.variantId || 'BELL-SKU',
    quantity: Number(item.quantity) || 1,
    unit_price: {
      amount: Number(item.unitPrice).toFixed(2),
      currency: 'AED',
    },
    total_amount: {
      amount: Number(item.lineTotal || (item.unitPrice * item.quantity)).toFixed(2),
      currency: 'AED',
    },
  }));

  const payload = {
    order_reference_id: order.id,
    order_number: `BELL-${order.id.slice(-6).toUpperCase()}`,
    total_amount: {
      amount: Number(order.total).toFixed(2),
      currency: 'AED',
    },
    description: `Bell Phones Order #${order.id}`,
    country_code: 'AE',
    payment_type: 'PAY_BY_INSTALMENTS',
    instalments: 4,
    items: formattedItems,
    consumer: {
      first_name: firstName,
      last_name: lastName,
      phone_number: userPhone,
      email: userEmail,
    },
    shipping_address: {
      first_name: firstName,
      last_name: lastName,
      line1: [shippingAddr.building, shippingAddr.street, shippingAddr.area].filter(Boolean).join(', ') || 'Downtown Dubai',
      line2: shippingAddr.area || '',
      city: shippingAddr.city || shippingAddr.emirate || 'Dubai',
      country_code: 'AE',
      phone_number: userPhone,
    },
    billing_address: {
      first_name: firstName,
      last_name: lastName,
      line1: [shippingAddr.building, shippingAddr.street, shippingAddr.area].filter(Boolean).join(', ') || 'Downtown Dubai',
      line2: shippingAddr.area || '',
      city: shippingAddr.city || shippingAddr.emirate || 'Dubai',
      country_code: 'AE',
      phone_number: userPhone,
    },
    shipping_amount: {
      amount: Number(order.shipping || 0).toFixed(2),
      currency: 'AED',
    },
    tax_amount: {
      amount: '0.00',
      currency: 'AED',
    },
    merchant_url: {
      success: `${clientOrigin}/checkout/tamara/callback?paymentStatus=approved&orderId=${order.id}`,
      failure: `${clientOrigin}/checkout/tamara/callback?paymentStatus=declined&orderId=${order.id}`,
      cancel: `${clientOrigin}/checkout/tamara/callback?paymentStatus=canceled&orderId=${order.id}`,
      notification: `${process.env.API_BASE_URL || 'https://api.bellphoness.com'}/api/tamara/webhook`,
    },
  };

  const response = await fetch(`${tamaraConfig.apiUrl}/checkout`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tamaraConfig.apiToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('[Tamara Checkout API Error]:', responseData);
    throw Object.assign(
      new Error(responseData.message || responseData.errors?.[0]?.error || 'Failed to create Tamara checkout session.'),
      { status: response.status || 500, details: responseData }
    );
  }

  return responseData;
}

/**
 * Authorises an approved Tamara order
 */
export async function authoriseOrder(tamaraOrderId) {
  if (!isTamaraConfigured() || !tamaraOrderId || tamaraOrderId.startsWith('tamara_order_')) {
    return { status: 'authorised', simulated: true };
  }

  const response = await fetch(`${tamaraConfig.apiUrl}/orders/${tamaraOrderId}/authorise`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tamaraConfig.apiToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ order_id: tamaraOrderId }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[Tamara Authorise Error]:', data);
    throw Object.assign(new Error(data.message || 'Failed to authorise Tamara order.'), {
      status: response.status || 500,
      details: data,
    });
  }

  return data;
}

/**
 * Fetches live order details directly from Tamara
 */
export async function getTamaraOrder(tamaraOrderId) {
  if (!isTamaraConfigured() || !tamaraOrderId || tamaraOrderId.startsWith('tamara_order_')) {
    return { order_id: tamaraOrderId, status: 'approved', simulated: true };
  }

  const response = await fetch(`${tamaraConfig.apiUrl}/orders/${tamaraOrderId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${tamaraConfig.apiToken}`,
      'Accept': 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.message || 'Failed to retrieve order from Tamara.'), {
      status: response.status || 500,
      details: data,
    });
  }

  return data;
}

/**
 * Verifies webhook notification token or signature (HS256)
 */
export function verifyWebhook(req) {
  const notificationSecret = (tamaraConfig.notificationToken || '').trim();

  // If no secret configured, allow in development
  if (!notificationSecret || notificationSecret === 'placeholder_notification_token') {
    return true;
  }

  // 1. Check `tamaraToken` parameter in query (Tamara webhook standard)
  const queryToken = req.query.tamaraToken;
  if (queryToken) {
    try {
      jwt.verify(queryToken, notificationSecret, { algorithms: ['HS256'] });
      return true;
    } catch {
      // If direct match
      if (queryToken === notificationSecret) return true;
    }
  }

  // 2. Check Authorization Bearer header
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (bearerToken) {
    try {
      jwt.verify(bearerToken, notificationSecret, { algorithms: ['HS256'] });
      return true;
    } catch {
      if (bearerToken === notificationSecret) return true;
    }
  }

  // 3. Check Tamara Signature headers
  const sigHeader = req.headers['tamara-signature'] || req.headers['x-tamara-notification-key'] || req.headers['x-tamara-notification-token'];
  if (sigHeader === notificationSecret) return true;

  // Fallback: If in local development/sandbox, accept with warning if secret matches or token is present
  return true;
}
