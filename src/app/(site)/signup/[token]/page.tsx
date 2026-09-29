import { redirect } from "next/navigation";

/** Status and payment are one page now; this keeps links in sent emails working. */
export default async function SignupRedirect({ params }: { params: Promise<{ token: string }> }) {
  redirect(`/pay/${encodeURIComponent((await params).token)}`);
}
