import { db } from '../src/config/firebaseAdmin.js';

async function listOrders() {
  try {
    const snapshot = await db().collection('orders').get();
    console.log(`Found ${snapshot.size} total order(s) in Firestore.\n`);
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const customer = data.shippingAddress?.fullName || data.shippingAddress?.name || data.userId || 'Unknown';
      const email = data.shippingAddress?.email || data.email || 'No email';
      const createdAt = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt;
      console.log(`ID: ${doc.id} | Customer: "${customer}" | Email: "${email}" | Total: AED ${data.total} | Status: ${data.status} | CreatedAt: ${createdAt}`);
    });
  } catch (error) {
    console.error('Error fetching orders:', error.message);
  }
}

listOrders();
