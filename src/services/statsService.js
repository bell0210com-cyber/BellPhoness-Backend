import { db } from '../config/firebaseAdmin.js';

export async function getDashboardStats() {
  const firestore = db();

  // 1. Fetch entire products catalog for unpaginated aggregate calculations
  const productsSnap = await firestore.collection('products').get();
  
  let totalProducts = 0;
  let activeProducts = 0;
  let lowStock = 0;
  let outOfStock = 0;

  productsSnap.docs.forEach((doc) => {
    const data = doc.data();
    const isActive = data.is_active === true;
    const variants = Array.isArray(data.variants) && data.variants.length > 0 ? data.variants : [{}];
    
    // Sum all product items / variants in the catalog
    totalProducts += variants.length;
    if (isActive) {
      activeProducts += variants.length;
    }

    if (Array.isArray(data.variants) && data.variants.length > 0) {
      const totalStock = data.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
      if (totalStock === 0) {
        outOfStock++;
      } else if (totalStock <= 5) {
        lowStock++;
      }
    }
  });

  const inactiveProducts = Math.max(0, totalProducts - activeProducts);

  // 2. Fetch orders and calculate real revenue (valid non-cancelled / non-failed transactions)
  const ordersSnap = await firestore.collection('orders').get();
  const totalOrders = ordersSnap.size;
  let pendingOrders = 0;
  let revenue = 0;

  ordersSnap.docs.forEach((doc) => {
    const data = doc.data();
    const status = (data.status || '').toLowerCase();
    const payStatus = (data.paymentStatus || '').toLowerCase();

    if (data.status === 'Pending') {
      pendingOrders++;
    }

    // Only count completed/confirmed/active orders in revenue
    if (status !== 'cancelled' && payStatus !== 'failed') {
      revenue += Number(data.total) || 0;
    }
  });

  return {
    totalProducts, // 84
    activeProducts, // 84
    inactiveProducts, // 0
    totalOrders, // 15
    pendingOrders, // 3
    revenue, // 13390
    lowStock,
    outOfStock
  };
}
