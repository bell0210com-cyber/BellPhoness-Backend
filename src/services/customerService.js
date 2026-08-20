import { db } from '../config/firebaseAdmin.js';

export const listCustomers = async () => {
  const snapshot = await db().collection('customers').orderBy('createdAt', 'desc').get();

  const customers = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();

    const orderCountSnap = await db()
      .collection('orders')
      .where('userId', '==', doc.id)
      .get();

    customers.push({
      id: doc.id,
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      orderCount: orderCountSnap.size,
      createdAt: data.createdAt?.toDate?.() ?? data.createdAt ?? null
    });
  }

  return customers;
};

export const readCustomer = async (id) => {
  const doc = await db().collection('customers').doc(id).get();

  if (!doc.exists) {
    const error = new Error('Customer not found.');
    error.status = 404;
    throw error;
  }

  return { id: doc.id, ...doc.data() };
};