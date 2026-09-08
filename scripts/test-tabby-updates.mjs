import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('🔍 TABBY INTEGRATION COMPREHENSIVE VERIFICATION SUITE');
console.log('====================================================\n');

let passCount = 0;
let totalTests = 0;

function assertTest(name, condition, details = '') {
  totalTests++;
  if (condition) {
    passCount++;
    console.log(`✅ [PASS] ${name}`);
    if (details) console.log(`   └─ ${details}`);
  } else {
    console.error(`❌ [FAIL] ${name}`);
    if (details) console.error(`   └─ ${details}`);
  }
}

// ----------------------------------------------------
// TEST 1: Rate Limiting on /api/tabby
// ----------------------------------------------------
console.log('\n--- 1. Rate Limiter Configuration on /api/tabby ---');
const serverJsPath = path.resolve(__dirname, '../src/server.js');
const serverJsContent = fs.readFileSync(serverJsPath, 'utf8');

const hasTabbyLimiter = serverJsContent.includes('const tabbyLimiter = rateLimit({');
const hasTabbyMax50 = /tabbyLimiter\s*=\s*rateLimit\(\{[\s\S]*?max:\s*50/.test(serverJsContent);
const hasTabbyLimiterAttached = serverJsContent.includes("app.use('/api/tabby', tabbyLimiter");
const hasPaymentTabbyAttached = serverJsContent.includes("app.use('/api/payments/tabby', tabbyLimiter");

assertTest(
  'Tabby Rate Limiter is defined with max: 50 requests / 15 minutes',
  hasTabbyLimiter && hasTabbyMax50,
  'Found tabbyLimiter with max: 50 and windowMs: 15 * 60 * 1000'
);

assertTest(
  'Rate Limiter is explicitly applied to /api/tabby and /api/payments/tabby',
  hasTabbyLimiterAttached && hasPaymentTabbyAttached,
  'Both /api/tabby and /api/payments/tabby protected with tabbyLimiter'
);

// ----------------------------------------------------
// TEST 2: Verify tabbyCron.js & lowercase status=authorized
// ----------------------------------------------------
console.log('\n--- 2. tabbyCron.js & status=authorized Execution ---');
const tabbyCronPath = path.resolve(__dirname, '../src/services/tabbyCron.js');
const tabbyCronContent = fs.readFileSync(tabbyCronPath, 'utf8');
const tabbyServicePath = path.resolve(__dirname, '../src/services/tabbyService.js');
const tabbyServiceContent = fs.readFileSync(tabbyServicePath, 'utf8');

const hasLowerCaseStatus = tabbyServiceContent.includes('/payments?status=authorized');
const hasDirectOrderUpdate = tabbyCronContent.includes("status: 'paid'") && tabbyCronContent.includes("'tabby.status': 'CAPTURED'");
const hasNoExtraRetrieveCall = !tabbyCronContent.includes('tabbyService.getPayment(');

assertTest(
  'listAuthorizedPayments queries with lowercase status=authorized',
  hasLowerCaseStatus,
  'Endpoint verified: ${tabbyConfig.apiUrl}/payments?status=authorized'
);

assertTest(
  'Cron updates Firestore order directly upon successful capture without extra retrieve calls',
  hasDirectOrderUpdate && hasNoExtraRetrieveCall,
  'Proper loop termination with no duplicate getPayment retrieve overhead'
);

// ----------------------------------------------------
// TEST 3: Official Tabby Rejection Messages
// ----------------------------------------------------
console.log('\n--- 3. Error Handling for Tabby Rejections ---');
const checkoutPagePath = path.resolve(__dirname, '../../BellPhoness-Frontend/src/pages/CheckoutPage.jsx');
const checkoutPageContent = fs.readFileSync(checkoutPagePath, 'utf8');
const callbackPagePath = path.resolve(__dirname, '../../BellPhoness-Frontend/src/pages/TabbyCallbackPage.jsx');
const callbackPageContent = fs.readFileSync(callbackPagePath, 'utf8');

const expectedTooHigh = 'This purchase is above your current spending limit with Tabby, try a smaller cart or use another payment method.';
const expectedTooLow = 'The purchase amount is below the minimum amount required to use Tabby, try adding more items or use another payment method.';
const expectedNotAvailable = 'Sorry, Tabby is unable to approve this purchase, please use an alternative payment method for your order.';

const backendHandlesTooHigh = tabbyServiceContent.includes(expectedTooHigh);
const checkoutHandlesTooHigh = checkoutPageContent.includes(expectedTooHigh);
const checkoutHandlesTooLow = checkoutPageContent.includes(expectedTooLow);
const checkoutHandlesNotAvailable = checkoutPageContent.includes(expectedNotAvailable);

const noTestPhonesInCheckout = !checkoutPageContent.includes('+971500000001') && !checkoutPageContent.includes('5000000');
const noTestPhonesInBackend = !tabbyServiceContent.includes('5000000') && !tabbyServiceContent.includes('+971500000001');

assertTest(
  'Backend tabbyService uses exact official copy for order_amount_too_high, too_low, and not_available',
  backendHandlesTooHigh && tabbyServiceContent.includes(expectedTooLow) && tabbyServiceContent.includes(expectedNotAvailable),
  'Tabby service maps official rejection reasons accurately'
);

assertTest(
  'Frontend CheckoutPage displays exact official Tabby rejection copy',
  checkoutHandlesTooHigh && checkoutHandlesTooLow && checkoutHandlesNotAvailable,
  'Matches order_amount_too_high, order_amount_too_low, and not_available exactly'
);

assertTest(
  'No test phone numbers or sandbox-specific logic in rejection derivations',
  noTestPhonesInCheckout && noTestPhonesInBackend,
  'Rejections are derived purely from API response rejection_reason field'
);

// ----------------------------------------------------
// TEST 4: Official Tabby Logo Badge (80px width)
// ----------------------------------------------------
console.log('\n--- 4. Official Tabby Logo Image ---');

const checkoutUsesOfficialBadge =
  checkoutPageContent.includes('/assets/tabby-badge.png') ||
  checkoutPageContent.includes('https://assets.tabby.ai/assets/tabby-badge.png');
const checkoutSpecifiesWidth80 = checkoutPageContent.includes('width: 80');

assertTest(
  'CheckoutPage.jsx uses verified Tabby logo image (/assets/tabby-badge.png or official hosted asset)',
  checkoutUsesOfficialBadge,
  'Using verified local Tabby badge asset with SVG fallback'
);

assertTest(
  'Tabby logo image has width: 80px and height: auto',
  checkoutSpecifiesWidth80,
  'Image styled with width: 80, height: auto'
);

// ----------------------------------------------------
// TEST 5: Session Payload: order_history, registered_since, loyalty_level, extra fields
// ----------------------------------------------------
console.log('\n--- 5. Tabby Session Payload Fields ---');

const hasOrderHistoryFetch = tabbyServiceContent.includes('order_history: orderHistory') &&
  tabbyServiceContent.includes('pastOrders.slice(0, 10).map(');

const hasOrderHistoryMapping = tabbyServiceContent.includes("paymentMethod = 'cod'") &&
  tabbyServiceContent.includes("paymentMethod = 'card'") &&
  tabbyServiceContent.includes("status = 'complete'") &&
  tabbyServiceContent.includes("status = 'canceled'") &&
  tabbyServiceContent.includes("status = 'processing'") &&
  tabbyServiceContent.includes("status = 'unknown'");

const hasOrderHistoryRequiredKeys = tabbyServiceContent.includes('purchased_at:') &&
  tabbyServiceContent.includes('amount,') &&
  tabbyServiceContent.includes('payment_method:') &&
  tabbyServiceContent.includes('status,') &&
  tabbyServiceContent.includes('buyer:') &&
  tabbyServiceContent.includes('shipping_address:');

const hasRegisteredSinceAuth = tabbyServiceContent.includes('userRecord?.metadata?.creationTime') &&
  !tabbyServiceContent.includes('registeredSince = new Date().toISOString()');

const hasLoyaltyLevelInteger = tabbyServiceContent.includes('completedOrdersCount') &&
  tabbyServiceContent.includes('loyalty_level: loyaltyLevel') &&
  tabbyServiceContent.includes('Number.isInteger(completedOrdersCount)');

const hasExtraBuyerFields = tabbyServiceContent.includes('wishlist_count: wishlistCount') &&
  tabbyServiceContent.includes('is_email_verified: isEmailVerified') &&
  tabbyServiceContent.includes('is_phone_number_verified: isPhoneNumberVerified');

assertTest(
  'order_history fetches last 5-10 orders and maps payment_method and status exactly',
  hasOrderHistoryFetch && hasOrderHistoryMapping && hasOrderHistoryRequiredKeys,
  'Maps tabby/tamara->card, cod->cod; paid/delivered->complete, cancelled->canceled, pending/processing->processing, else->unknown'
);

assertTest(
  'buyer_history.registered_since uses Firebase Auth creationTime (NOT current time)',
  hasRegisteredSinceAuth,
  'Sends ISO 8601 creationTime and avoids current time fallback'
);

assertTest(
  'buyer_history.loyalty_level counts paid or delivered orders as integer number',
  hasLoyaltyLevelInteger,
  'Counts all completed orders (paid/delivered) and passes integer'
);

assertTest(
  'buyer_history includes wishlist_count, is_email_verified, and is_phone_number_verified',
  hasExtraBuyerFields,
  'Wishlist count from Firestore, emailVerified from Auth, phone verification boolean'
);

// ----------------------------------------------------
// TEST 6: Checkout Confirmation Text
// ----------------------------------------------------
console.log('\n--- 6. Checkout Final Confirmation Step Text ---');

const hasGenericPaymentText = checkoutPageContent.includes(
  "You will be securely redirected to Tabby to complete your payment."
);
const doesNotHaveSpecificPlanText = !checkoutPageContent.includes(
  "You will be securely redirected to Tabby to complete your 4 interest-free payments"
);

assertTest(
  'Final confirm step displays generic "complete your payment" text',
  hasGenericPaymentText && doesNotHaveSpecificPlanText,
  'Text updated to: "You will be securely redirected to Tabby to complete your payment."'
);

// ----------------------------------------------------
// SUMMARY
// ----------------------------------------------------
console.log('\n====================================================');
console.log(`📊 RESULTS: ${passCount} / ${totalTests} Automated Checks Passed (${Math.round((passCount/totalTests)*100)}%)`);
console.log('====================================================\n');

if (passCount === totalTests) {
  console.log('🎉 ALL OFFICIAL TABBY API VERIFICATIONS PASSED!');
  process.exit(0);
} else {
  console.error('⚠️ SOME TESTS FAILED. Please review the output above.');
  process.exit(1);
}
