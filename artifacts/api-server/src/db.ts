import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db";
import { logger } from "./lib/logger";
import { handleDatabasePoolErrors } from "./lib/database-pool-errors";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
handleDatabasePoolErrors(pool, (fields, message) => logger.error(fields, message));
export const db = drizzle(pool, { schema });
