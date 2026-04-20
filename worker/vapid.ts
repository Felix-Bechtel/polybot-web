// Build a VAPID JWT for Web Push.
// Signed with ES256 over {alg:ES256, typ:JWT}.{aud, exp, sub}

export async function buildVapidAuthHeader(
  audience: string,
  subject: string,
  privateKeyB64: string,
  publicKeyB64: string,
): Promise<{ token: string; publicKey: string }> {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12h
    sub: subject,
  };
  const enc = new TextEncoder();
  const h64 = b64url(enc.encode(JSON.stringify(header)));
  const p64 = b64url(enc.encode(JSON.stringify(payload)));
  const data = enc.encode(`${h64}.${p64}`);

  // Import private key (raw P-256 d value) into an ECDSA key usable for signing.
  const privRaw = b64urlDecode(privateKeyB64);
  const pubRaw = b64urlDecode(publicKeyB64);

  const key = await importECDSAPrivateKey(privRaw, pubRaw);
  const sigBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);
  const sig64 = b64url(new Uint8Array(sigBuf));
  return { token: `${h64}.${p64}.${sig64}`, publicKey: publicKeyB64 };
}

async function importECDSAPrivateKey(privRaw: Uint8Array, pubRaw: Uint8Array): Promise<CryptoKey> {
  // JWK format takes base64url-encoded x, y, d
  if (pubRaw[0] !== 0x04 || pubRaw.length !== 65) throw new Error("bad public key");
  const x = b64url(pubRaw.slice(1, 33));
  const y = b64url(pubRaw.slice(33, 65));
  const d = b64url(privRaw);
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
