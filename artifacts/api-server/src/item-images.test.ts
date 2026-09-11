import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createItemImageSet, itemImageObjectName } from "./item-images";

test("creates storefront-ready item image renditions from one source photo", async () => {
  const source = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#4f8a3c" },
  }).jpeg().toBuffer();

  const result = await createItemImageSet(source);
  const thumbnail = await sharp(result.renditions.thumbnail).metadata();
  const card = await sharp(result.renditions.card).metadata();
  const full = await sharp(result.renditions.full).metadata();

  assert.equal(result.version.length, 20);
  assert.deepEqual([thumbnail.width, thumbnail.height, thumbnail.format], [240, 240, "webp"]);
  assert.deepEqual([card.width, card.height, card.format], [720, 720, "webp"]);
  assert.deepEqual([full.width, full.height, full.format], [1200, 800, "webp"]);
});

test("uses deterministic versioned object names", () => {
  assert.equal(
    itemImageObjectName("item-1", "abc123", "card"),
    "item-images/item-1/abc123/card.webp",
  );
});

test("rejects data that is not a decodable image", async () => {
  await assert.rejects(() => createItemImageSet(Buffer.from("not an image")));
});