(function initMultiAIMainWorldBridge() {
  "use strict";
  if (globalThis.__multiAiMainWorldReady) return;
  globalThis.__multiAiMainWorldReady = true;

  // Export adapters need the same ephemeral request metadata already used by the
  // signed-in page. Keep it in memory only; never persist tokens or request bodies.
  const exportCapture = {
    chatgpt: {},
    gemini: {},
    notebooklm: {},
    kimi: {},
    perplexity: null,
    doubao: null,
    aistudio: {},
  };
  const headerObject = (headers) => {
    const output = {};
    try {
      new Headers(headers || {}).forEach((value, key) => {
        output[key] = value;
      });
    } catch {
      /* malformed page headers */
    }
    return output;
  };
  const rememberRequest = async (input, init = {}) => {
    let url = "",
      method = init.method || "GET",
      headers = headerObject(init.headers),
      body = init.body ?? null;
    try {
      const request = input instanceof Request ? input : null;
      url = new URL(request?.url || String(input), location.href).href;
      if (request) {
        method = init.method || request.method;
        headers = { ...headerObject(request.headers), ...headers };
        if (body == null && !/^(GET|HEAD)$/i.test(method))
          body = await request.clone().text();
      }
    } catch {
      return;
    }
    const parsed = new URL(url),
      lower = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      );
    if (
      parsed.hostname === "chatgpt.com" &&
      parsed.pathname.startsWith("/backend-api/") &&
      lower.authorization
    )
      exportCapture.chatgpt = {
        authorization: lower.authorization,
        extraHeaders: Object.fromEntries(
          Object.entries(headers).filter(([key]) =>
            ["oai-device-id", "oai-language"].includes(key.toLowerCase()),
          ),
        ),
      };
    if (
      parsed.hostname.endsWith("kimi.ai") ||
      parsed.hostname.endsWith("kimi.com")
    ) {
      if (
        parsed.pathname.includes("/kimi.gateway.chat") &&
        parsed.pathname.endsWith("/ListMessages")
      )
        exportCapture.kimi = {
          url,
          authorization: lower.authorization || "",
          extraHeaders: Object.fromEntries(
            Object.entries(headers).filter(([key]) =>
              [
                "x-language",
                "x-msh-device-id",
                "x-msh-platform",
                "x-msh-session-id",
                "x-msh-version",
                "x-traffic-id",
                "r-timezone",
              ].includes(key.toLowerCase()),
            ),
          ),
        };
    }
    if (
      parsed.origin === "https://www.perplexity.ai" &&
      /^\/rest\/thread\/[^/]+$/.test(parsed.pathname) &&
      parsed.searchParams.has("supported_block_use_cases")
    )
      exportCapture.perplexity = { url, headers };
    if (
      parsed.origin === "https://www.doubao.com" &&
      parsed.pathname === "/im/chain/single" &&
      typeof body === "string"
    )
      try {
        const value = JSON.parse(body);
        if (value?.uplink_body?.pull_singe_chain_uplink_body)
          exportCapture.doubao = {
            url,
            headers: Object.fromEntries(
              Object.entries(headers).filter(([key]) =>
                ["content-type", "agw-js-conv"].includes(key.toLowerCase()),
              ),
            ),
            body: value,
          };
      } catch {
        /* not JSON */
      }
    if (
      parsed.hostname === "aistudio.google.com" &&
      parsed.pathname.includes("MakerSuiteService/ResolveDriveResource")
    )
      exportCapture.aistudio.resolveUrl = url;
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function interceptedFetch(input, init) {
    void rememberRequest(input, init);
    return originalFetch.apply(this, arguments);
  };
  const originalOpen = XMLHttpRequest.prototype.open,
    originalSend = XMLHttpRequest.prototype.send,
    originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__maiwExportUrl = new URL(String(url), location.href).href;
    this.__maiwExportMethod = method;
    this.__maiwExportHeaders = {};
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__maiwExportHeaders) this.__maiwExportHeaders[name] = value;
    return originalSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__maiwExportUrl || "";
    try {
      const parsed = new URL(url);
      if (
        parsed.hostname === "gemini.google.com" &&
        parsed.pathname.includes("/data/batchexecute")
      ) {
        exportCapture.gemini.reqId =
          parsed.searchParams.get("_reqid") || exportCapture.gemini.reqId;
        for (const [key, value] of Object.entries(
          this.__maiwExportHeaders || {},
        ))
          if (key.toLowerCase().startsWith("x-goog-ext-"))
            (exportCapture.gemini.extHeaders ||= {})[key] = value;
      }
      if (
        ["notebook.google.com", "notebooklm.google.com"].includes(
          parsed.hostname,
        ) &&
        parsed.pathname.includes("/data/batchexecute")
      ) {
        exportCapture.notebooklm.reqId =
          parsed.searchParams.get("_reqid") || exportCapture.notebooklm.reqId;
        const params = new URLSearchParams(
          typeof body === "string"
            ? body
            : body instanceof URLSearchParams
              ? body.toString()
              : "",
        );
        exportCapture.notebooklm.atToken =
          params.get("at") || exportCapture.notebooklm.atToken;
        try {
          const rpc = JSON.parse(params.get("f.req") || "[]")?.[0]?.[0];
          if (rpc?.[0] === "khqZz")
            exportCapture.notebooklm.conversationUuid =
              JSON.parse(rpc[1])?.[3] ||
              exportCapture.notebooklm.conversationUuid;
        } catch {
          /* request shape changed */
        }
      }
    } catch {
      /* ignore capture errors */
    }
    void rememberRequest(url, {
      method: this.__maiwExportMethod,
      headers: this.__maiwExportHeaders,
      body,
    });
    return originalSend.apply(this, arguments);
  };

  function queryDeep(selector, root = document) {
    const found = [];
    const visit = (scope) => {
      try {
        found.push(...scope.querySelectorAll(selector));
      } catch {
        return;
      }
      let elements = [];
      try {
        elements = scope.querySelectorAll("*");
      } catch {
        return;
      }
      for (const element of elements)
        if (element.shadowRoot) visit(element.shadowRoot);
    };
    visit(root);
    return found;
  }
  function first(selectors) {
    for (const selector of selectors || []) {
      const value = queryDeep(selector)[0];
      if (value) return value;
    }
    return null;
  }
  function bestFileInput(selectors) {
    const values = [];
    for (const selector of selectors || []) values.push(...queryDeep(selector));
    return (
      [...new Set(values)]
        .filter(
          (element) =>
            element instanceof HTMLInputElement && element.type === "file",
        )
        .sort((left, right) => score(right) - score(left))[0] || null
    );
    function score(input) {
      const description = `${input.accept || ""} ${input.outerHTML || ""}`;
      if (/avatar|头像|profile/i.test(description)) return -100;
      return (
        Number(input.multiple) * 8 +
        Number(/image|pdf|text|doc|sheet|\*/i.test(input.accept || "")) * 5
      );
    }
  }
  function setValue(element, value) {
    element.focus();
    element.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertText",
        data: value,
      }),
    );
    if (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement
    ) {
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
        element,
        value,
      );
    } else {
      element.textContent = "";
      try {
        document.execCommand("insertText", false, value);
      } catch {
        element.textContent = value;
      }
      if (!String(element.textContent || "").trim())
        element.textContent = value;
    }
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: value,
      }),
    );
    element.dispatchEvent(
      new Event("change", { bubbles: true, composed: true }),
    );
  }
  function toFiles(attachments) {
    const transfer = new DataTransfer();
    for (const item of attachments || []) {
      const bytes = Uint8Array.from(atob(item.data || ""), (char) =>
        char.charCodeAt(0),
      );
      transfer.items.add(
        new File([bytes], item.name, {
          type: item.type || "application/octet-stream",
        }),
      );
    }
    return transfer;
  }
  function respond(id, result) {
    document.dispatchEvent(
      new CustomEvent("maiw:main-response", { detail: { id, ...result } }),
    );
  }

  document.addEventListener(
    "maiw:main-request",
    (event) => {
      const request = event.detail || {},
        id = request.id;
      if (!id) return;
      try {
        if (request.action === "PING") return respond(id, { ok: true });
        if (request.action === "EXPORT_GET_CONTEXT")
          return respond(id, {
            ok: true,
            context: structuredClone(exportCapture),
            globals: {
              wiz: globalThis.WIZ_global_data || null,
              aiStudioKeys: globalThis.AF_initDataKeys || null,
            },
          });
        if (request.action === "EXPORT_CHATGPT_SHARE_DATA") {
          const context = globalThis.__reactRouterContext;
          Promise.resolve(context?.loaderData)
            .then(async (loaderData) => {
              if (!loaderData || typeof loaderData !== "object")
                throw Error("share_loader_data_missing");
              const routeKey = Object.keys(loaderData).find((key) =>
                key.startsWith("routes/share."),
              );
              if (!routeKey) throw Error("share_route_data_missing");
              const response = await loaderData[routeKey]?.serverResponse;
              const data = response?.data;
              if (
                response?.type !== "data" ||
                !data?.mapping ||
                typeof data.mapping !== "object"
              )
                throw Error("share_conversation_data_invalid");
              respond(id, { ok: true, data: structuredClone(data) });
            })
            .catch((error) =>
              respond(id, { ok: false, reason: error.message }),
            );
          return;
        }
        if (request.action === "EXPORT_PAGE_FETCH") {
          const options = request.options || {},
            allowed = new URL(String(request.url || ""), location.href);
          const aiStudioRpc =
            location.hostname === "aistudio.google.com" &&
            allowed.hostname === "alkalimakersuite-pa.clients6.google.com";
          if (allowed.origin !== location.origin && !aiStudioRpc)
            return respond(id, { ok: false, reason: "cross_origin_blocked" });
          const body =
            options.body == null
              ? undefined
              : options.rawBody
                ? String(options.body)
                : JSON.stringify(options.body);
          originalFetch(allowed.href, {
            method: options.method || "GET",
            credentials: "include",
            headers: options.headers || {},
            body,
          })
            .then(async (response) => {
              const text = await response.text();
              let data = text;
              try {
                data = JSON.parse(text);
              } catch {
                /* text response */
              }
              respond(id, {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                data,
              });
            })
            .catch((error) =>
              respond(id, { ok: false, reason: error.message }),
            );
          return;
        }
        if (request.action === "SET_INPUT") {
          const input = first(request.selectors);
          if (!input)
            return respond(id, { ok: false, reason: "input_not_found" });
          setValue(input, String(request.value || ""));
          return respond(id, { ok: true });
        }
        if (request.action === "ASSIGN_FILES") {
          const input = bestFileInput(request.selectors);
          if (!input)
            return respond(id, { ok: false, reason: "file_input_not_found" });
          const transfer = toFiles(request.attachments);
          input.files = transfer.files;
          input.dispatchEvent(
            new Event("input", { bubbles: true, composed: true }),
          );
          input.dispatchEvent(
            new Event("change", { bubbles: true, composed: true }),
          );
          return respond(id, {
            ok: input.files?.length === transfer.files.length,
            assigned: input.files?.length || 0,
          });
        }
        respond(id, { ok: false, reason: "unknown_action" });
      } catch (error) {
        respond(id, {
          ok: false,
          reason: "main_world_error",
          detail: error.message,
        });
      }
    },
    true,
  );
})();
