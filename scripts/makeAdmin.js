import 'dotenv/config';
import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.resolve(
  __dirname,
  '../serviceAccountKey.json'
);

if (!fs.existsSync(serviceAccountPath)) {
  console.error(
    `Service account file not found:\n${serviceAccountPath}`
  );
  process.exit(1);
}

let serviceAccount;

try {
  serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, 'utf8')
  );
} catch (error) {
  console.error(
    'Could not read serviceAccountKey.json:',
    error.message
  );
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const email = process.argv[2]?.trim();

if (!email) {
  console.error('');
  console.error('Please provide an admin email.');
  console.error('');
  console.error(
    'Example:'
  );
  console.error(
    'node scripts/makeAdmin.js bell0210com@gmail.com'
  );
  console.error('');
  process.exit(1);
}

try {
  const auth = getAuth();

  const user = await auth.getUserByEmail(email);

  const existingClaims = user.customClaims || {};

  await auth.setCustomUserClaims(user.uid, {
    ...existingClaims,
    admin: true,
  });

  // Force existing sessions to obtain a fresh ID token.
  await auth.revokeRefreshTokens(user.uid);

  console.log('');
  console.log('======================================');
  console.log('       BELL ADMIN ACCESS GRANTED');
  console.log('======================================');
  console.log('');
  console.log(`Email: ${user.email}`);
  console.log(`UID:   ${user.uid}`);
  console.log('');
  console.log('Custom claims:');
  console.log({
    ...existingClaims,
    admin: true,
  });
  console.log('');
  console.log(
    'The user must sign out and sign in again.'
  );
  console.log('');
  console.log('Admin login:');
  console.log('http://localhost:5173/admin/login');
  console.log('');
} catch (error) {
  console.error('');
  console.error('Failed to make admin.');
  console.error('');
  console.error('Error:', error.message);
  console.error('');

  if (error.code === 'auth/user-not-found') {
    console.error(
      `No Firebase Authentication user found for: ${email}`
    );
  }

  process.exit(1);
}