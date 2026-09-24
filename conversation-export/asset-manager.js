(function initAssetManager(global) {
  "use strict";
  const core = global.MultiAIConversationExport;

  const blobToDataUrl = (blob) => {
    if (typeof FileReader !== "undefined") {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }
    return blob.arrayBuffer().then((buf) => {
      const b64 = Buffer.from(buf).toString("base64");
      return `data:${blob.type || "application/octet-stream"};base64,${b64}`;
    });
  };

  const dataUrlToBlob = async (dataUrl) => {
    if (typeof fetch !== "undefined") {
      try {
        const res = await fetch(dataUrl);
        return await res.blob();
      } catch (_) {}
    }
    const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      const mime = match[1];
      const binary = typeof atob === "function" ? atob(match[2]) : Buffer.from(match[2], "base64").toString("binary");
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([], { type: "application/octet-stream" });
  };

  function validateImageBytes(bytes, declaredMime = "") {
    if (!bytes || bytes.length === 0) return false;
    const text = String.fromCharCode(...bytes.slice(0, 16)).trim().toLowerCase();
    if (text.startsWith("<!") || text.startsWith("<html") || (text.startsWith("<?xml") && text.includes("error")) || text.startsWith("{\"error\"")) {
      return false;
    }
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
    // GIF: 47 49 46 38
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
    // WEBP: RIFF....WEBP (52 49 46 46)
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
    // BMP: 42 4D
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return true;
    // SVG
    if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return true;
    // If declared mime is image/* and not HTML error
    if (declaredMime && declaredMime.startsWith("image/")) return true;
    return true;
  }

  async function tryDirectFetch(targetUrl, signal) {
    const isSameOrigin = typeof location !== "undefined" && typeof location.origin === "string" && targetUrl.startsWith(location.origin);
    const credentials = isSameOrigin ? "include" : "omit";
    const response = await fetch(targetUrl, {
      credentials,
      signal,
      cache: "no-store",
      headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (mime.includes("text/html") || mime.includes("application/json")) {
      throw new Error(`invalid_mime:${mime}`);
    }
    const blob = await response.blob();
    if (!blob || blob.size === 0) throw new Error("empty_blob");
    const headerBytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (!validateImageBytes(headerBytes, mime)) throw new Error("invalid_image_signature");
    return {
      url: targetUrl,
      blob,
      mime: mime || blob.type || "image/png",
      dataUrl: await blobToDataUrl(blob),
    };
  }

  async function tryBackgroundFetch(targetUrl) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return null;
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: "FETCH_IMAGE_BASE64", url: targetUrl }, async (res) => {
          if (chrome.runtime?.lastError || !res?.ok || !res.dataUrl) return resolve(null);
          try {
            const blob = await dataUrlToBlob(res.dataUrl);
            if (!blob || blob.size === 0) return resolve(null);
            const headerBytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
            if (!validateImageBytes(headerBytes, res.mime)) return resolve(null);
            resolve({
              url: targetUrl,
              blob,
              mime: res.mime || blob.type || "image/png",
              dataUrl: res.dataUrl,
            });
          } catch (_) {
            resolve(null);
          }
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function tryContentTabFetch(sourceTabId, targetUrl) {
    if (!sourceTabId || typeof chrome === "undefined" || !chrome.tabs?.sendMessage) return null;
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(sourceTabId, { action: "MAIW_FETCH_EXPORT_ASSET", url: targetUrl }, async (res) => {
          if (chrome.runtime?.lastError || !res?.ok || !res.dataUrl) return resolve(null);
          try {
            const blob = await dataUrlToBlob(res.dataUrl);
            if (!blob || blob.size === 0) return resolve(null);
            const headerBytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
            if (!validateImageBytes(headerBytes, res.mime)) return resolve(null);
            resolve({
              url: targetUrl,
              blob,
              mime: res.mime || blob.type || "image/png",
              dataUrl: res.dataUrl,
            });
          } catch (_) {
            resolve(null);
          }
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  class AssetManager {
    constructor({ sourceTabId = null, onProgress = null } = {}) {
      this.sourceTabId = sourceTabId;
      this.onProgress = onProgress;
      this.cache = new Map();
      this.objectUrls = new Set();
    }

    async fetch(url, signal, candidates = []) {
      if (!url) throw new Error("asset_url_missing");
      if (this.cache.has(url)) return this.cache.get(url);
      if (Array.isArray(candidates)) {
        for (const c of candidates) {
          if (c && this.cache.has(c)) return this.cache.get(c);
        }
      }
      const task = this.fetchUncached(url, signal, candidates);
      this.cache.set(url, task);
      if (Array.isArray(candidates)) {
        for (const c of candidates) {
          if (c) this.cache.set(c, task);
        }
      }
      try {
        return await task;
      } catch (error) {
        this.cache.delete(url);
        if (Array.isArray(candidates)) {
          for (const c of candidates) {
            if (c) this.cache.delete(c);
          }
        }
        throw error;
      }
    }

    async fetchUncached(url, signal, candidates = []) {
      if (url.startsWith("data:")) {
        const blob = await dataUrlToBlob(url);
        return { url, blob, mime: blob.type || "image/png", dataUrl: url };
      }
      const candidateList = Array.from(new Set([url, ...(Array.isArray(candidates) ? candidates : [])].filter(Boolean)));
      const errors = [];

      for (const candidateUrl of candidateList) {
        if (candidateUrl.startsWith("data:")) {
          const blob = await dataUrlToBlob(candidateUrl);
          return { url, blob, mime: blob.type || "image/png", dataUrl: candidateUrl };
        }
        // Tier 1: Direct fetch
        try {
          const res = await tryDirectFetch(candidateUrl, signal);
          if (res) return res;
        } catch (directError) {
          errors.push(`direct(${candidateUrl}): ${directError.message}`);
        }

        // Tier 2: Background Service Worker bridge
        if (!signal?.aborted) {
          try {
            const bgRes = await tryBackgroundFetch(candidateUrl);
            if (bgRes) return bgRes;
          } catch (bgError) {
            errors.push(`bg(${candidateUrl}): ${bgError.message}`);
          }
        }

        // Tier 3: Content Script bridge
        if (!signal?.aborted && this.sourceTabId) {
          try {
            const tabRes = await tryContentTabFetch(this.sourceTabId, candidateUrl);
            if (tabRes) return tabRes;
          } catch (tabError) {
            errors.push(`tab(${candidateUrl}): ${tabError.message}`);
          }
        }
      }

      throw new Error(errors.join(" | ") || "asset_fetch_failed");
    }

    async resolve(conversation, { signal, includeAttachments = true } = {}) {
      const assets = core.collectAssets(conversation).filter((asset) => includeAttachments || asset.kind !== "attachment");
      const resolved = new Map();
      const failures = [];
      let cursor = 0, completed = 0;

      const worker = async () => {
        for (;;) {
          const index = cursor++;
          if (index >= assets.length) return;
          const asset = assets[index];
          try {
            const item = await this.fetch(asset.url, signal, asset.candidates);
            resolved.set(asset.url, item);
            if (Array.isArray(asset.candidates)) {
              for (const c of asset.candidates) {
                if (c) resolved.set(c, item);
              }
            }
          } catch (error) {
            failures.push({ ...asset, reason: error.message || "asset_fetch_failed" });
          }
          completed += 1;
          this.onProgress?.({ phase: "assets", completed, total: assets.length, asset });
        }
      };

      await Promise.all(Array.from({ length: Math.min(4, Math.max(1, assets.length)) }, worker));
      return { assets, resolved, failures };
    }

    embeddedConversation(conversation, resolved) {
      const copy = typeof structuredClone === "function" ? structuredClone(conversation) : JSON.parse(JSON.stringify(conversation));
      const replace = (value) => {
        if (typeof value === "string") return resolved.get(value)?.dataUrl || value;
        if (Array.isArray(value)) return value.map(replace);
        if (value && typeof value === "object") {
          for (const key of Object.keys(value)) value[key] = replace(value[key]);
        }
        return value;
      };
      return replace(copy);
    }

    objectUrl(blob) {
      const url = URL.createObjectURL(blob);
      this.objectUrls.add(url);
      return url;
    }

    cleanup() {
      for (const url of this.objectUrls) URL.revokeObjectURL(url);
      this.objectUrls.clear();
    }
  }

  global.MultiAIAssetManager = Object.freeze({ AssetManager, blobToDataUrl, dataUrlToBlob });
})(typeof self !== "undefined" ? self : globalThis);
