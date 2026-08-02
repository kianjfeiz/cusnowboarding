import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailVerifications, members, type Member } from "@/lib/db/schema";
import { sendEmail, verificationCodeEmail } from "@/lib/email/send";
import { rateLimit } from "@/lib/rate-limit";

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

export type StartResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" | "blocked" };

export type ConfirmResult =
  | { ok: true; member: Member }
  | {
      ok: false;
      reason: "no_code" | "expired" | "too_many_attempts" | "invalid_code" | "blocked";
    };

function hashCode(code: string): string {
  const pepper = process.env.VERIFY_PEPPER;
  if (!pepper) throw new Error("VERIFY_PEPPER is not set");
  return createHash("sha256").update(`${code}${pepper}`).digest("hex");
}

/** Uniform over 000000-999999; leading zeros are meaningful. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface StartVerificationInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  ip?: string | null;
  tripTitle?: string;
}

/**
 * Issues a verification code. All of the expensive and abusable work lives
 * here, days before a drop, rather than on the claim path.
 */
export async function startVerification(input: StartVerificationInput): Promise<StartResult> {
  const email = input.email.trim().toLowerCase();

  const perEmail = await rateLimit("verify-start-email", email, 3, 15 * 60);
  if (!perEmail.success) return { ok: false, reason: "rate_limited" };

  if (input.ip) {
    const perIp = await rateLimit("verify-start-ip", input.ip, 10, 60 * 60);
    if (!perIp.success) return { ok: false, reason: "rate_limited" };
  }

  // Upsert the member, but never downgrade an existing verification: a repeat
  // submission should refresh contact details, not un-verify someone.
  const [member] = await db
    .insert(members)
    .values({
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone: input.phone?.trim() || null,
      // They typed this name themselves, which is all "confirmed" means. The
      // welcome page after Google sign-in exists for members who never did.
      nameConfirmedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: members.email,
      set: {
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: sql`coalesce(${input.phone?.trim() || null}, ${members.phone})`,
        nameConfirmedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  if (member.isBlocked) return { ok: false, reason: "blocked" };

  const code = generateCode();
  await db.insert(emailVerifications).values({
    email,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    ip: input.ip ?? null,
  });

  const message = verificationCodeEmail(code, input.tripTitle);
  await sendEmail({ ...message, to: email });

  return { ok: true };
}

/**
 * Checks a code and, on success, marks the member verified. The caller is
 * responsible for issuing the cookie.
 */
export async function confirmVerification(
  emailInput: string,
  code: string,
): Promise<ConfirmResult> {
  const email = emailInput.trim().toLowerCase();

  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(and(eq(emailVerifications.email, email), isNull(emailVerifications.consumedAt)))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);

  if (!row) return { ok: false, reason: "no_code" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  // Count the attempt before comparing, so a crash mid-check cannot be used to
  // get unlimited guesses.
  await db
    .update(emailVerifications)
    .set({ attempts: row.attempts + 1 })
    .where(eq(emailVerifications.id, row.id));

  if (!constantTimeEquals(row.codeHash, hashCode(code.trim()))) {
    return { ok: false, reason: "invalid_code" };
  }

  await db
    .update(emailVerifications)
    .set({ consumedAt: new Date() })
    .where(eq(emailVerifications.id, row.id));

  const [member] = await db
    .update(members)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(members.email, email))
    .returning();

  if (!member) return { ok: false, reason: "no_code" };
  if (member.isBlocked) return { ok: false, reason: "blocked" };

  return { ok: true, member };
}

/** Verified, unblocked, and the token version still matches. */
export async function loadVerifiedMember(
  memberId: string,
  tokenVersion: number,
): Promise<Member | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.id, memberId),
        eq(members.tokenVersion, tokenVersion),
        eq(members.isBlocked, false),
        isNotNull(members.emailVerifiedAt),
      ),
    )
    .limit(1);

  return member ?? null;
}
