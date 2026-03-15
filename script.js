/**
 * script.js — Application Logic
 * Handles the CREATE flow (index.html) and the VIEW flow (secret.html).
 * Detects which page is active by checking for landmark elements.
 */

"use strict";

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "sm_secret_";   // localStorage key prefix

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
  const map = { "10m": 10 * 60 * 1000, "1h": 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000 };
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

/** Copies text to clipboard and gives feedback on the button. */
async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = orig; btn.classList.remove("copied"); }, 2000);
  } catch {
    // Fallback for non-HTTPS (e.g. file://)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = "Copy Link", 2000);
  }
}

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

  if (!form) return; // safety guard

  // Live character counter
  secretInput.addEventListener("input", () => {
    const len = secretInput.value.length;
    charCount.textContent = `${len} / 5000`;
    charCount.classList.toggle("warn", len > 4500);
  });

  // Form submission — encrypt and store
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const plaintext = secretInput.value.trim();
    if (!plaintext) {
      shakeElement(secretInput);
      return;
    }

    // Show loading state
    submitBtn.disabled = true;
    spinner.hidden = false;
    submitBtn.querySelector(".btn-text").textContent = "Encrypting…";

    try {
      // 1. Generate key and encrypt
      const key               = await CryptoEngine.generateKey();
      const { ciphertext, iv } = await CryptoEngine.encrypt(plaintext, key);
      const exportedKey       = await CryptoEngine.exportKey(key);

      // 2. Generate unique ID
      const id = generateId();

      // 3. Build the storage record (NO plaintext, NO key stored here)
      const duration   = expirySelect.value;
      const expiresAt  = calcExpiry(duration);
      const record = {
        ciphertext: CryptoEngine.uint8ToBase64url(ciphertext),
        iv:         CryptoEngine.uint8ToBase64url(iv),
        createdAt:  Date.now(),
        expiresAt,
        viewCount:  0,
      };

      localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(record));

      // 4. Build shareable link
      //    Key goes into the URL *fragment* — never sent to any server.
      const baseUrl = `${location.protocol}//${location.host}${location.pathname.replace("index.html", "")}secret.html`;
      const link = `${baseUrl}?id=${id}#key=${exportedKey}`;

      // 5. Show result
      linkOutput.value = link;
      expiryLabel.textContent = `Expires in ${formatTimeLeft(expiresAt)} · One-time view`;
      form.closest(".card").classList.add("hidden");
      resultSection.classList.remove("hidden");
      resultSection.classList.add("fade-in");

    } catch (err) {
      console.error("Encryption failed:", err);
      showError("Encryption failed. Please try again.");
    } finally {
      submitBtn.disabled = false;
      spinner.hidden = true;
      submitBtn.querySelector(".btn-text").textContent = "Generate Secret Link";
    }
  });

  // Copy button
  copyBtn.addEventListener("click", () => copyToClipboard(linkOutput.value, copyBtn));

  // "Create another" resets everything
  newSecretBtn.addEventListener("click", () => {
    secretInput.value = "";
    charCount.textContent = "0 / 5000";
    form.closest(".card").classList.remove("hidden");
    resultSection.classList.add("hidden");
    resultSection.classList.remove("fade-in");
  });

  // Purge expired secrets on load (housekeeping)
  purgeExpiredSecrets();
}

// ── VIEW PAGE (secret.html) ───────────────────────────────────────────────────

async function initViewPage() {
  const stateEl   = document.getElementById("view-state");
  if (!stateEl) return;

  // Parse URL: ?id=...#key=...
  const params    = new URLSearchParams(location.search);
  const id        = params.get("id");
  const fragment  = new URLSearchParams(location.hash.replace("#", ""));
  const keyB64    = fragment.get("key");

  // Helper to render a state
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

  const icons = {
    error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    expired: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  };

  // Guard: missing params
  if (!id || !keyB64) {
    render("error", "Invalid Link", "This link is missing required parameters. Make sure you copied the full link.");
    return;
  }

  // Guard: secret not found
  const raw = localStorage.getItem(STORAGE_PREFIX + id);
  if (!raw) {
    render("error", "Secret Not Found", "This secret has already been viewed, never existed, or was deleted. Secrets can only be viewed once.");
    return;
  }

  let record;
  try { record = JSON.parse(raw); } catch {
    render("error", "Corrupted Data", "The secret data could not be parsed.");
    return;
  }

  // Guard: expired
  if (Date.now() > record.expiresAt) {
    localStorage.removeItem(STORAGE_PREFIX + id);
    render("expired", "Secret Expired", "This secret has passed its expiration time and has been permanently deleted.");
    return;
  }

  // ── DECRYPT ──
  try {
    const key        = await CryptoEngine.importKey(keyB64);
    const ciphertext = CryptoEngine.base64urlToUint8(record.ciphertext);
    const iv         = CryptoEngine.base64urlToUint8(record.iv);
    const plaintext  = await CryptoEngine.decrypt(ciphertext, iv, key);

    // 🔑 DELETE IMMEDIATELY — before rendering, so a crash won't allow a second view
    localStorage.removeItem(STORAGE_PREFIX + id);

    // Clear the key from the URL bar (can't be re-used)
    history.replaceState(null, "", location.pathname + "?id=" + id);

    render("success", "Your Secret", "Revealed once. Now permanently deleted.");

    // Inject the revealed secret into a styled box
    const revealEl = document.getElementById("secret-reveal");
    revealEl.innerHTML = `
      <div class="secret-box">
        <pre id="secret-text"></pre>
        <button class="btn btn-copy-secret" id="copy-secret-btn">Copy Secret</button>
      </div>
    `;
    const secretTextEl = document.getElementById("secret-text");
    secretTextEl.textContent = plaintext;
    document.getElementById("copy-secret-btn").addEventListener("click", function() {
      copyToClipboard(plaintext, this);
    });

    // Typewriter reveal effect
    typewriterReveal(secretTextEl, plaintext);

  } catch (err) {
    console.error("Decryption failed:", err);
    // If decryption fails, still ensure deletion
    localStorage.removeItem(STORAGE_PREFIX + id);
    render("error", "Decryption Failed", "The key in the link did not match the stored secret. The link may be incomplete or tampered with.");
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Typewriter effect for the revealed secret. */
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
      if (record.expiresAt < now) localStorage.removeItem(key);
    } catch {
      localStorage.removeItem(key); // remove corrupted entries
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("secret-form")) initCreatePage();
  if (document.getElementById("view-state"))   initViewPage();
});