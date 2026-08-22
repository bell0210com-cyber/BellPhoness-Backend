import { db } from '../src/config/firebaseAdmin.js';

async function run() {
  console.log('Fetching products to delete...');
  const firestore = db();
  const snapshot = await firestore.collection('products').get();
  
  let count = 0;
  for (const doc of snapshot.docs) {
    await firestore.collection('products').doc(doc.id).delete();
    count++;
  }
  
  console.log(`Successfully deleted ${count} products.`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
