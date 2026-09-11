import assert from "node:assert/strict";
import test from "node:test";
import {
  sign2faRecoveryToken,
  sign2faRecoverySetupToken,
  signTempToken,
  verify2faRecoveryToken,
  verifyTempToken,
  verifyToken,
} from "./auth";

test("2FA temporary tokens are restricted to their intended purpose", () => {
  const loginToken = signTempToken("user-1", "2fa-login");
  const setupToken = signTempToken("user-1", "2fa-setup");

  assert.equal(verifyTempToken(loginToken, "2fa-login"), "user-1");
  assert.equal(verifyTempToken(loginToken, "2fa-setup"), null);
  assert.equal(verifyTempToken(setupToken, "2fa-setup"), "user-1");
  assert.equal(verifyTempToken(setupToken, "2fa-login"), null);
});

test("2FA recovery tokens retain the bound user and challenge", () => {
  const token = sign2faRecoveryToken("user-1", "challenge-1");
  assert.deepEqual(verify2faRecoveryToken(token), {
    userId: "user-1",
    challengeId: "challenge-1",
  });
  assert.equal(verifyToken(token), null);
  assert.equal(verify2faRecoveryToken(`${token}invalid`), null);
});

test("2FA replacement setup tokens cannot authenticate as sessions", () => {
  const token = sign2faRecoverySetupToken("user-1", "grant-1", "SECRET");
  assert.equal(verifyToken(token), null);
});