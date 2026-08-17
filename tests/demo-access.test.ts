import { describe, test, expect } from "vitest";
import { CAPABILITIES, can, type Actor } from "@/lib/authz";
import { DEMO_ACTOR, DEMO_EMAIL, isDemoActor, demoPasswordMatches } from "@/lib/demo";

/**
 * The demo visitor's board access is read-only, and nothing enforces that
 * per-action: it falls out of DEMO_ACTOR holding no roles. That makes it
 * exactly the kind of property a later edit breaks silently - granting the demo
 * a role to fix a blank screen would hand it every write that role carries.
 */
describe("demo board access", () => {
  test("every capability except viewRosters is refused", () => {
    const allowed = CAPABILITIES.filter((capability) => can(DEMO_ACTOR, capability));
    expect(allowed).toEqual(["viewRosters"]);
  });

  test("viewRosters is granted, so board listings still render", () => {
    expect(can(DEMO_ACTOR, "viewRosters")).toBe(true);
  });

  /*
    Superadmin short-circuits every capability check in `can`, so this flag is
    the single value that would turn the demo into a full board member.
  */
  test("the demo actor is not superadmin and holds no roles", () => {
    expect(DEMO_ACTOR.isSuperadmin).toBe(false);
    expect(DEMO_ACTOR.roles).toEqual([]);
  });

  /*
    Board mutations stamp actor.boardUserId into audit_events.actor_board_user_id,
    which is a uuid foreign key. A non-uuid is the backstop if a write ever gets
    past the capability gate: the insert fails rather than recording a demo
    visitor as a board member who acted.
  */
  test("the demo board user id is not a uuid", () => {
    expect(DEMO_ACTOR.boardUserId).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("isDemoActor recognises the demo and not a real board member", () => {
    expect(isDemoActor(DEMO_ACTOR)).toBe(true);
    expect(isDemoActor(null)).toBe(false);

    const real: Actor = {
      boardUserId: "00000000-0000-4000-8000-000000000000",
      email: "president@colorado.edu",
      name: "Club President",
      roles: ["president"],
      isSuperadmin: true,
    };
    expect(isDemoActor(real)).toBe(false);
    expect(real.email).not.toBe(DEMO_EMAIL);
  });
});

describe("demo password", () => {
  test("nothing matches while DEMO_PASSWORD is unset", () => {
    const previous = process.env.DEMO_PASSWORD;
    delete process.env.DEMO_PASSWORD;
    expect(demoPasswordMatches("")).toBe(false);
    expect(demoPasswordMatches("anything")).toBe(false);
    if (previous !== undefined) process.env.DEMO_PASSWORD = previous;
  });

  test("only the exact password matches", () => {
    const previous = process.env.DEMO_PASSWORD;
    process.env.DEMO_PASSWORD = "a-demo-password-value";
    expect(demoPasswordMatches("a-demo-password-value")).toBe(true);
    expect(demoPasswordMatches("a-demo-password-valu")).toBe(false);
    expect(demoPasswordMatches("A-Demo-Password-Value")).toBe(false);
    expect(demoPasswordMatches("")).toBe(false);
    if (previous === undefined) delete process.env.DEMO_PASSWORD;
    else process.env.DEMO_PASSWORD = previous;
  });
});
