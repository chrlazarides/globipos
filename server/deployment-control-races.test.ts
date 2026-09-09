import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deploymentWriteStillValid,
  type DeploymentWriteGuard,
} from "./deployment-control";

const checkedAt = new Date("2026-09-08T10:00:00.000Z");

function profile(overrides: Record<string, unknown> = {}) {
  return {
    customerDomain: "shop.example.com",
    posDomain: "pos.example.com",
    status: "draft" as const,
    domainStatus: "connected" as const,
    domainCheckedAt: checkedAt,
    ...overrides,
  };
}

const activationGuard: DeploymentWriteGuard = {
  customerDomain: "shop.example.com",
  posDomain: "pos.example.com",
  status: "draft",
  domainStatus: "connected",
  domainCheckedAt: checkedAt,
  eShopDomain: "web-shop.example.com",
  eShopDomainStatus: "connected",
  eShopDomainCheckedAt: checkedAt,
};

describe("deployment domain compare-and-set guards", () => {
  it("rejects a domain check result when the hostname changes in flight", () => {
    const checkGuard: DeploymentWriteGuard = {
      customerDomain: "shop.example.com",
      posDomain: "pos.example.com",
    };

    assert.equal(deploymentWriteStillValid(checkGuard, profile()), true);
    assert.equal(
      deploymentWriteStillValid(checkGuard, profile({
        customerDomain: "replacement.example.com",
        domainStatus: "pending",
        domainCheckedAt: null,
      })),
      false,
    );
  });

  it("prevents activation after a routing change commits first", () => {
    const afterRoutingChange = profile({
      customerDomain: "replacement.example.com",
      status: "draft",
      domainStatus: "pending",
      domainCheckedAt: null,
    });

    assert.equal(deploymentWriteStillValid(activationGuard, afterRoutingChange), false);
  });

  it("prevents a stale routing save after activation commits first", () => {
    const routingSaveGuard: DeploymentWriteGuard = {
      customerDomain: "shop.example.com",
      posDomain: "pos.example.com",
      status: "draft",
    };
    const afterActivation = profile({ status: "active" });

    assert.equal(deploymentWriteStillValid(routingSaveGuard, afterActivation), false);
  });

  it("prevents stale save-as-active from undoing a concurrent suspension", () => {
    const afterSuspension = profile({ status: "suspended" });

    assert.equal(deploymentWriteStillValid(activationGuard, afterSuspension), false);
  });

  it("requires a deliberate override when readiness evidence is stale", () => {
    const afterNewerFailedCheck = profile({
      domainStatus: "failed",
      domainCheckedAt: new Date("2026-09-08T10:05:00.000Z"),
    });

    assert.equal(deploymentWriteStillValid(activationGuard, afterNewerFailedCheck), false);

    const explicitOverrideGuard: DeploymentWriteGuard = {
      customerDomain: "shop.example.com",
      posDomain: "pos.example.com",
      status: "draft",
    };
    assert.equal(deploymentWriteStillValid(explicitOverrideGuard, afterNewerFailedCheck), true);
  });

  it("prevents activation when the e-shop readiness changes in flight", () => {
    assert.equal(deploymentWriteStillValid(activationGuard, profile({
      eShopDomain: "web-shop.example.com",
      eShopDomainStatus: "failed",
      eShopDomainCheckedAt: new Date("2026-09-08T10:05:00.000Z"),
    })), false);
  });
});