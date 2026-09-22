import { expect, test } from "bun:test";
import { authEmailPolicy } from "./auth-email-policy.ts";
test("cloud runtime preserves captured verification when filesystem branch is removed", () => {
  expect(authEmailPolicy({ requireVerification: false, hasEmail: false }, { Email: {}, FLARESTACK_AUTH_REQUIRE_EMAIL_VERIFICATION: "true" })).toEqual({ requireEmailVerification: true, hasEmail: true });
});
test("cloud no-email policy survives a local design default", () => {
  expect(authEmailPolicy({ requireVerification: true, hasEmail: true }, { FLARESTACK_AUTH_REQUIRE_EMAIL_VERIFICATION: "false" })).toEqual({ requireEmailVerification: false, hasEmail: false });
});
test("verification fails closed without email binding or valid policy", () => {
  expect(() => authEmailPolicy({ requireVerification: true, hasEmail: false })).toThrow("Email verification requires");
  expect(() => authEmailPolicy({ requireVerification: false, hasEmail: false }, { FLARESTACK_AUTH_REQUIRE_EMAIL_VERIFICATION: "true" })).toThrow("Email verification requires");
  expect(() => authEmailPolicy({ requireVerification: false, hasEmail: false }, {})).toThrow("missing or invalid");
});
