import ExcelJS from "exceljs";
import crypto from "crypto";
import { db, pool } from "../server/db";
import { customers, suppliers, customerLoyaltyPoints } from "../shared/schema";
import { eq, inArray, sql } from "drizzle-orm";

const workbookPath = process.argv.find(arg => arg.endsWith(".xlsx"));
const apply = process.argv.includes("--apply");
if (!workbookPath) {
  throw new Error("Usage: tsx script/import-swiftpos-suppliers-members.ts <workbook.xlsx> [--apply]");
}

const clean = (value: unknown) => {
  const text = value == null ? "" : String(value).trim();
  return /^null$/i.test(text) ? "" : text;
};
const boolValue = (value: unknown, fallback = true) => {
  const text = clean(value).toLowerCase();
  if (!text) return fallback;
  return !["0", "false", "no", "inactive"].includes(text);
};
const deterministicId = (prefix: string, code: string) =>
  `${prefix}-${crypto.createHash("sha256").update(code).digest("hex").slice(0, 24)}`;
const roundedPoints = (value: unknown) => {
  const number = Number(clean(value) || 0);
  if (!Number.isFinite(number)) throw new Error(`Invalid points value: ${value}`);
  return Math.sign(number) * Math.round(Math.abs(number));
};

type Row = Record<string, unknown>;
async function readSelectedSheets(path: string) {
  const selected: Record<string, Row[]> = { Suppliers: [], Members: [] };
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    entries: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
  });
  for await (const worksheet of reader) {
    if (!(worksheet.name in selected)) continue;
    let headers: string[] = [];
    for await (const row of worksheet) {
      const values = (row.values as unknown[]).slice(1);
      if (!headers.length) {
        headers = values.map(value => clean(value));
        continue;
      }
      const record: Row = {};
      headers.forEach((header, index) => { if (header) record[header] = values[index]; });
      selected[worksheet.name].push(record);
    }
  }
  return selected;
}

function supplierRecord(row: Row) {
  const code = clean(row.Supplier_ID).toUpperCase();
  const name = clean(row.Supplier_Name) || `Supplier ${code}`;
  if (!code) throw new Error("Supplier_ID is required");
  return {
    id: deterministicId("swiftpos-supplier", code),
    code,
    name,
    contactPerson: clean(row.Contact) || null,
    email: clean(row.SuppeMail) || null,
    phone: clean(row.Phone) || clean(row.SuppMobile) || null,
    address: [row.Address1, row.Address2, row.Address3].map(clean).filter(Boolean).join(", ") || null,
    city: clean(row.State) || null,
    country: "Cyprus",
    taxId: clean(row.SuppABN) || null,
    paymentTerms: "cash",
    currentBalance: "0",
    notes: clean(row.SupplierNotes) || null,
    active: boolValue(row.Active),
  };
}

function memberRecord(row: Row) {
  const legacyNumber = clean(row.Member_Number);
  if (!legacyNumber) throw new Error("Member_Number is required");
  const code = `SWP-${legacyNumber}`.toUpperCase();
  const firstName = [row.Member_Firstname, row.Member_SecondName].map(clean).filter(Boolean).join(" ");
  const lastName = clean(row.Member_Surname);
  const name = [firstName, lastName].filter(Boolean).join(" ") || `Member ${legacyNumber}`;
  const priceLevelRaw = Number(clean(row.Member_Price_Level));
  return {
    legacyNumber,
    points: roundedPoints(row.Member_Points),
    customer: {
      id: deterministicId("swiftpos-member", legacyNumber),
      code,
      name,
      contactFirstName: firstName || null,
      contactLastName: lastName || null,
      email: clean(row.Member_Internet_Address) || null,
      phone: clean(row.Member_Mobile) || clean(row.Member_Home_Phone) || clean(row.Member_Business_Phone) || null,
      address: [row.Member_Address1, row.Member_Address2, row.Member_Address3].map(clean).filter(Boolean).join(", ") || null,
      city: clean(row.Member_State) || null,
      taxId: clean(row.MemberABN) || null,
      paymentTerms: "cash",
      creditLimit: "0",
      currentBalance: "0",
      openingBalance: "0",
      priceLevel: Number.isInteger(priceLevelRaw) && priceLevelRaw > 0 ? priceLevelRaw : 1,
      notes: clean(row.Internal_Notes) || null,
      location: clean(row.Member_Country) || null,
      active: boolValue(row.Account_Active),
      cashbackBalance: "0",
    },
  };
}

const sheets = await readSelectedSheets(workbookPath);
const supplierRows = sheets.Suppliers.map(supplierRecord);
const memberRows = sheets.Members.map(memberRecord);
const requiredSupplierHeaders = ["Supplier_ID", "Supplier_Name", "Active"];
const requiredMemberHeaders = ["Member_Number", "Member_Firstname", "Member_Surname", "Member_Points", "Account_Active"];
for (const header of requiredSupplierHeaders) {
  if (!sheets.Suppliers[0] || !(header in sheets.Suppliers[0])) throw new Error(`Suppliers sheet is missing required header: ${header}`);
}
for (const header of requiredMemberHeaders) {
  if (!sheets.Members[0] || !(header in sheets.Members[0])) throw new Error(`Members sheet is missing required header: ${header}`);
}
const supplierCodes = new Set(supplierRows.map(row => row.code));
const memberCodes = new Set(memberRows.map(row => row.customer.code));
if (supplierCodes.size !== supplierRows.length) throw new Error("Duplicate Supplier_ID values found");
if (memberCodes.size !== memberRows.length) throw new Error("Duplicate Member_Number values found");

const summary = {
  mode: apply ? "apply" : "dry-run",
  suppliers: supplierRows.length,
  members: memberRows.length,
  positivePointBalances: memberRows.filter(row => row.points > 0).length,
  negativePointBalances: memberRows.filter(row => row.points < 0).length,
  zeroPointBalances: memberRows.filter(row => row.points === 0).length,
  roundedPointTotal: memberRows.reduce((sum, row) => sum + row.points, 0),
};
if (summary.suppliers !== 708 || summary.members !== 5970 || summary.roundedPointTotal !== 6210548) {
  throw new Error(`Workbook does not match the approved export invariants: ${JSON.stringify(summary)}`);
}

if (apply) {
  try {
    await db.transaction(async tx => {
      const [existingSuppliers, existingMembers] = await Promise.all([
        tx.select({ id: suppliers.id, code: suppliers.code }).from(suppliers).where(inArray(suppliers.code, [...supplierCodes])),
        tx.select({ id: customers.id, code: customers.code }).from(customers).where(inArray(customers.code, [...memberCodes])),
      ]);
      const supplierIdByCode = new Map(supplierRows.map(row => [row.code, row.id]));
      const memberIdByCode = new Map(memberRows.map(row => [row.customer.code, row.customer.id]));
      const supplierConflicts = existingSuppliers.filter(row => supplierIdByCode.get(row.code) !== row.id);
      const memberConflicts = existingMembers.filter(row => memberIdByCode.get(row.code) !== row.id);
      if (supplierConflicts.length || memberConflicts.length) {
        throw new Error(`Existing code conflicts detected (suppliers=${supplierConflicts.length}, members=${memberConflicts.length}); no data was changed`);
      }

      for (let offset = 0; offset < supplierRows.length; offset += 500) {
      const chunk = supplierRows.slice(offset, offset + 500);
      await tx.insert(suppliers).values(chunk).onConflictDoUpdate({
        target: suppliers.code,
        setWhere: sql`${suppliers.id} = excluded.id`,
        set: {
          name: sql`excluded.name`,
          contactPerson: sql`coalesce(excluded.contact_person, ${suppliers.contactPerson})`,
          email: sql`coalesce(excluded.email, ${suppliers.email})`,
          phone: sql`coalesce(excluded.phone, ${suppliers.phone})`,
          address: sql`coalesce(excluded.address, ${suppliers.address})`,
          city: sql`coalesce(excluded.city, ${suppliers.city})`,
          country: sql`coalesce(excluded.country, ${suppliers.country})`,
          taxId: sql`coalesce(excluded.tax_id, ${suppliers.taxId})`,
          notes: sql`coalesce(excluded.notes, ${suppliers.notes})`,
          active: sql`excluded.active`,
        },
      });
      }
      for (let offset = 0; offset < memberRows.length; offset += 500) {
      const chunk = memberRows.slice(offset, offset + 500).map(row => row.customer);
      await tx.insert(customers).values(chunk).onConflictDoUpdate({
        target: customers.code,
        setWhere: sql`${customers.id} = excluded.id`,
        set: {
          name: sql`excluded.name`,
          contactFirstName: sql`coalesce(excluded.contact_first_name, ${customers.contactFirstName})`,
          contactLastName: sql`coalesce(excluded.contact_last_name, ${customers.contactLastName})`,
          email: sql`coalesce(excluded.email, ${customers.email})`,
          phone: sql`coalesce(excluded.phone, ${customers.phone})`,
          address: sql`coalesce(excluded.address, ${customers.address})`,
          city: sql`coalesce(excluded.city, ${customers.city})`,
          taxId: sql`coalesce(excluded.tax_id, ${customers.taxId})`,
          notes: sql`coalesce(excluded.notes, ${customers.notes})`,
          location: sql`coalesce(excluded.location, ${customers.location})`,
          priceLevel: sql`excluded.price_level`,
          active: sql`excluded.active`,
        },
      });
      }
      const [resolvedSuppliers, importedCustomers] = await Promise.all([
        tx.select({ id: suppliers.id, code: suppliers.code })
          .from(suppliers)
          .where(inArray(suppliers.code, [...supplierCodes])),
        tx.select({ id: customers.id, code: customers.code })
          .from(customers)
          .where(inArray(customers.code, [...memberCodes])),
      ]);
      if (
        resolvedSuppliers.length !== supplierRows.length ||
        resolvedSuppliers.some(row => supplierIdByCode.get(row.code) !== row.id)
      ) {
        throw new Error("Supplier identity changed during import; no data was changed");
      }
      if (
        importedCustomers.length !== memberRows.length ||
        importedCustomers.some(row => memberIdByCode.get(row.code) !== row.id)
      ) {
        throw new Error("Member identity changed during import; no data was changed");
      }
    const customerByCode = new Map(importedCustomers.map(row => [row.code, row.id]));
    if (customerByCode.size !== memberRows.length) throw new Error("Not every SwiftPOS member resolved to a customer");

      const pointRows = memberRows.map(row => ({
      customerId: customerByCode.get(row.customer.code)!,
      points: row.points,
      type: "adjust",
      reason: "SwiftPOS opening loyalty balance",
      sourceType: "swiftpos_member_opening_balance",
      sourceId: `swiftpos-member:${row.legacyNumber}`,
    }));
      for (let offset = 0; offset < pointRows.length; offset += 500) {
      const chunk = pointRows.slice(offset, offset + 500);
        await tx.insert(customerLoyaltyPoints).values(chunk).onConflictDoUpdate({
          target: [customerLoyaltyPoints.sourceType, customerLoyaltyPoints.sourceId],
          targetWhere: sql`${customerLoyaltyPoints.sourceType} is not null and ${customerLoyaltyPoints.sourceId} is not null`,
          set: {
            customerId: sql`excluded.customer_id`,
            points: sql`excluded.points`,
            type: "adjust",
            reason: "SwiftPOS opening loyalty balance",
          },
        });
      }
    });
  } finally {
    await pool.end();
  }
}

console.log(JSON.stringify(summary, null, 2));