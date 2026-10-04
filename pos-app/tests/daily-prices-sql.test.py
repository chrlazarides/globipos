"""Check persisted daily prices using the actual native catalogue upsert and paging SQL."""
import pathlib
import re
import sqlite3
import tempfile
import json

root = pathlib.Path(__file__).resolve().parents[1]
native_db = (root / "src-tauri/src/db.rs").read_text()
native_commands = (root / "src-tauri/src/lib.rs").read_text()
upsert = re.search(r'r#"(INSERT INTO local_products[\s\S]*?)"#', native_db).group(1)
columns = re.search(r"INSERT INTO local_products\s*\(([\s\S]*?)\)", upsert).group(1)
columns = [c.strip() for c in columns.split(",")]
text = {"id", "server_id", "name", "sku", "barcode", "description", "category_id",
        "unit_type", "updated_at", "image_url", "synced_at"}
definitions = ", ".join(f"{c} {'TEXT' if c in text else 'REAL'}" + (" UNIQUE" if c == "server_id" else "") for c in columns)
page_body = native_commands.split("async fn get_category_products_page(")[1].split("\n}\n")[0]
page_sql = re.search(r'sqlx::query\(\s*r#"([\s\S]*?)"#\s*\)', page_body).group(1)

def row(price):
    product = dict(id="local-banana", server_id="banana", name="Bananas", sku="4011",
                   barcode=None, description=None, category_id="fruit", price1=2.99,
                   price2=price, price3=0, price4=0, price5=0, cost_price=1,
                   vat_rate=5, unit_type="kg", pack_size=1, stock_quantity=10,
                   active=1, updated_at="2026-10-04T10:00:00Z", image_url=None)
    return tuple(product[c] for c in columns if c != "synced_at")

with tempfile.TemporaryDirectory() as directory:
    path = str(pathlib.Path(directory) / "till.sqlite")
    db = sqlite3.connect(path)
    db.execute(f"CREATE TABLE local_products ({definitions})")
    db.execute("CREATE TABLE price_overrides (product_id TEXT, override_price REAL, valid_from TEXT, valid_until TEXT, created_at TEXT)")
    db.execute(upsert, row(3.49))
    # The save updates the master catalogue; normal native delta/full sync upserts it.
    db.execute(upsert, row(4.20))
    db.commit()
    db.close()
    reopened = sqlite3.connect(path)
    reopened.row_factory = sqlite3.Row
    product = reopened.execute(page_sql, (json.dumps(["fruit"]), 24, 0)).fetchone()
    assert product["price1"] == 2.99
    assert product["price2"] == 4.20
    assert product["unit_type"] == "kg"
    assert product["sku"] == "4011"
    reopened.execute(upsert, row(4.20))
    reopened.commit()
    assert reopened.execute("SELECT count(*) FROM local_products").fetchone()[0] == 1
    assert reopened.execute("SELECT price2 FROM local_products").fetchone()[0] == 4.20
    reopened.close()
print("PASS: saved per-kg prices survive actual native sync SQL, reopening and repeat full/delta catalogue upserts without changing other price levels.")