import { db } from '../src/config/firebaseAdmin.js';

async function check() {
  const firestore = db();
  const snapshot = await firestore.collection('products').get();
  console.log(`Found ${snapshot.size} products in Firestore.`);
  
  if (snapshot.size > 0) {
    console.log('Sample documents:');
    snapshot.docs.slice(0, 3).forEach(doc => {
      console.log(`- ${doc.id}: ${doc.data().name} (${doc.data().variants?.length} variants)`);
    });
  }
}

check().catch(console.error);
