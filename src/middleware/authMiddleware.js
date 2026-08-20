import { auth, isFirebaseReady } from '../config/firebaseAdmin.js';

export async function verifyFirebaseToken(req, res, next) {
  if (!isFirebaseReady()) {
    return res.status(503).json({
      message: 'Firebase Admin is not configured.'
    });
  }

  const token = req.headers.authorization?.replace(
    /^Bearer\s+/i,
    ''
  );

  if (!token) {
    return res.status(401).json({
      message: 'Authentication required.'
    });
  }

  try {
    req.user = await auth().verifyIdToken(token);
    return next();
  } catch (error) {
    console.error('Firebase token verification failed:', error);

    return res.status(401).json({
      message: 'Invalid or expired authentication token.'
    });
  }
}