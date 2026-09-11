import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function isEShopRequestHostname(requestHostname: string, configuredHostname?: string) {
  return !!configuredHostname
    && requestHostname.trim().toLowerCase() === configuredHostname.trim().toLowerCase();
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  const customerDistPath = path.resolve(__dirname, "customer-public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const eShopHostname = process.env.CUSTOMER_ESHOP_HOSTNAME?.trim().toLowerCase();
  if (eShopHostname) {
    if (!fs.existsSync(customerDistPath)) {
      throw new Error(`Could not find the customer app build directory: ${customerDistPath}`);
    }
    const eShopRouter = express.Router();
    eShopRouter.use(express.static(customerDistPath, { index: false }));
    eShopRouter.use("/{*path}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(path.resolve(customerDistPath, "index.html"));
    });
    app.use((req, res, next) => {
      const requestHostname = req.hostname.toLowerCase();
      if (!isEShopRequestHostname(requestHostname, eShopHostname)) return next();
      return eShopRouter(req, res, next);
    });
  }

  // Serve hashed assets with long cache lifetime
  app.use(express.static(distPath, { index: false }));

  // Always serve index.html with no-cache so browsers pick up new deployments
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
