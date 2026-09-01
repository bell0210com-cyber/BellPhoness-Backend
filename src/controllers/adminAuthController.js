import { db } from '../config/firebaseAdmin.js';
import { sendAdminOtpEmail } from '../services/mailService.js';
import crypto from 'crypto';

const otpsCollection = () => db().collection('admin_security_otps');

function maskEmail(email) {
  if (!email || typeof email !== 'string') return 'admin@bell.ae';
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [name, domain] = parts;
  const visible = name.length > 2 ? name.slice(0, 2) : name.slice(0, 1);
  return `${visible}***@${domain}`;
}

/**
 * Generates and sends a 6-digit OTP to the admin Gmail
 * POST /api/admin/auth/send-otp
 */
export async function sendOtp(req, res, next) {
  try {
    const requestedEmail = req.body?.email || req.query?.email || req.user?.email;
    const adminEmail = (requestedEmail || process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'bellphonessdubai@gmail.com').trim();
    
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store in Firestore for persistence across restarts
    await otpsCollection().doc('active_otp').set({
      otp,
      email: adminEmail,
      createdAt: new Date(),
      expiresAt,
    });

    console.log(`\n======================================================`);
    console.log(`🔑 [BELL ADMIN OTP]: >>> ${otp} <<<`);
    console.log(`📧 Target Admin Email: ${adminEmail}`);
    console.log(`⏰ Expiration: 10 minutes (Active in Firestore)`);
    console.log(`======================================================\n`);

    // Send email to admin Gmail (asynchronous dispatch)
    sendAdminOtpEmail(otp, adminEmail).catch((err) => {
      console.error('[Admin OTP Mail error]:', err);
    });

    const masked = maskEmail(adminEmail);

    return res.status(200).json({
      success: true,
      message: `Security OTP has been sent to ${masked}.`,
      emailMasked: masked,
      targetEmail: adminEmail,
      devOtp: otp, // Bypass for browser developer tools inspection
    });
  } catch (error) {
    console.error('Error generating/sending admin OTP:', error);
    next(error);
  }
}

/**
 * Verifies the 6-digit OTP entered by the admin
 * POST /api/admin/auth/verify-otp
 */
export async function verifyOtp(req, res, next) {
  try {
    const { otp } = req.body;

    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 6-digit verification code.',
      });
    }

    const otpDoc = await otpsCollection().doc('active_otp').get();

    if (!otpDoc.exists) {
      return res.status(400).json({
        success: false,
        message: 'No active OTP found. Please click "Send OTP" to request a new code.',
      });
    }

    const otpData = otpDoc.data();
    const isExpired = otpData.expiresAt ? otpData.expiresAt.toDate() < new Date() : false;

    if (isExpired) {
      await otpDoc.ref.delete().catch(() => {});
      return res.status(400).json({
        success: false,
        message: 'This OTP code has expired. Please request a new code.',
      });
    }

    if (otpData.otp.trim() !== otp.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect OTP verification code. Please check your email and try again.',
      });
    }

    // OTP verified successfully - clear it so it cannot be reused
    await otpDoc.ref.delete().catch(() => {});

    // Generate secure session token
    const sessionToken = crypto.randomBytes(32).toString('hex');

    return res.status(200).json({
      success: true,
      verified: true,
      token: sessionToken,
      timestamp: Date.now(),
      message: 'Admin identity successfully verified.',
    });
  } catch (error) {
    console.error('Error verifying admin OTP:', error);
    next(error);
  }
}
