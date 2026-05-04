import { db } from "./db";
import { categories, items, customers, priceContracts, seasonalOffers, invoices, invoiceItems, systemSettings, users } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";
import { hashPassword } from "./auth";

const DEFAULT_SETTINGS = [
  { key: "company_name", value: "FC GASTRONOBILE LTD", label: "Company Name", group: "company" },
  { key: "company_address", value: "Georgiou Pilatou 11, 5510, Famagusta, Cyprus", label: "Company Address", group: "company" },
  { key: "company_phone", value: "", label: "Company Phone", group: "company" },
  { key: "company_email", value: "gastronobile@gmail.com", label: "Company Email", group: "company" },
  { key: "company_tax_id", value: "CY60323722T", label: "Company Tax ID (TIN)", group: "company" },
  { key: "company_reg_no", value: "HE 487597", label: "Company Registration No.", group: "company" },
  { key: "company_iban", value: "", label: "Bank IBAN", group: "company" },
  { key: "company_swift", value: "", label: "Bank SWIFT/BIC", group: "company" },
  { key: "company_bank_name", value: "", label: "Bank Name", group: "company" },
  { key: "vat_rate", value: "19", label: "Default VAT Rate (%)", group: "tax" },
  { key: "currency", value: "EUR", label: "Currency", group: "tax" },
  { key: "currency_symbol", value: "€", label: "Currency Symbol", group: "tax" },
  { key: "invoice_prefix", value: "INV", label: "Invoice Number Prefix", group: "invoicing" },
  { key: "credit_note_prefix", value: "CN", label: "Credit Note Number Prefix", group: "invoicing" },
  { key: "proforma_prefix", value: "PF", label: "Proforma Number Prefix", group: "invoicing" },
  { key: "invoice_footer", value: "Thank you for your business", label: "Invoice Footer Message", group: "invoicing" },
  { key: "payment_terms_default", value: "cash", label: "Default Payment Terms", group: "invoicing" },
  { key: "price_level_1", value: "Price Level 1", label: "Price Level 1 Name", group: "pricing" },
  { key: "price_level_2", value: "Price Level 2", label: "Price Level 2 Name", group: "pricing" },
  { key: "price_level_3", value: "Price Level 3", label: "Price Level 3 Name", group: "pricing" },
  { key: "price_level_4", value: "Price Level 4", label: "Price Level 4 Name", group: "pricing" },
  { key: "price_level_5", value: "Price Level 5", label: "Price Level 5 Name", group: "pricing" },
  { key: "low_stock_threshold", value: "10", label: "Low Stock Alert Threshold", group: "inventory" },
  { key: "portal_enabled", value: "true", label: "Customer Portal Enabled", group: "portal" },
  { key: "portal_allow_ordering", value: "true", label: "Allow Portal Ordering", group: "portal" },
  { key: "settings_password", value: "", label: "Settings Password Hash", group: "security" },
  { key: "backup_email", value: "", label: "Backup Email Address", group: "backup" },
  { key: "backup_auto", value: "true", label: "Automatic Daily Backup", group: "backup" },
  { key: "backup_last_date", value: "", label: "Last Backup Date", group: "backup" },
];

// Known stale/wrong company names that should be reset to default
const INVALID_COMPANY_NAMES = ["ALBANIA POWER", "Demo Company", "Test Company", "Your Company Name", "VINERIA DI MARE Trading"];

export async function ensureDefaultSettings() {
  try {
    // Fix known bad company names
    const [nameSetting] = await db.select().from(systemSettings).where(eq(systemSettings.key, "company_name"));
    if (nameSetting && INVALID_COMPANY_NAMES.includes(nameSetting.value)) {
      console.log(`Resetting invalid company name "${nameSetting.value}" to default`);
      await db.update(systemSettings)
        .set({ value: "FC GASTRONOBILE LTD" })
        .where(eq(systemSettings.key, "company_name"));
    }

    // Ensure all required settings exist (insert only if missing)
    for (const setting of DEFAULT_SETTINGS) {
      const existing = await db.select({ id: systemSettings.id })
        .from(systemSettings)
        .where(eq(systemSettings.key, setting.key));
      if (existing.length === 0) {
        await db.insert(systemSettings).values({
          key: setting.key,
          value: setting.value,
          label: setting.label,
          group: setting.group,
        });
      }
    }

    // Enable automatic backup if it was at the old "false" default
    const backupAutoSetting = await db.select().from(systemSettings).where(eq(systemSettings.key, "backup_auto"));
    if (backupAutoSetting.length > 0 && backupAutoSetting[0].value === "false") {
      console.log("Enabling automatic daily backup");
      await db.update(systemSettings).set({ value: "true" }).where(eq(systemSettings.key, "backup_auto"));
    }

    // Ensure at least one active admin user exists
    const activeAdmins = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true)));
    if (activeAdmins.length === 0) {
      // Try to reactivate an existing admin user first
      const [existingAdmin] = await db.select().from(users).where(eq(users.username, "admin"));
      if (existingAdmin) {
        await db.update(users)
          .set({ active: true, password: hashPassword("Cplgroup!691") })
          .where(eq(users.username, "admin"));
        console.log("Reactivated admin user with reset password");
      } else {
        await db.insert(users).values({
          username: "admin",
          email: "admin@vintrade.com",
          password: hashPassword("Cplgroup!691"),
          role: "admin",
          active: true,
        });
        console.log("Created default admin user");
      }
    }
  } catch (e) {
    console.error("ensureDefaultSettings error:", e);
  }
}

export async function seedDatabase() {
  const [existingCats] = await db.select({ count: sql<number>`count(*)` }).from(categories);
  if ((existingCats?.count || 0) > 0) return;

  console.log("Seeding database...");

  const [redWine] = await db.insert(categories).values({ name: "Red Wine", description: "Premium red wines from top vineyards" }).returning();
  const [whiteWine] = await db.insert(categories).values({ name: "White Wine", description: "Crisp and refreshing white wines" }).returning();
  const [sparkling] = await db.insert(categories).values({ name: "Sparkling", description: "Champagnes and sparkling wines" }).returning();
  const [spirits] = await db.insert(categories).values({ name: "Spirits", description: "Premium spirits and liquors" }).returning();
  const [rose] = await db.insert(categories).values({ name: "Rosé", description: "Light and fruity rosé wines" }).returning();

  const seedItems = [
    { name: "Château Margaux 2018", sku: "RW-001", barcode: "3401234567890", categoryId: redWine.id, unitType: "bottle", packSize: 1, price1: "189.99", price2: "179.99", price3: "169.99", price4: "159.99", price5: "149.99", costPrice: "120.00", stockQuantity: 48, reorderLevel: 12, volume: "750ml", alcoholPercentage: "13.5", origin: "Bordeaux, France", vintage: "2018" },
    { name: "Opus One 2019", sku: "RW-002", barcode: "3401234567891", categoryId: redWine.id, unitType: "bottle", packSize: 1, price1: "399.99", price2: "379.99", price3: "359.99", price4: "339.99", price5: "319.99", costPrice: "250.00", stockQuantity: 24, reorderLevel: 6, volume: "750ml", alcoholPercentage: "14.5", origin: "Napa Valley, USA", vintage: "2019" },
    { name: "Penfolds Grange 2017", sku: "RW-003", barcode: "3401234567892", categoryId: redWine.id, unitType: "pack", packSize: 6, price1: "2100.00", price2: "1999.00", price3: "1899.00", price4: "1799.00", price5: "1699.00", costPrice: "1400.00", stockQuantity: 8, reorderLevel: 4, volume: "750ml", alcoholPercentage: "14.1", origin: "South Australia", vintage: "2017" },
    { name: "Cloudy Bay Sauvignon Blanc", sku: "WW-001", barcode: "3401234567893", categoryId: whiteWine.id, unitType: "pack", packSize: 12, price1: "288.00", price2: "276.00", price3: "264.00", price4: "252.00", price5: "240.00", costPrice: "180.00", stockQuantity: 120, reorderLevel: 24, volume: "750ml", alcoholPercentage: "13.0", origin: "Marlborough, NZ", vintage: "2023" },
    { name: "Chablis Premier Cru 2021", sku: "WW-002", barcode: "3401234567894", categoryId: whiteWine.id, unitType: "bottle", packSize: 1, price1: "45.99", price2: "42.99", price3: "39.99", price4: "37.99", price5: "35.99", costPrice: "28.00", stockQuantity: 72, reorderLevel: 18, volume: "750ml", alcoholPercentage: "12.5", origin: "Burgundy, France", vintage: "2021" },
    { name: "Dom Pérignon 2013", sku: "SP-001", barcode: "3401234567895", categoryId: sparkling.id, unitType: "bottle", packSize: 1, price1: "249.99", price2: "239.99", price3: "229.99", price4: "219.99", price5: "209.99", costPrice: "170.00", stockQuantity: 18, reorderLevel: 6, volume: "750ml", alcoholPercentage: "12.5", origin: "Champagne, France", vintage: "2013" },
    { name: "Veuve Clicquot Yellow Label", sku: "SP-002", barcode: "3401234567896", categoryId: sparkling.id, unitType: "pack", packSize: 6, price1: "360.00", price2: "342.00", price3: "324.00", price4: "306.00", price5: "288.00", costPrice: "240.00", stockQuantity: 36, reorderLevel: 12, volume: "750ml", alcoholPercentage: "12.0", origin: "Champagne, France", vintage: "NV" },
    { name: "Macallan 18 Year", sku: "SP-003", barcode: "3401234567897", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "329.99", price2: "319.99", price3: "309.99", price4: "299.99", price5: "289.99", costPrice: "220.00", stockQuantity: 15, reorderLevel: 5, volume: "700ml", alcoholPercentage: "43.0", origin: "Scotland", vintage: "" },
    { name: "Hennessy XO Cognac", sku: "SP-004", barcode: "3401234567898", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "199.99", price2: "189.99", price3: "179.99", price4: "169.99", price5: "159.99", costPrice: "130.00", stockQuantity: 5, reorderLevel: 8, volume: "700ml", alcoholPercentage: "40.0", origin: "Cognac, France", vintage: "" },
    { name: "Whispering Angel Rosé 2023", sku: "RS-001", barcode: "3401234567899", categoryId: rose.id, unitType: "pack", packSize: 12, price1: "240.00", price2: "228.00", price3: "216.00", price4: "204.00", price5: "192.00", costPrice: "150.00", stockQuantity: 96, reorderLevel: 24, volume: "750ml", alcoholPercentage: "13.0", origin: "Provence, France", vintage: "2023" },
  ];

  const createdItems = await db.insert(items).values(seedItems).returning();

  const seedCustomers = [
    { name: "Limassol Wine House", code: "CUST001", email: "orders@limassolwinehouse.com.cy", phone: "+357-25-123456", address: "15 Makarios Avenue", city: "Limassol", taxId: "CY-123456789", paymentTerms: "credit_30", creditLimit: "50000", currentBalance: "0", priceLevel: 1, portalAccessCode: "WINE2026" },
    { name: "Nicosia Grand Hotel", code: "CUST002", email: "purchasing@nicosiagrand.com.cy", phone: "+357-22-234567", address: "28 Ledra Street", city: "Nicosia", taxId: "CY-234567890", paymentTerms: "credit_14", creditLimit: "25000", currentBalance: "0", priceLevel: 2, portalAccessCode: "HOTEL2026" },
    { name: "Paphos Beach Resort", code: "CUST003", email: "procurement@paphosbeach.com.cy", phone: "+357-26-345678", address: "42 Poseidonos Avenue", city: "Paphos", taxId: "CY-345678901", paymentTerms: "cash", creditLimit: "0", currentBalance: "0", priceLevel: 3, portalAccessCode: "RESORT26" },
    { name: "Larnaca Spirits Trading", code: "CUST004", email: "wine@larnacaspirits.com.cy", phone: "+357-24-456789", address: "7 Athinon Avenue", city: "Larnaca", taxId: "CY-456789012", paymentTerms: "credit_60", creditLimit: "100000", currentBalance: "0", priceLevel: 1, portalAccessCode: "TRADE2026" },
    { name: "Troodos Mountain Lodge", code: "CUST005", email: "orders@troodoslodge.com.cy", phone: "+357-25-567890", address: "3 Platres Hill Road", city: "Platres", taxId: "CY-567890123", paymentTerms: "credit_30", creditLimit: "35000", currentBalance: "0", priceLevel: 2, portalAccessCode: "LODGE2026" },
  ];

  const createdCustomers = await db.insert(customers).values(seedCustomers).returning();

  // Create some invoices
  const inv1Items = [
    { description: "Château Margaux 2018", quantity: 6, unitPrice: "189.99", discount: "0", total: "1139.94", itemId: createdItems[0].id },
    { description: "Cloudy Bay Sauvignon Blanc 12-pack", quantity: 2, unitPrice: "288.00", discount: "0", total: "576.00", itemId: createdItems[3].id },
  ];
  const inv1Subtotal = 1715.94;
  const inv1Tax = inv1Subtotal * 0.19;
  const [inv1] = await db.insert(invoices).values({
    invoiceNumber: "INV-00001", type: "invoice", customerId: createdCustomers[0].id,
    date: "2026-02-10", dueDate: "2026-03-12", subtotal: inv1Subtotal.toFixed(2),
    taxRate: "19", taxAmount: inv1Tax.toFixed(2), discountAmount: "0", total: (inv1Subtotal + inv1Tax).toFixed(2), status: "sent",
  }).returning();
  await db.insert(invoiceItems).values(inv1Items.map(li => ({ ...li, invoiceId: inv1.id })));

  const inv2Items = [
    { description: "Dom Pérignon 2013", quantity: 12, unitPrice: "239.99", discount: "50.00", total: "2829.88", itemId: createdItems[5].id },
    { description: "Macallan 18 Year", quantity: 6, unitPrice: "319.99", discount: "0", total: "1919.94", itemId: createdItems[7].id },
  ];
  const inv2Subtotal = 4749.82;
  const inv2Tax = inv2Subtotal * 0.19;
  const [inv2] = await db.insert(invoices).values({
    invoiceNumber: "INV-00002", type: "invoice", customerId: createdCustomers[3].id,
    date: "2026-02-15", dueDate: "2026-04-16", subtotal: inv2Subtotal.toFixed(2),
    taxRate: "19", taxAmount: inv2Tax.toFixed(2), discountAmount: "0", total: (inv2Subtotal + inv2Tax).toFixed(2), status: "paid",
  }).returning();
  await db.insert(invoiceItems).values(inv2Items.map(li => ({ ...li, invoiceId: inv2.id })));

  const inv3Items = [
    { description: "Veuve Clicquot Yellow Label 6-pack", quantity: 4, unitPrice: "342.00", discount: "0", total: "1368.00", itemId: createdItems[6].id },
  ];
  const [inv3] = await db.insert(invoices).values({
    invoiceNumber: "INV-00003", type: "invoice", customerId: createdCustomers[1].id,
    date: "2026-01-20", dueDate: "2026-02-03", subtotal: "1368.00",
    taxRate: "19", taxAmount: "259.92", discountAmount: "0", total: "1627.92", status: "overdue",
  }).returning();
  await db.insert(invoiceItems).values(inv3Items.map(li => ({ ...li, invoiceId: inv3.id })));

  // Price contract
  await db.insert(priceContracts).values({
    customerId: createdCustomers[0].id, name: "Grand Hotel Annual Contract",
    startDate: "2026-01-01", endDate: "2026-12-31", discountType: "percentage",
    discountValue: "10", minQuantity: 12, active: true,
  });

  // Seasonal offer
  await db.insert(seasonalOffers).values({
    name: "Spring Wine Festival", description: "Mix and match any 6 bottles from our red and white wine collections for a special discount",
    startDate: "2026-03-01", endDate: "2026-05-31", discountPercentage: "15",
    minItems: 6, mixMatch: true, active: true,
  });

  await db.insert(seasonalOffers).values({
    name: "Summer Sparkling Special", description: "Buy any 12 sparkling wines and get 20% off",
    startDate: "2026-06-01", endDate: "2026-08-31", discountPercentage: "20",
    minItems: 12, mixMatch: false, active: true,
  });

  console.log("Database seeded successfully!");
}
