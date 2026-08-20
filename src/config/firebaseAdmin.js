import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.resolve(
  __dirname,
  '../../serviceAccountKey.json'
);

let firebaseInitialized = false;

try {
  const serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, 'utf8')
  );

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  }

  firebaseInitialized = true;

  console.log('Firebase Admin initialized successfully.');
} catch (error) {
  console.error(
    'Firebase Admin initialization failed:',
    error.message
  );
}

export const isFirebaseReady = () => firebaseInitialized;

export const db = () => {
  if (!firebaseInitialized) {
    throw Object.assign(
      new Error('Firebase Admin is not configured.'),
      { status: 503 }
    );
  }

  return getFirestore();
};

export const bucket = () => {
  if (!firebaseInitialized) {
    throw Object.assign(
      new Error('Firebase Admin is not configured.'),
      { status: 503 }
    );
  }

  return getStorage().bucket();
};

export const auth = () => {
  if (!firebaseInitialized) {
    throw Object.assign(
      new Error('Firebase Admin is not configured.'),
      { status: 503 }
    );
  }

  return getAuth();
};