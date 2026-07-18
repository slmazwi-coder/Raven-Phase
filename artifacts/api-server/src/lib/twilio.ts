import { logger } from "./logger";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

/** Returns true if Twilio credentials are configured */
export function twilioConfigured(): boolean {
  return !!(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER);
}

/**
 * Send an SMS via Twilio REST API (no SDK — uses native fetch).
 * If credentials are missing, logs a warning and returns the code for
 * local testing. In production, missing credentials will cause enrollment
 * to fail at the route level.
 */
export async function sendSms(
  to: string,
  body: string,
): Promise<{ ok: boolean; sid?: string; error?: string }> {
  if (!twilioConfigured()) {
    logger.warn(
      { to, body },
      "Twilio not configured — SMS not sent (dev mode)",
    );
    return { ok: false, error: "Twilio not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
  const credentials = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString(
    "base64",
  );
  const params = new URLSearchParams({ To: to, From: FROM_NUMBER!, Body: body });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const json = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok) {
      logger.error({ to, status: res.status, response: json }, "Twilio error");
      return { ok: false, error: json.message ?? "Twilio request failed" };
    }

    return { ok: true, sid: json.sid };
  } catch (err) {
    logger.error({ err, to }, "Failed to call Twilio API");
    return { ok: false, error: "Network error calling Twilio" };
  }
}

export async function sendOtpSms(
  to: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  return sendSms(to, `Your Raven verification code is: ${code}. It expires in 8 minutes.`);
}
