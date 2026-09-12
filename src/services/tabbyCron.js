import { db } from '../config/firebaseAdmin.js';
import * as tabbyService from './tabbyService.js';
import { isTabbyConfigured } from '../config/tabby.js';

const ordersCollection = () => db().collection('orders');

/**
 * Checks for any Tabby payments stuck in authorized status and captures them.
 * 1. Filter uses lowercase status=authorized.
 * 2. After capture succeeds, no further retrieve requests are made for the payment.
 */
export async function checkAndCaptureAuthorizedPayments() {
  if (!isTabbyConfigured()) {
    return;
  }

  try {
    console.log('[Tabby Cron] Checking for payments in authorized status...');
    const payments = await tabbyService.listAuthorizedPayments();

    if (!Array.isArray(payments) || payments.length === 0) {
      console.log('[Tabby Cron] No pending authorized payments found.');
      return;
    }

    console.log(`[Tabby Cron] Found ${payments.length} authorized payment(s) to capture.`);

    for (const payment of payments) {
      const paymentId = payment.id;
      const amount = payment.amount;
      const orderRefId = payment.order?.reference_id;

      console.log(`[Tabby Cron] Capturing stuck payment: ${paymentId} (Amount: AED ${amount})...`);

      try {
        const captureResult = await tabbyService.capturePayment(paymentId, amount);

        // Update matching Firestore Order directly without making any further retrieve requests
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
            status: 'Paid',
            paymentStatus: 'Paid',
            'tabby.status': 'CAPTURED',
            'tabby.cronCapturedAt': new Date(),
            updatedAt: new Date(),
          });
          console.log(`[Tabby Cron] Updated Firestore order ${orderDoc.id} status to "Paid".`);
        }

        // Capture succeeded: do not make any further retrieve requests for this payment
      } catch (err) {
        console.error(`[Tabby Cron] Failed to capture payment ${paymentId}:`, err.message);
      }
    }
  } catch (error) {
    console.error('[Tabby Cron Error]:', error.message);
  }
}

/**
 * Starts the daily cron job
 */
export function startTabbyCronJob() {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  // Run initial check after 30 seconds of server boot
  setTimeout(() => {
    checkAndCaptureAuthorizedPayments();
  }, 30 * 1000);

  // Run recurring check daily (every 24 hours)
  const intervalId = setInterval(() => {
    checkAndCaptureAuthorizedPayments();
  }, TWENTY_FOUR_HOURS_MS);

  console.log('⏰ [Tabby Daily Cron Job] Initialized (Running daily).');
  return intervalId;
}
