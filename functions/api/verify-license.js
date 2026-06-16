/**
 * Kreainvoice a — Gumroad License Verification
 * Cloudflare Pages Function: /api/verify-license
 *
 * Environment Variables (set in Cloudflare Pages → Settings):
 *   GUMROAD_PRODUCT_ID_NOIR      = AUI2HgxLraaakjSJ_6x9eg==
 *   GUMROAD_PRODUCT_ID_PHOTO     = 4Rvdj_HPQhYZGOOErIpTVw==
 *   GUMROAD_PRODUCT_ID_BRANDING  = 5pU4Ie5oDIKsreHNbLikGA==
 */

const DEVICE_LIMIT = 3;
const GUMROAD_API  = 'https://api.gumroad.com/v2/licenses/verify';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

function makeResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status:  status || 200,
    headers: CORS_HEADERS,
  });
}

async function verifyWithGumroad(licenseKey, productId, increment) {
  const params = new URLSearchParams();
  params.append('product_id',           productId);
  params.append('license_key',          licenseKey);
  params.append('increment_uses_count', increment ? 'true' : 'false');

  const response = await fetch(GUMROAD_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });

  return response.json();
}

function getFriendlyError(message) {
  const msg = (message || '').toLowerCase();
  if (msg.indexOf('refunded') !== -1)
    return 'This key belongs to a refunded purchase.';
  if (msg.indexOf('chargeback') !== -1)
    return 'This key belongs to a reversed payment.';
  if (msg.indexOf('not found') !== -1 || msg.indexOf("doesn't exist") !== -1)
    return 'License key not found. Double-check the key from your Gumroad receipt.';
  return 'Invalid license key. Please check and try again.';
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status:  204,
    headers: CORS_HEADERS,
  });
}

// Handle POST requests
export async function onRequestPost(context) {
  const { request, env } = context;

  const PRODUCT_IDS = {
    noir:     env.GUMROAD_PRODUCT_ID_NOIR,
    photo:    env.GUMROAD_PRODUCT_ID_PHOTO,
    branding: env.GUMROAD_PRODUCT_ID_BRANDING,
  };

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return makeResponse({ success: false, error: 'Invalid request body' }, 400);
  }

  const licenseKey = body && body.licenseKey;
  const productId  = body && body.productId;

  if (!licenseKey || typeof licenseKey !== 'string') {
    return makeResponse({ success: false, error: 'Missing license key' }, 400);
  }

  if (!productId || !PRODUCT_IDS[productId]) {
    return makeResponse({ success: false, error: 'Invalid product' }, 400);
  }

  const cleanKey         = licenseKey.trim();
  const gumroadProductId = PRODUCT_IDS[productId];

  try {
    // Step 1: Peek — check uses count without incrementing
    const peekData = await verifyWithGumroad(cleanKey, gumroadProductId, false);

    if (!peekData.success) {
      return makeResponse({
        success: false,
        error:   getFriendlyError(peekData.message),
      });
    }

    const currentUses = peekData.uses || 0;

    // Step 2: Enforce device limit
    if (currentUses >= DEVICE_LIMIT) {
      return makeResponse({
        success:      false,
        limitReached: true,
        uses:         currentUses,
        error:        'This license key has been activated on ' + DEVICE_LIMIT + ' devices already. Email hello@kreainvoice.com for help.',
      });
    }

    // Step 3: Increment — consume one activation slot
    const activateData = await verifyWithGumroad(cleanKey, gumroadProductId, true);

    if (!activateData.success) {
      return makeResponse({
        success: false,
        error:   'Verification failed. Please try again.',
      });
    }

    const purchase = activateData.purchase || {};

    return makeResponse({
      success:    true,
      productId:  productId,
      uses:       activateData.uses,
      remaining:  Math.max(0, DEVICE_LIMIT - activateData.uses),
      buyerEmail: purchase.email || null,
    });

  } catch (err) {
    return makeResponse({
      success: false,
      error:   'Could not reach the verification server. Check your connection and try again.',
    }, 500);
  }
}
