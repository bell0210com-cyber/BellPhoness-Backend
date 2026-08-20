import { db } from '../config/firebaseAdmin.js';

const settingsDoc = () => db().collection('settings').doc('store');

export const readSettings = async () => {
  const doc = await settingsDoc().get();

  if (!doc.exists) {
    return {
      storeName: '',
      contactEmail: '',
      contactPhone: '',
      address: '',
      vatPercent: 5
    };
  }

  return doc.data();
};

export const updateSettings = async (payload) => {
  await settingsDoc().set(payload, { merge: true });

  return readSettings();
};