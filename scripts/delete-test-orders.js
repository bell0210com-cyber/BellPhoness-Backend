import { db } from '../src/config/firebaseAdmin.js';

async function deleteTestOrders() {
  try {
    const snapshot = await db().collection('orders').get();
    console.log(`Found ${snapshot.size} total order(s) in Firestore.`);
    
    let deletedCount = 0;
    const batchSize = 500;
    let batch = db().batch();
    let currentBatchOps = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const customer = String(data.shippingAddress?.fullName || data.shippingAddress?.name || data.userId || '').toLowerCase();
      const email = String(data.shippingAddress?.email || data.email || '').toLowerCase();
      
      const isTestOrder = 
        customer.includes('test') || 
        email.includes('test') ||
        data.isSimulated === true ||
        data.tabby?.isSimulated === true ||
        data.tamara?.isSimulated === true ||
        data.userId === 'guest' ||
        !data.shippingAddress?.fullName;

      if (isTestOrder) {
        console.log(`🗑️ Deleting test order ${doc.id} (Customer: "${data.shippingAddress?.fullName || data.userId}", Total: AED ${data.total})...`);
        batch.delete(doc.ref);
        currentBatchOps++;
        deletedCount++;

        if (currentBatchOps >= batchSize) {
          await batch.commit();
          batch = db().batch();
          currentBatchOps = 0;
        }
      }
    }

    if (currentBatchOps > 0) {
      await batch.commit();
    }

    console.log(`\n✅ Successfully deleted ${deletedCount} test order(s) from Firestore.`);

    // Verify remaining orders
    const remainingSnap = await db().collection('orders').get();
    console.log(`Remaining orders count: ${remainingSnap.size}`);
  } catch (error) {
    console.error('Error deleting test orders:', error);
  }
}

deleteTestOrders();
