/**
 * crypto.js — Client-Side AES-GCM Encryption/Decryption
 * All cryptographic operations run exclusively in the browser via the Web Crypto API.
 * The encryption key is NEVER stored in localStorage — only placed in the URL fragment (#),
 * which is never sent to any server, keeping secrets safe even on shared hosts.
 */

"use strict";

const CryptoEngine = (() => {

  /**
   * Generates a fresh AES-GCM-256 CryptoKey.
   * @returns {Promise<CryptoKey>}
   */
  async function generateKey() {
    return crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,          // extractable — so we can export it into the URL
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Encrypts a plaintext string.
   * Generates a unique 12-byte IV for every encryption operation (best practice for GCM).
   * @param {string} plaintext
   * @param {CryptoKey} key
   * @returns {Promise<{ ciphertext: Uint8Array, iv: Uint8Array }>}
   */
  async function encrypt(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
    const encoded = new TextEncoder().encode(plaintext);

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );

    return { ciphertext: new Uint8Array(cipherBuffer), iv };
  }

  /**
   * Decrypts an AES-GCM ciphertext back to a UTF-8 string.
   * @param {Uint8Array} ciphertext
   * @param {Uint8Array} iv
   * @param {CryptoKey} key
   * @returns {Promise<string>}
   */
  async function decrypt(ciphertext, iv, key) {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(plainBuffer);
  }

  /**
   * Exports a CryptoKey as a Base64url-encoded string (URL-safe, no padding issues).
   * @param {CryptoKey} key
   * @returns {Promise<string>}
   */
  async function exportKey(key) {
    const raw = await crypto.subtle.exportKey("raw", key);
    return uint8ToBase64url(new Uint8Array(raw));
  }

  /**
   * Imports a Base64url-encoded string back into a CryptoKey.
   * @param {string} b64url
   * @returns {Promise<CryptoKey>}
   */
  async function importKey(b64url) {
    const raw = base64urlToUint8(b64url);
    return crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM", length: 256 },
      false,         // not extractable once imported on the view side
      ["decrypt"]
    );
  }

  // ── Utility: Uint8Array ↔ Base64url (RFC 4648 §5) ──────────────────────────

  /** Encodes a Uint8Array to a Base64url string. */
  function uint8ToBase64url(bytes) {
    let binary = "";
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  /** Decodes a Base64url string to a Uint8Array. */
  function base64urlToUint8(str) {
    // Re-add padding and convert URL-safe chars back
    const padded = str.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - padded.length % 4) % 4;
    const base64 = padded + "==".slice(0, padLen);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Public API
  return { generateKey, encrypt, decrypt, exportKey, importKey, uint8ToBase64url, base64urlToUint8 };
})();
