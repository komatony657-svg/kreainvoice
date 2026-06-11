/**
 * Kreainvoice — Gumroad License Verification
 * Cloudflare Pages Function: /api/verify-license
 *
 * SETUP — Cloudflare Pages → Settings → Environment Variables:
 *   GUMROAD_PRODUCT_ID_NOIR      = AUI2HgxLraaakjSJ_6x9eg==
 *   GUMROAD_PRODUCT_ID_PHOTO     = 4Rvdj_HPQhYZGOOErIpTVw==
 *   GUMROAD_PRODUCT_ID_BRANDING  = 5pU4Ie5oDIKsreHNbLikGA==
 */

const DEVICE_LIMIT = 3;
const GUMROAD_API  = 'https://api.gumroad.com/v2/licenses/verify';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function callGumroad(licenseKey, productId, increment) {
  const body = new URLSearchParams({
    product_id:           productId,
    license_key:          licenseKey,
    increment_uses_count: increment ? 'true' : 'false',
  });
  const res = await fetch(GUMROAD_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  return res.json();
}

function friendlyError(raw) {
  const r = (raw || '').toLowerCase();
  if (r.includes('refunded'))    return 'This key belongs to a refunded purchase.';
  if (r.includes('chargeback'))  return 'This key belongs to a reversed payment.';
  if (r.includes('not found') || r.includes("doesn't exist"))
    return 'License key not found. Double-check the key from your Gumroad receipt.';
  return 'Invalid license key. Please check and try again.';
}

// ── Cloudflare Pages Functions export format ──────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  const PRODUCT_IDS = {
    noir:     env.GUMROAD_PRODUCT_ID_NOIR,
    photo:    env.GUMROAD_PRODUCT_ID_PHOTO,
    branding: env.GUMROAD_PRODUCT_ID_BRANDING,
  };

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid request body' }, 400);
  }

  const { licenseKey, productId } = body || {};

  if (!licenseKey || typeof licenseKey !== 'string')
    return json({ success: false, error: 'Missing license key' }, 400);

  if (!productId || !PRODUCT_IDS[productId])
    return json({ success: false, error: 'Invalid product' }, 400);

  const cleanKey         = licenseKey.trim();
  const gumroadProductId = PRODUCT_IDS[productId];

  try {
    // Step 1: Peek — check uses without incrementing
    const peekData = await callGumroad(cleanKey, gumroadProductId, false);

    if (!peekData.success)
      return json({ success: false, error: friendlyError(peekData.message) });

    const currentUses = peekData.uses || 0;

    // Step 2: Enforce device limit
    if (currentUses >= DEVICE_LIMIT) {
      return json({
        success:      false,
        limitReached: true,
        uses:         currentUses,
        error:        `This license key has been activated on ${DEVICE_LIMIT} devices already. Email hello@kreainvoice.com for help.`,
      });
    }

    // Step 3: Increment — consume one activation slot
    const activateData = await callGumroad(cleanKey, gumroadProductId, true);

    if (!activateData.success)
      return json({ success: false, error: 'Verification failed. Please try again.' });

    const purchase = activateData.purchase || {};

    return json({
      success:    true,
      productId,
      uses:       activateData.uses,
      remaining:  Math.max(0, DEVICE_LIMIT - activateData.uses),
      buyerEmail: purchase.email || null,
    });

  } catch (err) {
    console.error('[verify-license]', err);
    return json({
      success: false,
      error:   'Could not reach the verification server. Try again.',
    }, 500);
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
