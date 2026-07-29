import { Resend } from "resend";

/**
 * Single seam for outbound email. Swapping Resend for Postmark (or anything
 * else) should mean editing only this file.
 *
 * With no API key configured, messages are logged instead of sent, so the
 * verification flow is fully exercisable locally without a provider account.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "CU Snowboarding <noreply@localhost>";
const resend = apiKey ? new Resend(apiKey) : null;

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!resend) {
    console.log(
      [
        "",
        "--- email (no RESEND_API_KEY, not sent) ---",
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        "",
        message.text,
        "------------------------------------------",
        "",
      ].join("\n"),
    );
    return;
  }

  const { error } = await resend.emails.send({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

export function verificationCodeEmail(code: string, tripTitle?: string): EmailMessage {
  const context = tripTitle
    ? `You are verifying your email so you can sign up for ${tripTitle}.`
    : "You are verifying your email for CU Snowboarding trip signups.";

  return {
    to: "",
    subject: `Your verification code: ${code}`,
    text: [
      context,
      "",
      `Code: ${code}`,
      "",
      "This code expires in 15 minutes.",
      "",
      "Verify before signups open. Once verified, claiming a spot is a single",
      "click, and you will not be asked for a code at signup time.",
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
  };
}
