// Shared fetch helper (safe, no dependencies).
// Returns a normalized object and reads the body only once.

(() => {
  async function ghFetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      text,
      headers: res.headers,
    };
  }

  window.ghFetchJson = ghFetchJson;
})();

