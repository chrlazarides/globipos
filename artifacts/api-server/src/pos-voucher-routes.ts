import type { Express, Request, RequestHandler } from "express";
import { z } from "zod/v4";
import type { PosTerminal } from "@workspace/db";
import {
  issueCashGiftVoucher,
  issueVoucherReturn,
  matchesVoucherDeviceKey,
  previewVoucherReturn,
  redeemGiftVoucher,
  rotateVoucherDeviceKey,
  PosVoucherError,
} from "./pos-voucher-service";

type TerminalRequest = Request & { terminal?: PosTerminal };
type SavedSetting = { key: string; value: string | null };
type AssignedButton = { buttonType?: string; actionCode?: string | null };

const saleSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000),
  cashierId: z.string().min(1).max(128),
  pin: z.string().regex(/^\d{4,8}$/),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

const returnPreviewSchema = z.object({
  orderNumber: z.string().trim().min(1).max(128),
  cashierId: z.string().min(1).max(128),
  pin: z.string().regex(/^\d{4,8}$/),
}).strict();

const returnSchema = z.object({
  orderNumber: z.string().trim().min(1).max(128),
  lines: z.array(z.object({
    lineId: z.string().min(1).max(128),
    quantity: z.number().positive().max(100_000),
  }).strict()).min(1).max(200),
  cashierId: z.string().min(1).max(128),
  pin: z.string().regex(/^\d{4,8}$/),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

const redeemSchema = z.object({
  serial: z.string().min(1).max(80),
  lines: z.array(z.object({
    itemId: z.string().min(1).max(128),
    quantity: z.number().int().min(1).max(1_000),
  }).strict()).min(1).max(200),
  expectedTotalCents: z.number().int().positive().max(10_000_000),
  cashPaidCents: z.number().int().nonnegative().max(10_000_000),
  cashierId: z.string().min(1).max(128),
  pin: z.string().regex(/^\d{4,8}$/),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

function sendVoucherError(res: Parameters<RequestHandler>[1], error: unknown) {
  if (error instanceof PosVoucherError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ message: error.issues[0]?.message ?? "Invalid voucher request" });
    return;
  }
  res.status(500).json({ message: "Voucher request could not be completed" });
}

function terminalFromRequest(req: TerminalRequest): PosTerminal {
  if (!req.terminal) throw new PosVoucherError(403, "Terminal is not authorised");
  const { voucherDeviceKeyHash: _discard, ...terminal } = req.terminal;
  return terminal as PosTerminal;
}

export function approvedAssignedVoucherActions(
  buttons: AssignedButton[],
  settings: SavedSetting[],
): string[] {
  const assignedCodes = new Set(buttons
    .filter((button) => button.buttonType === "action")
    .map((button) => button.actionCode?.trim().toUpperCase())
    .filter((code): code is string => !!code));
  return ["GIFT_VOUCHER", "PAY_VOUCHER"].filter((code) => {
    if (!assignedCodes.has(code)) return false;
    const definition = settings.find((setting) => setting.key === `pos_function_definition_${code.toLowerCase()}`);
    if (!definition?.value) return false;
    try {
      return JSON.parse(definition.value).approved === true;
    } catch {
      return false;
    }
  });
}

export function registerPosVoucherRoutes(
  app: Express,
  requireTerminal: RequestHandler,
  requireAdmin: RequestHandler,
) {
  const preventVoucherCaching: RequestHandler = (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
    next();
  };
  const requireVoucherDeviceKey: RequestHandler = (rawReq, res, next) => {
    const req = rawReq as TerminalRequest;
    const terminal = req.terminal;
    const deviceKey = req.get("X-Voucher-Device-Key");
    if (!terminal || !matchesVoucherDeviceKey(terminal.voucherDeviceKeyHash, deviceKey)) {
      res.status(401).json({ message: "Voucher device key is missing or invalid" });
      return;
    }
    next();
  };

  app.post("/api/pos/vouchers/terminals/:id/pairing-key", requireAdmin, preventVoucherCaching, async (req, res) => {
    try {
      const deviceKey = await rotateVoucherDeviceKey(String(req.params.id ?? ""));
      res.status(200).json({ deviceKey });
    } catch (error) {
      sendVoucherError(res, error);
    }
  });

  app.post("/api/pos/vouchers/sale", preventVoucherCaching, requireTerminal, requireVoucherDeviceKey, async (rawReq, res) => {
    try {
      const req = rawReq as TerminalRequest;
      const body = saleSchema.parse(req.body);
      const result = await issueCashGiftVoucher({
        ...body,
        terminal: terminalFromRequest(req),
        remoteAddress: req.ip ?? "",
      });
      res.status(201).json(result);
    } catch (error) {
      sendVoucherError(res, error);
    }
  });

  app.post("/api/pos/vouchers/return-preview", preventVoucherCaching, requireTerminal, requireVoucherDeviceKey, async (rawReq, res) => {
    try {
      const req = rawReq as TerminalRequest;
      const body = returnPreviewSchema.parse(req.body);
      const result = await previewVoucherReturn({
        ...body,
        terminal: terminalFromRequest(req),
        remoteAddress: req.ip ?? "",
      });
      res.json(result);
    } catch (error) {
      sendVoucherError(res, error);
    }
  });

  app.post("/api/pos/vouchers/return", preventVoucherCaching, requireTerminal, requireVoucherDeviceKey, async (rawReq, res) => {
    try {
      const req = rawReq as TerminalRequest;
      const body = returnSchema.parse(req.body);
      const result = await issueVoucherReturn({
        ...body,
        terminal: terminalFromRequest(req),
        remoteAddress: req.ip ?? "",
      });
      res.status(201).json(result);
    } catch (error) {
      sendVoucherError(res, error);
    }
  });

  app.post("/api/pos/vouchers/redeem", preventVoucherCaching, requireTerminal, requireVoucherDeviceKey, async (rawReq, res) => {
    try {
      const req = rawReq as TerminalRequest;
      const body = redeemSchema.parse(req.body);
      const result = await redeemGiftVoucher({
        ...body,
        terminal: terminalFromRequest(req),
        remoteAddress: req.ip ?? "",
      });
      res.status(201).json(result);
    } catch (error) {
      sendVoucherError(res, error);
    }
  });
}