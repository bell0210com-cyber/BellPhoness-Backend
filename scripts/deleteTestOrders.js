import { db } from '../src/config/firebaseAdmin.js';

async function deleteTestOrders() {
  console.log('--- Scanning Firestore Orders for Test Criteria ---');
  const firestore = db();
  const ordersColl = firestore.collection('orders');

  const snapshot = await ordersColl.get();
  console.log(`Total orders found in collection: ${snapshot.size}`);

  if (snapshot.empty) {
    console.log('No orders found in Firestore database.');
    return;
  }

  const deletedOrderIds = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const email = (
      data.shippingAddress?.email ||
      data.email ||
      data.customerEmail ||
      data.user?.email ||
      ''
    ).toLowerCase();

    const phone = (
      data.shippingAddress?.phone ||
      data.phone ||
      data.customerPhone ||
      data.user?.phone ||
      ''
    ).trim();

    const isTestEmail = email.includes('tabby') || email.includes('test');
    const isTestPhone = phone.includes('+971500000001') || phone.includes('+971500000002') || phone.includes('500000001') || phone.includes('500000002');

    if (isTestEmail || isTestPhone) {
      const reason = [];
      if (isTestEmail) reason.push(`Email: "${email}" matches "tabby"/"test"`);
      if (isTestPhone) reason.push(`Phone: "${phone}" matches test number`);

      console.log(`\n🗑️ Deleting Order ID: ${doc.id}`);
      console.log(`   Customer: ${data.shippingAddress?.fullName || data.customerName || 'N/A'}`);
      console.log(`   Email: ${email || 'N/A'}`);
      console.log(`   Phone: ${phone || 'N/A'}`);
      console.log(`   Total: AED ${data.total || data.subtotal || 0}`);
      console.log(`   Reason: ${reason.join(' | ')}`);

      await doc.ref.delete();
      deletedOrderIds.push(doc.id);
    }
  }

  console.log('\n======================================================');
  console.log(`Deleted ${deletedOrderIds.length} test order(s) matching criteria.`);
  if (deletedOrderIds.length > 0) {
    console.log('Deleted Order IDs:');
    deletedOrderIds.forEach((id, index) => console.log(`  ${index + 1}. ${id}`));
  } else {
    console.log('No test orders matched the specified criteria.');
  }
  console.log('======================================================\n');
}

deleteTestOrders()
  .then(() => {
    console.log('--- Test Orders Cleanup Finished Successfully ---');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error during test orders deletion:', err);
    process.exit(1);
  });
