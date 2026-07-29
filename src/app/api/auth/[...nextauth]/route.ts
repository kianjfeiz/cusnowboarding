import { handlers } from "@/auth";

// The sign-in callback reads Postgres through node-postgres, so this route
// cannot run on the edge runtime.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
