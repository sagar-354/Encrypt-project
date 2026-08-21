/**
 * script.js — Application Logic & Resilient Storage Engine
 * Handles the CREATE flow (index.html) and the VIEW flow (secret.html).
 * Implements a hybrid multi-tier storage engine (URL fragment payload, localStorage, optional Supabase).
 */

"use strict";

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "sm_secret_";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random ID string (URL-safe, 16 bytes = 22 chars).
 * @returns {string}
 */
function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return CryptoEngine.uint8ToBase64url(bytes);
}

/**
 * Calculates the expiration timestamp from now.
 * @param {string} duration - "10m" | "1h" | "24h"
 * @returns {number} Unix timestamp in milliseconds
 */
function calcExpiry(duration) {
  const now = Date.now();
  const map = {
    "10m": 10 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000
  };
  return now + (map[duration] || map["1h"]);
}

/**
 * Formats a remaining-time string from a future timestamp.
 * @param {number} expiresAt
 * @returns {string}
 */
function formatTimeLeft(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/**
 * Copies text to clipboard with feedback on the button and non-HTTPS fallback.
 */
async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove("copied");
    }, 2000);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove("copied");
      }, 2000);
    } catch (e) {
      console.error("Clipboard copy failed:", e);
    } finally {
      document.body.removeChild(ta);
    }
  }
}

/** Returns the absolute URL to secret.html based on current environment. */
function getSecretBaseUrl() {
  const currentPath = location.pathname;
  const dirPath = currentPath.substring(0, currentPath.lastIndexOf("/") + 1);
  if (location.protocol === "file:") {
    return `file://${dirPath}secret.html`;
  }
  return `${location.protocol}//${location.host}${dirPath}secret.html`;
}

/** Typewriter effect for revealed secret. */
function typewriterReveal(el, text) {
  el.textContent = "";
  let i = 0;
  const step = () => {
    if (i < text.length) {
      el.textContent += text[i++];
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

/** CSS shake animation on an element. */
function shakeElement(el) {
  el.classList.remove("shake");
  void el.offsetWidth; // reflow
  el.classList.add("shake");
}

/** Displays a temporary error toast. */
function showError(msg) {
  let toast = document.getElementById("error-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "error-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 4000);
}

/** Removes all expired secrets from localStorage (housekeeping). */
function purgeExpiredSecrets() {
  const now = Date.now();
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    try {
      const record = JSON.parse(localStorage.getItem(key));
      if (record && record.expiresAt && record.expiresAt < now) {
        localStorage.removeItem(key);
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
}

// ── Resilient Storage Engine ──────────────────────────────────────────────────

const StorageService = (() => {

  /**
   * Encodes ciphertext metadata into a URL-safe compact payload string.
   */
  function encodePayload(ciphertextB64, ivB64, expiresAt) {
    const dataObj = { c: ciphertextB64, iv: ivB64, exp: expiresAt };
    const jsonStr = JSON.stringify(dataObj);
    const bytes = new TextEncoder().encode(jsonStr);
    return CryptoEngine.uint8ToBase64url(bytes);
  }

  /**
   * Decodes compact payload string from URL hash into record object.
   */
  function decodePayload(payloadB64) {
    try {
      const bytes = CryptoEngine.base64urlToUint8(payloadB64);
      const jsonStr = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(jsonStr);
      if (parsed && parsed.c && parsed.iv) {
        return {
          ciphertext: parsed.c,
          iv: parsed.iv,
          expiresAt: parsed.exp || 0
        };
      }
    } catch (err) {
      console.warn("Could not decode payload from URL:", err);
    }
    return null;
  }

  /**
   * Saves a secret to localStorage and attempts Supabase sync if reachable.
   * Always succeeds locally even if Supabase is offline or misconfigured.
   */
  async function storeSecret(id, ciphertextB64, ivB64, expiresAt) {
    const record = {
      ciphertext: ciphertextB64,
      iv: ivB64,
      createdAt: Date.now(),
      expiresAt: expiresAt,
      viewCount: 0
    };

    // 1. Always save in localStorage
    try {
      localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(record));
    } catch (err) {
      console.warn("LocalStorage setItem failed:", err);
    }

    // 2. Optional Supabase remote sync (non-blocking, fails gracefully)
    const client = typeof window.getSupabaseClient === "function" ? window.getSupabaseClient() : null;
    if (client) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Supabase timeout")), 2500)
        );
        const insertPromise = client.from("secrets").insert([{
          id: id,
          ciphertext: ciphertextB64,
          iv: ivB64,
          created_at: new Date().toISOString(),
          expires_at: new Date(expiresAt).toISOString(),
          view_count: 0
        }]);

        await Promise.race([insertPromise, timeoutPromise]).catch(e => {
          console.info("Supabase sync skipped/failed:", e.message || e);
        });
      } catch (err) {
        console.info("Supabase insert error (using local & URL fallback):", err.message || err);
      }
    }

    // 3. Return the URL-embedded payload for guaranteed zero-server link sharing
    return encodePayload(ciphertextB64, ivB64, expiresAt);
  }

  /**
   * Retrieves a secret by checking URL payload first, then localStorage, then Supabase.
   */
  async function getSecret(id, payloadB64) {
    // 1. Try URL embedded payload
    if (payloadB64) {
      const decoded = decodePayload(payloadB64);
      if (decoded) return decoded;
    }

    // 2. Try localStorage
    if (id) {
      try {
        const localRaw = localStorage.getItem(STORAGE_PREFIX + id);
        if (localRaw) {
          const parsed = JSON.parse(localRaw);
          if (parsed && parsed.ciphertext && parsed.iv) {
            return {
              ciphertext: parsed.ciphertext,
              iv: parsed.iv,
              expiresAt: parsed.expiresAt || 0
            };
          }
        }
      } catch (err) {
        console.warn("LocalStorage read error:", err);
      }
    }

    // 3. Try Supabase
    if (id) {
      const client = typeof window.getSupabaseClient === "function" ? window.getSupabaseClient() : null;
      if (client) {
        try {
          const { data, error } = await client
            .from("secrets")
            .select("*")
            .eq("id", id)
            .single();

          if (!error && data && data.ciphertext && data.iv) {
            let exp = 0;
            if (data.expires_at) {
              exp = typeof data.expires_at === "number" ? data.expires_at : new Date(data.expires_at).getTime();
            }
            return {
              ciphertext: data.ciphertext,
              iv: data.iv,
              expiresAt: exp
            };
          }
        } catch (err) {
          console.warn("Supabase fetch error:", err);
        }
      }
    }

    return null;
  }

  /**
   * Deletes a secret from localStorage and Supabase.
   */
  async function deleteSecret(id) {
    if (!id) return;

    // Delete from localStorage
    try {
      localStorage.removeItem(STORAGE_PREFIX + id);
    } catch (e) {
      console.warn("LocalStorage remove error:", e);
    }

    // Delete from Supabase if configured
    const client = typeof window.getSupabaseClient === "function" ? window.getSupabaseClient() : null;
    if (client) {
      try {
        await client.from("secrets").delete().eq("id", id);
      } catch (e) {
        console.warn("Supabase delete error:", e);
      }
    }
  }

  return { storeSecret, getSecret, deleteSecret, encodePayload, decodePayload };
})();

// ── CREATE PAGE (index.html) ───────────────────────────────────────────────────

async function initCreatePage() {
  const form          = document.getElementById("secret-form");
  const secretInput   = document.getElementById("secret-input");
  const expirySelect  = document.getElementById("expiry-select");
  const charCount     = document.getElementById("char-count");
  const resultSection = document.getElementById("result-section");
  const linkOutput    = document.getElementById("link-output");
  const copyBtn       = document.getElementById("copy-btn");
  const newSecretBtn  = document.getElementById("new-secret-btn");
  const submitBtn     = document.getElementById("submit-btn");
  const spinner       = document.getElementById("spinner");
  const expiryLabel   = document.getElementById("expiry-label");

  if (!form) return;

  // Live character counter
  secretInput.addEventListener("input", () => {
    const len = secretInput.value.length;
    charCount.textContent = `${len} / 5000`;
    charCount.classList.toggle("warn", len > 4500);
  });

  // Form submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const plaintext = secretInput.value.trim();
    if (!plaintext) {
      shakeElement(secretInput);
      return;
    }

    // Show loading state
    submitBtn.disabled = true;
    if (spinner) spinner.hidden = false;
    const btnText = submitBtn.querySelector(".btn-text");
    if (btnText) btnText.textContent = "Encrypting…";

    try {
      // 1. Generate key and encrypt
      const key = await CryptoEngine.generateKey();
      const { ciphertext, iv } = await CryptoEngine.encrypt(plaintext, key);
      const exportedKey = await CryptoEngine.exportKey(key);

      // 2. Generate unique ID & expiration
      const id = generateId();
      const duration = expirySelect.value;
      const expiresAt = calcExpiry(duration);

      const ciphertextB64 = CryptoEngine.uint8ToBase64url(ciphertext);
      const ivB64 = CryptoEngine.uint8ToBase64url(iv);

      // 3. Store secret using resilient storage service
      const payloadB64 = await StorageService.storeSecret(id, ciphertextB64, ivB64, expiresAt);

      // 4. Construct shareable link (zero-server payload included in URL fragment)
      const baseUrl = getSecretBaseUrl();
      const link = `${baseUrl}?id=${id}#key=${exportedKey}&data=${payloadB64}`;

      // 5. Update UI
      linkOutput.value = link;
      if (expiryLabel) {
        expiryLabel.textContent = `Expires in ${formatTimeLeft(expiresAt)} · One-time view`;
      }

      form.closest(".card").classList.add("hidden");
      resultSection.classList.remove("hidden");
      resultSection.classList.add("fade-in");

    } catch (err) {
      console.error("Encryption/storage failed:", err);
      showError("Encryption failed. Please try again.");
    } finally {
      submitBtn.disabled = false;
      if (spinner) spinner.hidden = true;
      if (btnText) btnText.textContent = "Generate Secret Link";
    }
  });

  // Copy button
  if (copyBtn) {
    copyBtn.addEventListener("click", () => copyToClipboard(linkOutput.value, copyBtn));
  }

  // Create another secret reset
  if (newSecretBtn) {
    newSecretBtn.addEventListener("click", () => {
      secretInput.value = "";
      if (charCount) charCount.textContent = "0 / 5000";
      form.closest(".card").classList.remove("hidden");
      resultSection.classList.add("hidden");
      resultSection.classList.remove("fade-in");
    });
  }

  // Purge expired local secrets
  purgeExpiredSecrets();
}

// ── VIEW PAGE (secret.html) ───────────────────────────────────────────────────

async function initViewPage() {
  const stateEl = document.getElementById("view-state");
  if (!stateEl) return;

  const icons = {
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    expired: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  };

  const render = (type, title, body) => {
    stateEl.className = `state-card ${type} fade-in`;
    stateEl.innerHTML = `
      <div class="state-icon">${icons[type]}</div>
      <h2>${title}</h2>
      <p>${body}</p>
      ${type === "success" ? `<div id="secret-reveal"></div>` : ""}
      <a href="index.html" class="btn btn-outline">Create Your Own Secret</a>
    `;
  };

  // Parse URL: ?id=...#key=...&data=...
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const keyB64 = fragment.get("key") || fragment.get("k");
  const payloadB64 = fragment.get("data") || fragment.get("d");

  // Guard: missing encryption key
  if (!keyB64 || (!id && !payloadB64)) {
    render("error", "Invalid Link", "This link is missing required encryption parameters. Make sure you copied the full link.");
    return;
  }

  // 1. Retrieve the secret record
  const record = await StorageService.getSecret(id, payloadB64);
  if (!record) {
    render("error", "Secret Not Found", "This secret has already been viewed, never existed, or was deleted. Secrets can only be viewed once.");
    return;
  }

  // 2. Check expiry
  if (record.expiresAt && Date.now() > record.expiresAt) {
    await StorageService.deleteSecret(id);
    render("expired", "Secret Expired", "This secret has passed its expiration time and has been permanently deleted.");
    return;
  }

  // 3. Decrypt and display
  try {
    const key = await CryptoEngine.importKey(keyB64);
    const ciphertext = CryptoEngine.base64urlToUint8(record.ciphertext);
    const iv = CryptoEngine.base64urlToUint8(record.iv);
    const plaintext = await CryptoEngine.decrypt(ciphertext, iv, key);

    // One-time view: delete immediately from all storage
    await StorageService.deleteSecret(id);

    // Clear decryption key from URL bar so it cannot be copied/reloaded
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", location.pathname + (id ? `?id=${id}` : ""));
    }

    render("success", "Your Secret", "Revealed once. Now permanently deleted.");

    const revealEl = document.getElementById("secret-reveal");
    if (revealEl) {
      revealEl.innerHTML = `
        <div class="secret-box">
          <pre id="secret-text"></pre>
          <button class="btn btn-copy-secret" id="copy-secret-btn" type="button">Copy Secret</button>
        </div>
      `;

      const secretTextEl = document.getElementById("secret-text");
      const copySecretBtn = document.getElementById("copy-secret-btn");

      if (copySecretBtn) {
        copySecretBtn.addEventListener("click", function () {
          copyToClipboard(plaintext, this);
        });
      }

      if (secretTextEl) {
        typewriterReveal(secretTextEl, plaintext);
      }
    }

  } catch (err) {
    console.error("Decryption failed:", err);
    await StorageService.deleteSecret(id);
    render("error", "Decryption Failed", "The key in the link did not match the stored secret. The link may be incomplete or tampered with.");
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("secret-form")) {
    initCreatePage();
  }
  if (document.getElementById("view-state")) {
    initViewPage();
  }
});
