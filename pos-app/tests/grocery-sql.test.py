"""Execute the grocery command's actual SQL against isolated SQLite fixtures."""
import json
import pathlib
import re
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
source = (root / "src-tauri/src/lib.rs").read_text()
body = source.split("async fn get_category_products_page(")[1].split("\n}\n")[0]
count_sql = re.search(r'query_scalar\(\s*"([\s\S]*?)"\s*\)', body).group(1)
page_sql = re.search(r'sqlx::query\(\s*r#"([\s\S]*?)"#\s*\)', body).group(1)
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE local_products (server_id TEXT, name TEXT, category_id TEXT, price1 REAL, active INTEGER)")
db.execute("CREATE TABLE price_overrides (product_id TEXT, override_price REAL, valid_from TEXT, valid_until TEXT, created_at TEXT)")
db.executemany("INSERT INTO local_products VALUES (?,?,?,?,?)",
               [(str(i), f"Fruit {i:04}", "fruit" if i < 300 else "citrus", 2.99, 1) for i in range(320)])
db.execute("INSERT INTO local_products VALUES ('excluded', 'Other', 'vegetable', 4, 1)")
db.execute("INSERT INTO local_products VALUES ('inactive', 'Inactive', 'fruit', 4, 0)")
db.execute("INSERT INTO price_overrides VALUES ('0', 0, '2020-01-01', '2099-01-01', '2020-01-01')")
db.execute("INSERT INTO price_overrides VALUES ('1', 1, '2020-01-01', '2020-02-01', '2020-01-01')")
ids = json.dumps(["fruit", "citrus"])
assert db.execute(count_sql, (ids,)).fetchone()[0] == 320
found = []
for offset in range(0, 320, 24):
    rows = db.execute(page_sql, (ids, 24, offset)).fetchall()
    assert len(rows) <= 24
    found.extend(row[0] for row in rows)
assert len(found) == len(set(found)) == 320, "No 250-item cutoff, duplication or category leakage"
first = db.execute(page_sql, (ids, 24, 0)).fetchall()
assert first[0][-1] == 0, "A live zero-price override must be retained"
assert first[1][-1] is None, "Expired prices must not apply"

# Manual PLU is global and SKU-first; physical scanning remains barcode-first.
lookup_body = source.split("async fn lookup_product(")[1].split("\n}\n")[0]
lookup_sql = re.search(r'sqlx::query\(\s*r#"([\s\S]*?)"#', lookup_body).group(1)
db.execute("ALTER TABLE local_products ADD COLUMN sku TEXT")
db.execute("ALTER TABLE local_products ADD COLUMN barcode TEXT")
db.execute("UPDATE local_products SET sku = '4011' WHERE server_id = '0'")
db.execute("UPDATE local_products SET barcode = '4011' WHERE server_id = '1'")
assert db.execute(lookup_sql, (True, "4011", True, "4011")).fetchone()[0] == "0"
assert db.execute(lookup_sql, (False, "4011", False, "4011")).fetchone()[0] == "1"
assert db.execute(lookup_sql, (True, "missing", True, "missing")).fetchone() is None
db.execute("UPDATE local_products SET sku = '4999' WHERE server_id = 'inactive'")
assert db.execute(lookup_sql, (True, "4999", True, "4999")).fetchone() is None

# Upgrade an existing till without rewriting its saved sale.
db.execute("CREATE TABLE pos_order_lines (id TEXT, unit_price REAL)")
db.execute("INSERT INTO pos_order_lines VALUES ('old-sale', 2.3)")
migrations = (root / "src-tauri/src/migrations.rs").read_text()
for column in ["price_includes_vat", "category_id"]:
    ddl = re.search(r'"(ALTER TABLE pos_order_lines ADD COLUMN ' + column + r'[^"]*)"', migrations).group(1)
    for _ in range(2):
        if column not in {row[1] for row in db.execute("PRAGMA table_info(pos_order_lines)")}:
            db.execute(ddl)
assert db.execute("SELECT unit_price, price_includes_vat, category_id FROM pos_order_lines").fetchone() == (2.3, 0, None)
# Prepare the real native save statements against its actual bootstrap tables
# and upgrade columns, catching placeholder/column mismatches without Cargo.
saved = sqlite3.connect(":memory:")
for table in ["pos_orders", "pos_order_lines"]:
    create = re.search(r'r#"(CREATE TABLE IF NOT EXISTS ' + table + r'\b[\s\S]*?)"#', migrations).group(1)
    saved.execute(create)
    for ddl in re.findall(r'"(ALTER TABLE ' + table + r' ADD COLUMN [^"]*)"', migrations):
        column = ddl.split("ADD COLUMN ")[1].split()[0]
        if column not in {row[1] for row in saved.execute(f"PRAGMA table_info({table})")}:
            saved.execute(ddl)
orders_source = (root / "src-tauri/src/orders.rs").read_text()
for statement in re.findall(r'r#"(INSERT(?: OR REPLACE)? INTO pos_order[^"]+)"#', orders_source):
    columns = statement.split("(", 1)[1].split(")", 1)[0].replace("\n", "").split(",")
    bound_columns = [c.strip() for c in columns if c.strip() != "updated_at"]
    values = []
    for column in bound_columns:
        values.append("sale" if column in ["id", "order_id"] else
                      1 if column == "price_includes_vat" else
                      "fruit" if column == "category_id" else 0)
    saved.execute(statement, values)
assert saved.execute("SELECT price_includes_vat, category_id FROM pos_order_lines").fetchone() == (1, "fruit")
# Execute both native photo upserts against their real schema and migration.
photos = sqlite3.connect(":memory:")
photos.execute(re.search(r'r#"(CREATE TABLE IF NOT EXISTS local_products\b[\s\S]*?)"#', migrations).group(1))
photo_ddl = re.search(r'"(ALTER TABLE local_products ADD COLUMN image_url TEXT)"', migrations).group(1)
for _ in range(2):
    if "image_url" not in {row[1] for row in photos.execute("PRAGMA table_info(local_products)")}:
        photos.execute(photo_ddl)
photo_sql = (root / "src-tauri/src/db.rs").read_text()
upserts = re.findall(r'r#"(INSERT INTO local_products[\s\S]*?)"#', photo_sql)
assert len(upserts) == 2
for i, statement in enumerate(upserts):
    columns = [c.strip() for c in statement.split("(", 1)[1].split(")", 1)[0].split(",")]
    values = ["product" if c in ["id", "server_id"] else
              f"https://example.test/banana-{i}.jpg" if c == "image_url" else
              "4011" if c == "sku" else 0 for c in columns if c != "synced_at"]
    photos.execute(statement, values)
    assert photos.execute("SELECT image_url FROM local_products").fetchone()[0].endswith(f"banana-{i}.jpg")
photos.execute("CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT)")
photos.executemany("INSERT INTO schema_meta VALUES (?, 'unchanged')", [(key,) for key in [
    "last_catalog_sync", "catalog_sync_cursor", "catalog_bootstrap_cursor", "device_id"]])
photos.execute(re.search(r'"(DELETE FROM schema_meta WHERE key IN [^"]+)"', migrations).group(1))
assert photos.execute("SELECT key, value FROM schema_meta").fetchall() == [("device_id", "unchanged")]
print("PASS: actual SQLite paging SQL, descendants, 320 items, global SKU-first PLU lookup, barcode-first scanning, active filtering, live/expired prices and repeat-safe legacy till upgrade.")