// Probe the Google Drive connection after moving folders to a Shared Drive.
// Usage: node apps/admin/server/scripts/probe-drive.mjs <service-account-key.json> <folder-id>
// Exits 0 only if the folder is readable AND a probe file can be uploaded and trashed.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const [keyPath, folderId] = process.argv.slice(2);
if (!keyPath || !folderId) {
  console.error("Usage: node probe-drive.mjs <service-account-key.json> <folder-id>");
  process.exit(2);
}
const sa = JSON.parse(readFileSync(keyPath, "utf8"));
const SCOPE = "https://www.googleapis.com/auth/drive";
const API = "https://www.googleapis.com/drive/v3";
const b64 = (v) => Buffer.from(v, "utf8").toString("base64url");

async function token() {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${payload}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${payload}.${signer.sign(sa.private_key, "base64url")}` }),
  });
  if (!res.ok) throw new Error(`Token refused: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const call = async (auth, path, opts = {}) => {
  const res = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}supportsAllDrives=true`, {
    method: opts.method || "GET",
    headers: { Authorization: `Bearer ${auth}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const auth = await token();
console.log(`✓ token OK (${sa.client_email})`);

const folder = await call(auth, `/files/${folderId}?fields=id,name,driveId,webViewLink`);
console.log(`✓ folder readable: "${folder.name}" (${folder.id})`);
if (folder.driveId) console.log(`✓ folder lives in Shared Drive ${folder.driveId} — quota fix in place`);
else console.warn(`⚠ folder is still in a My Drive (no driveId). Move it into the Shared Drive.`);

// Simple media upload with the bytes as the payload:
const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name`, {
  method: "POST",
  headers: { Authorization: `Bearer ${auth}`, "Content-Type": "multipart/related; boundary=qsprobe" },
  body: `--qsprobe\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"__qs_probe__","parents":["${folderId}"]}\r\n--qsprobe\r\nContent-Type: text/plain\r\n\r\nquicksort drive probe\r\n--qsprobe--`,
});
if (!up.ok) {
  console.error(`✗ upload probe failed: ${up.status}: ${await up.text()}`);
  process.exit(1);
}
const uploaded = await up.json();
console.log(`✓ probe file uploaded (${uploaded.id}) — service-account quota issue is gone`);
await call(auth, `/files/${uploaded.id}`, { method: "PATCH", body: { trashed: true } });
console.log("✓ probe file trashed. Drive connection is healthy.");
