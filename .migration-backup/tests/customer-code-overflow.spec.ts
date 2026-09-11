import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { customers } from "../shared/schema";

test("oversized customer codes do not break next-code generation", async () => {
  const unique = `${Date.now()}${process.pid}`;
  const currentNumber = "9".repeat(30);
  const currentCode = `CUST${currentNumber}`;
  const importedCode = `IMPORTED-${unique.repeat(20)}`;
  const createdIds: string[] = [];

  try {
    const inserted = await db
      .insert(customers)
      .values([
        {
          name: `Valid Large Code Regression ${unique}`,
          code: currentCode,
        },
        {
          name: `Imported Oversized Code Regression ${unique}`,
          code: importedCode,
        },
      ])
      .returning({ id: customers.id });
    createdIds.push(...inserted.map(({ id }) => id));

    const expectedFirst = `CUST${(BigInt(currentNumber) + BigInt(1)).toString()}`;
    expect(await storage.getNextCustomerCode()).toBe(expectedFirst);

    const [persisted] = await db
      .insert(customers)
      .values({
        name: `Persisted Successor Regression ${unique}`,
        code: expectedFirst,
      })
      .returning({ id: customers.id });
    createdIds.push(persisted.id);

    expect(await storage.getNextCustomerCode()).toBe(
      `CUST${(BigInt(currentNumber) + BigInt(2)).toString()}`,
    );
  } finally {
    for (const id of createdIds.reverse()) {
      await db.delete(customers).where(eq(customers.id, id));
    }
  }
});

test("leading-zero padding does not change numeric customer code ordering", async () => {
  const unique = `${Date.now()}${process.pid}`;
  const higherNumber = "8".repeat(40);
  const lowerPaddedNumber = `${"0".repeat(80)}${"7".repeat(40)}`;
  const createdIds: string[] = [];

  try {
    const inserted = await db
      .insert(customers)
      .values([
        {
          name: `Higher Shorter Code Regression ${unique}`,
          code: `CUST${higherNumber}`,
        },
        {
          name: `Lower Padded Code Regression ${unique}`,
          code: `CUST${lowerPaddedNumber}`,
        },
      ])
      .returning({ id: customers.id });
    createdIds.push(...inserted.map(({ id }) => id));

    expect(await storage.getNextCustomerCode()).toBe(
      `CUST${(BigInt(higherNumber) + BigInt(1)).toString()}`,
    );
  } finally {
    for (const id of createdIds.reverse()) {
      await db.delete(customers).where(eq(customers.id, id));
    }
  }
});
