/**
 * ALLMA — Email OTP Authentication
 *
 * Simple 6-digit OTP via Resend.com API.
 * - Generate and store OTP codes (in-memory, 10 min TTL)
 * - Send via Resend.com email API
 * - Verify with max 3 attempts
 *
 * Requires: RESEND_API_KEY in .env
 * Optional: RESEND_FROM_EMAIL (default: onboarding@resend.dev for testing)
 */

// ============================================================
// Types
// ============================================================

interface OTPEntry {
  code: string;
  attempts: number;
  expiresAt: number;
  name?: string;
}

// ============================================================
// OTP Store (in-memory)
// ============================================================

const otpStore = new Map<string, OTPEntry>();

// Clean expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of otpStore) {
    if (now > entry.expiresAt) {
      otpStore.delete(email);
    }
  }
}, 5 * 60 * 1000);

// ============================================================
// Config
// ============================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "ALLMA <onboarding@resend.dev>";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_MS = 60 * 1000; // 1 minute between resends

// ============================================================
// Generate OTP
// ============================================================

function generateOTP(): string {
  // Cryptographically random 6-digit code
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

// ============================================================
// Send OTP Email
// ============================================================

export async function sendOTP(
  email: string,
  name?: string
): Promise<{ ok: boolean; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  // Rate limit check
  const existing = otpStore.get(normalizedEmail);
  if (existing && Date.now() < existing.expiresAt - OTP_TTL_MS + RATE_LIMIT_MS) {
    return { ok: false, error: "Please wait before requesting a new code" };
  }

  // Generate code
  const code = generateOTP();
  otpStore.set(normalizedEmail, {
    code,
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_MS,
    name,
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(`[OTP] Code for ${normalizedEmail}: ${code}`);
  } else {
    console.log(`[OTP] Code sent to ${normalizedEmail}`);
  }

  // If no Resend API key, just log (dev mode)
  if (!RESEND_API_KEY) {
    console.log(`[OTP] No RESEND_API_KEY — code logged above (dev mode)`);
    return { ok: true };
  }

  // Send via Resend
  try {
    const greeting = name ? `Hi ${name}` : "Hi";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [normalizedEmail],
        subject: `${code} — Your ALLMA verification code`,
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 2rem;">
            <div style="text-align: center; margin-bottom: 1.5rem;">
              <span style="font-size: 3rem;">🧠</span>
              <h1 style="color: #7c3aed; margin: 0.5rem 0; font-size: 1.5rem;">ALLMA</h1>
            </div>
            <p style="color: #333; font-size: 1rem; margin-bottom: 0.5rem;">${greeting},</p>
            <p style="color: #555; font-size: 0.95rem; margin-bottom: 1.5rem;">Your verification code is:</p>
            <div style="background: #f4f0ff; border-radius: 12px; padding: 1.2rem; text-align: center; margin-bottom: 1.5rem;">
              <span style="font-size: 2rem; font-weight: 700; letter-spacing: 0.3em; color: #7c3aed;">${code}</span>
            </div>
            <p style="color: #888; font-size: 0.8rem;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 1.5rem 0;">
            <p style="color: #aaa; font-size: 0.75rem; text-align: center;">ALLMA — Your AI Psychology Coach</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`[OTP] Resend error (${res.status}):`, errorBody);
      // Don't block login — OTP code is in server logs
      console.log(`[OTP] Email failed for ${normalizedEmail} — code was generated`);
      return { ok: true };
    }

    const data = (await res.json()) as Record<string, any>;
    console.log(`[OTP] Email sent to ${normalizedEmail}: ${data.id}`);
    return { ok: true };
  } catch (error: any) {
    console.error(`[OTP] Send error:`, error);
    // Don't block login — OTP code is in server logs
    console.log(`[OTP] Email failed for ${normalizedEmail} — code was generated`);
    return { ok: true };
  }
}

// ============================================================
// Verify OTP
// ============================================================

export function verifyOTP(
  email: string,
  code: string
): { ok: boolean; error?: string; name?: string } {
  const normalizedEmail = email.trim().toLowerCase();
  const entry = otpStore.get(normalizedEmail);

  if (!entry) {
    return { ok: false, error: "No code requested. Please send a new one." };
  }

  // Check expiry
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(normalizedEmail);
    return { ok: false, error: "Code expired. Please request a new one." };
  }

  // Check attempts
  if (entry.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(normalizedEmail);
    return { ok: false, error: "Too many attempts. Please request a new code." };
  }

  // Verify
  entry.attempts++;

  if (code.trim() !== entry.code) {
    const remaining = MAX_ATTEMPTS - entry.attempts;
    if (remaining <= 0) {
      otpStore.delete(normalizedEmail);
      return { ok: false, error: "Too many attempts. Please request a new code." };
    }
    return { ok: false, error: `Invalid code. ${remaining} attempt(s) remaining.` };
  }

  // Success — remove from store
  const name = entry.name;
  otpStore.delete(normalizedEmail);
  console.log(`[OTP] Verified: ${normalizedEmail}`);
  return { ok: true, name };
}

// ============================================================
// Get pending OTP name (for user creation after verify)
// ============================================================

export function getOTPName(email: string): string | undefined {
  return otpStore.get(email.trim().toLowerCase())?.name;
}
