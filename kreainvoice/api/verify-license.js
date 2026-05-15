/**
 * Kreainvoice — Gumroad License Verification API
 * Vercel Serverless Function: /api/verify-license
 *
 * SETUP — Add these to Vercel → Project Settings → Environment Variables:
 *
 *   GUMROAD_PRODUCT_ID_NOIR      = AUI2HgxLraaakjSJ_6x9eg==
 *   GUMROAD_PRODUCT_ID_PHOTO     = 4Rvdj_HPQhYZGOOErIpTVw==
 *   GUMROAD_PRODUCT_ID_BRANDING  = 5pU4Ie5oDIKsreHNbLikGA==
 *
 * NOTE: Gumroad requires product_id (not product_permalink) for all products
 * created on or after Jan 9, 2023. Find the ID in the License Keys module
 * on each product's edit page in Gumroad.
 */

const PRODUCT_IDS = {
  noir:     process.env.GUMROAD_PRODUCT_ID_NOIR,
  photo:    process.env.GUMROAD_PRODUCT_ID_PHOTO,
  branding: process.env.GUMROAD_PRODUCT_ID_BRANDING,
};

const DEVICE_LIMIT = 3;
const GUMROAD_API  = 'https://api.gumroad.com/v2/licenses/verify';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { licenseKey, productId } = req.body || {};

  if (!licenseKey || typeof licenseKey !== 'string')
    return res.status(400).json({ success: false, error: 'Missing license key' });

  if (!productId || !PRODUCT_IDS[productId])
    return res.status(400).json({ success: false, error: 'Invalid product' });

  const cleanKey         = licenseKey.trim();
  const gumroadProductId = PRODUCT_IDS[productId];

  try {
    // Step 1: Peek — check uses count without incrementing
    const peekRes  = await callGumroad(cleanKey, gumroadProductId, false);
    const peekData = await peekRes.json();

    if (!peekData.success) {
      return res.status(200).json({
        success: false,
        error: friendlyError(peekData.message),
      });
    }

    const currentUses = peekData.uses || 0;

    // Step 2: Enforce device limit
    if (currentUses >= DEVICE_LIMIT) {
      return res.status(200).json({
        success: false,
        limitReached: true,
        uses: currentUses,
        error: `This license key has already been activated on ${DEVICE_LIMIT} devices — the maximum allowed. Email hello@kreainvoice.com if you need help.`,
      });
    }

    // Step 3: Increment — consume one activation slot
    const activateRes  = await callGumroad(cleanKey, gumroadProductId, true);
    const activateData = await activateRes.json();

    if (!activateData.success) {
      return res.status(200).json({
        success: false,
        error: 'Verification failed. Please try again.',
      });
    }

    const purchase = activateData.purchase || {};

    return res.status(200).json({
      success: true,
      productId,
      uses: activateData.uses,
      remaining: Math.max(0, DEVICE_LIMIT - activateData.uses),
      buyerEmail: purchase.email || null,
    });

  } catch (err) {
    console.error('[verify-license]', err);
    return res.status(500).json({
      success: false,
      error: 'Could not reach the verification server. Check your connection and try again.',
    });
  }
}

async function callGumroad(licenseKey, gumroadProductId, increment) {
  const body = new URLSearchParams({
    product_id:           gumroadProductId,
    license_key:          licenseKey,
    increment_uses_count: increment ? 'true' : 'false',
  });
  return fetch(GUMROAD_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
}

function friendlyError(raw) {
  const r = (raw || '').toLowerCase();
  if (r.includes('refunded'))
    return 'This key belongs to a refunded purchase.';
  if (r.includes('chargeback'))
    return 'This key belongs to a reversed payment.';
  if (r.includes('not found') || r.includes("doesn't exist"))
    return 'License key not found. Double-check the key from your Gumroad receipt.';
  return 'Invalid license key. Please check and try again.';
}
