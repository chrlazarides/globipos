import assert from "node:assert/strict";
import test from "node:test";
import { isEShopRequestHostname } from "./static";

test("storefront routing requires an exact configured hostname", () => {
  assert.equal(isEShopRequestHostname("web-acme.globipos.shop", "web-acme.globipos.shop"), true);
  assert.equal(isEShopRequestHostname("WEB-ACME.GLOBIPOS.SHOP", "web-acme.globipos.shop"), true);
  assert.equal(isEShopRequestHostname("web-other.globipos.shop", "web-acme.globipos.shop"), false);
  assert.equal(isEShopRequestHostname("acme.globipos.shop", "web-acme.globipos.shop"), false);
  assert.equal(isEShopRequestHostname("web-acme.globipos.shop", undefined), false);
});