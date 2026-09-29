import { Resend } from "resend";

/**
 * Single seam for outbound email. With no API key configured, messages are
 * logged instead of sent, so both sending flows are exercisable locally.
 *
 * EMAIL POLICY (see templates.ts): exactly two things send - the results push
 * and the treasurer's unpaid batch. Both are explicit board clicks.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
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
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

