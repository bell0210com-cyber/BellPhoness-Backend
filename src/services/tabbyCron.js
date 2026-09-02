import { db } from '../config/firebaseAdmin.js';
import * as tabbyService from './tabbyService.js';
import { isTabbyConfigured } from '../config/tabby.js';

const ordersCollection = () => db().collection('orders');

/**
 * Checks for any Tabby payments stuck in AUTHORIZED status and captures them
 */
export async function checkAndCaptureAuthorizedPayments() {
  if (!isTabbyConfigured()) {
    return;
  }

  try {
    console.log('[Tabby Cron] Checking for payments in AUTHORIZED status...');
    const payments = await tabbyService.listAuthorizedPayments();

    if (!Array.isArray(payments) || payments.length === 0) {
      console.log('[Tabby Cron] No pending AUTHORIZED payments found.');
      return;
    }

    console.log(`[Tabby Cron] Found ${payments.length} AUTHORIZED payment(s) to capture.`);

    for (const payment of payments) {
      const paymentId = payment.id;
      const amount = payment.amount;
      const orderRefId = payment.order?.reference_id;

      console.log(`[Tabby Cron] Capturing stuck payment: ${paymentId} (Amount: AED ${amount})...`);

      try {
        await tabbyService.capturePayment(paymentId, amount);

        // Update matching Firestore Order
        let orderDoc = null;
        if (orderRefId) {
          const snap = await ordersCollection().doc(orderRefId).get();
          if (snap.exists) orderDoc = snap;
        }

        if (!orderDoc && paymentId) {
          const querySnap = await ordersCollection().where('tabby.paymentId', '==', paymentId).limit(1).get();
          if (!querySnap.empty) {
            orderDoc = querySnap.docs[0];
          }
        }

        if (orderDoc) {
          await orderDoc.ref.update({
            status: 'paid',
            paymentStatus: 'paid',
            'tabby.status': 'CAPTURED',
            'tabby.cronCapturedAt': new Date(),
            updatedAt: new Date(),
          });
          console.log(`[Tabby Cron] Updated Firestore order ${orderDoc.id} status to "paid".`);
        }
      } catch (err) {
        console.error(`[Tabby Cron] Failed to capture payment ${paymentId}:`, err.message);
      }
    }
  } catch (error) {
    console.error('[Tabby Cron Error]:', error.message);
  }
}

/**
 * Starts the hourly cron job
 */
export function startTabbyCronJob() {
  const ONE_HOUR_MS = 60 * 60 * 1000;

  // Run initial check after 30 seconds of server boot
  setTimeout(() => {
    checkAndCaptureAuthorizedPayments();
  }, 30 * 1000);

  // Run recurring check every 1 hour
  const intervalId = setInterval(() => {
    checkAndCaptureAuthorizedPayments();
  }, ONE_HOUR_MS);

  console.log('⏰ [Tabby Cron Job] Initialized (Running every 1 hour).');
  return intervalId;
}
