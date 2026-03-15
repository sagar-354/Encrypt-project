"use strict";

/* ---------------- SUPABASE CONFIG ---------------- */

const SUPABASE_URL = "https://ypdajfdyytjfvjeaxnyq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwZGFqZmR5eXRqZnZqZWF4bnlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MDg0ODUsImV4cCI6MjA4OTE4NDQ4NX0.CoxLqQOccH4d7TTnL4O0DB52Y-gBUrGdgzNLsWwO9DI";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

/* ---------------- Helpers ---------------- */

function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return CryptoEngine.uint8ToBase64url(bytes);
}

function calcExpiry(duration) {
  const now = Date.now();
  const map = {
    "10m": 10 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000
  };
  return now + map[duration];
}

function formatTimeLeft(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";

  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);

  if (h >= 1) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

async function copyToClipboard(text, btn) {
  await navigator.clipboard.writeText(text);

  const original = btn.textContent;

  btn.textContent = "Copied!";
  setTimeout(() => btn.textContent = original, 2000);
}

/* ---------------- CREATE PAGE ---------------- */

async function initCreatePage() {

  const form = document.getElementById("secret-form");
  if (!form) return;

  const secretInput = document.getElementById("secret-input");
  const expirySelect = document.getElementById("expiry-select");
  const linkOutput = document.getElementById("link-output");
  const resultSection = document.getElementById("result-section");
  const copyBtn = document.getElementById("copy-btn");
  const expiryLabel = document.getElementById("expiry-label");

  form.addEventListener("submit", async (e) => {

    e.preventDefault();

    const plaintext = secretInput.value.trim();
    if (!plaintext) return;

    try {

      /* 1️⃣ Generate encryption key */

      const key = await CryptoEngine.generateKey();

      const { ciphertext, iv } =
        await CryptoEngine.encrypt(plaintext, key);

      const exportedKey = await CryptoEngine.exportKey(key);

      /* 2️⃣ Generate secret ID */

      const id = generateId();

      /* 3️⃣ Expiry */

      const duration = expirySelect.value;
      const expiresAt = calcExpiry(duration);

      /* 4️⃣ Store encrypted secret in Supabase */

      const { error } = await supabaseClient
        .from("secrets")
        .insert([{
          id: id,
          ciphertext: CryptoEngine.uint8ToBase64url(ciphertext),
          iv: CryptoEngine.uint8ToBase64url(iv),
          created_at: Date.now(),
          expires_at: expiresAt,
          view_count: 0
        }]);

      if (error) {
        console.error(error);
        alert("Error storing secret");
        return;
      }

      /* 5️⃣ Generate shareable link */

      const baseUrl =
        `${location.origin}${location.pathname.replace("index.html","")}secret.html`;

      const link =
        `${baseUrl}?id=${id}#key=${exportedKey}`;

      linkOutput.value = link;

      expiryLabel.textContent =
        `Expires in ${formatTimeLeft(expiresAt)} · One-time view`;

      resultSection.classList.remove("hidden");

    } catch (err) {
      console.error(err);
      alert("Encryption failed");
    }

  });

  copyBtn.addEventListener("click",
    () => copyToClipboard(linkOutput.value, copyBtn)
  );

}

/* ---------------- VIEW PAGE ---------------- */

async function initViewPage() {

  const stateEl = document.getElementById("view-state");
  if (!stateEl) return;

  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  const fragment =
    new URLSearchParams(location.hash.replace("#", ""));

  const keyB64 = fragment.get("key");

  if (!id || !keyB64) {

    stateEl.innerHTML =
      "<h2>Invalid Link</h2>";

    return;
  }

  /* 1️⃣ Fetch secret from Supabase */

  const { data, error } = await supabaseClient
    .from("secrets")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {

    stateEl.innerHTML =
      "<h2>Secret Not Found</h2>";

    return;
  }

  const record = data;

  /* 2️⃣ Check expiry */

  if (Date.now() > record.expires_at) {

    await supabaseClient
      .from("secrets")
      .delete()
      .eq("id", id);

    stateEl.innerHTML =
      "<h2>Secret Expired</h2>";

    return;
  }

  try {

    /* 3️⃣ Decrypt */

    const key =
      await CryptoEngine.importKey(keyB64);

    const ciphertext =
      CryptoEngine.base64urlToUint8(record.ciphertext);

    const iv =
      CryptoEngine.base64urlToUint8(record.iv);

    const plaintext =
      await CryptoEngine.decrypt(ciphertext, iv, key);

    /* 4️⃣ Delete secret (one-time view) */

    await supabaseClient
      .from("secrets")
      .delete()
      .eq("id", id);

    /* 5️⃣ Show secret */

    stateEl.innerHTML = `
      <h2>Your Secret</h2>
      <pre>${plaintext}</pre>
      <button id="copy-secret">Copy</button>
    `;

    document
      .getElementById("copy-secret")
      .addEventListener("click",
        () => navigator.clipboard.writeText(plaintext)
      );

  }

  catch (err) {

    console.error(err);

    await supabaseClient
      .from("secrets")
      .delete()
      .eq("id", id);

    stateEl.innerHTML =
      "<h2>Decryption Failed</h2>";
  }

}

/* ---------------- BOOTSTRAP ---------------- */

document.addEventListener("DOMContentLoaded", () => {

  if (document.getElementById("secret-form"))
    initCreatePage();

  if (document.getElementById("view-state"))
    initViewPage();

});
