import crypto from "crypto";
import sharp from "sharp";
import { Client } from "@replit/object-storage";
import { pool } from "./db";

export const ITEM_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const ITEM_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
export type ItemImageSize = "thumbnail" | "card" | "full";

export interface ItemImageSet {
  version: string;
  width: number;
  height: number;
  renditions: Record<ItemImageSize, Buffer>;
}

let appStorage: Client | null = null;
let appStorageAvailable: boolean | null = null;
function getAppStorage() {
  appStorage ||= new Client();
  return appStorage;
}

async function uploadObject(objectName: string, bytes: Buffer) {
  if (appStorageAvailable !== false) {
    try {
      const result = await getAppStorage().uploadFromBytes(objectName, bytes, { compress: false });
      if (result.ok) {
        appStorageAvailable = true;
        return;
      }
    } catch {
      appStorageAvailable = false;
    }
  }
  await pool.query(
    `INSERT INTO item_image_objects (object_name, content_type, bytes, created_at)
     VALUES ($1, 'image/webp', $2, now())
     ON CONFLICT (object_name) DO UPDATE SET bytes = EXCLUDED.bytes, created_at = now()`,
    [objectName, bytes],
  );
}

async function downloadObject(objectName: string) {
  if (appStorageAvailable !== false) {
    try {
      const result = await getAppStorage().downloadAsBytes(objectName, { decompress: false });
      if (result.ok) {
        appStorageAvailable = true;
        return result.value[0];
      }
    } catch {
      appStorageAvailable = false;
    }
  }
  const result = await pool.query<{ bytes: Buffer }>("SELECT bytes FROM item_image_objects WHERE object_name = $1", [objectName]);
  return result.rows[0]?.bytes || null;
}

async function deleteObject(objectName: string) {
  if (appStorageAvailable !== false) {
    try {
      await getAppStorage().delete(objectName, { ignoreNotFound: true });
    } catch {
      appStorageAvailable = false;
    }
  }
  await pool.query("DELETE FROM item_image_objects WHERE object_name = $1", [objectName]);
}

export function itemImageObjectName(itemId: string, version: string, size: ItemImageSize) {
  return `item-images/${itemId}/${version}/${size}.webp`;
}

export async function createItemImageSet(source: Buffer): Promise<ItemImageSet> {
  if (!source.length || source.length > ITEM_IMAGE_MAX_BYTES) throw new Error("Photo must be between 1 byte and 12 MB");
  const base = sharp(source, { failOn: "error", limitInputPixels: 40_000_000 }).rotate();
  const metadata = await base.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Could not read image dimensions");

  const [thumbnail, card, full] = await Promise.all([
    base.clone().resize(240, 240, { fit: "cover", position: "attention" }).webp({ quality: 76 }).toBuffer(),
    base.clone().resize(720, 720, { fit: "cover", position: "attention" }).webp({ quality: 82 }).toBuffer(),
    base.clone().resize(1600, 1200, { fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer(),
  ]);

  return {
    version: crypto.createHash("sha256").update(source).digest("hex").slice(0, 20),
    width: metadata.width,
    height: metadata.height,
    renditions: { thumbnail, card, full },
  };
}

export async function uploadItemImageSet(itemId: string, imageSet: ItemImageSet) {
  const uploaded: string[] = [];
  try {
    for (const size of ["thumbnail", "card", "full"] as const) {
      const objectName = itemImageObjectName(itemId, imageSet.version, size);
      await uploadObject(objectName, imageSet.renditions[size]);
      uploaded.push(objectName);
    }
  } catch (error) {
    await Promise.all(uploaded.map(name => deleteObject(name).catch(() => undefined)));
    throw error;
  }
}

export async function downloadItemImage(itemId: string, version: string, size: ItemImageSize) {
  return downloadObject(itemImageObjectName(itemId, version, size));
}

export async function deleteItemImageSet(itemId: string, version: string) {
  await Promise.all((["thumbnail", "card", "full"] as const).map(size =>
    deleteObject(itemImageObjectName(itemId, version, size)).catch(() => undefined)
  ));
}