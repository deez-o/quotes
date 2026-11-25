/**
 * Envelope-style encryption for mailbox tokens.
 * A master key (env TOKEN_ENCRYPTION_KEY, 32 bytes base64) derives a separate
 * key per tenant (HKDF), so one tenant's key never decrypts another's tokens.
 * AES-256-GCM, random 12-byte IV. Stored as "v1.<iv>.<tag>.<ciphertext>" (base64url).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function masterKey(raw = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  return key;
}

function tenantKey(tenantId: string, master: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.from(tenantId), Buffer.from("quotes-token-v1"), 32));
}

export function encryptToken(tenantId: string, plaintext: string, rawMaster?: string): string {
  const key = tenantKey(tenantId, masterKey(rawMaster));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(tenantId));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(tenantId: string, stored: string, rawMaster?: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised token format.");
  const key = tenantKey(tenantId, masterKey(rawMaster));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(tenantId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
