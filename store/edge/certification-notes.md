# Edge Certification Notes — 0.5.0

## Reviewer summary

Multi AI Workbench is an independent, free, open-source browser extension. It has no extension account, paid entitlement, API-key field, telemetry, advertising SDK, or operator-run prompt proxy. It includes an optional Featured AI Tools catalog with clearly labeled affiliate links. The catalog is remote data, not executable code, and can be hidden in Settings.

## Why third-party sign-in may appear

Some supported AI services require their own accounts. These are not accounts controlled by this extension, so the publisher cannot provide shared certification credentials. The reviewer may use an existing authorized account or test the extension shell, platform management, side panel, local prompt actions, history, privacy flow, and new-tab fallback without signing in. The extension does not bypass sign-in, CAPTCHA, subscription, or platform usage limits.

## Test path

1. Install the submitted ZIP and click the toolbar icon.
2. On first launch, choose Chinese or English, review the data-flow disclosure, keep the default “supported sites only” pet scope if desired, and continue.
3. Confirm that the full-page workbench opens with DeepSeek, Doubao, and Tencent Yuanbao selected.
4. Enter a harmless test question and select “Ask all”. Signed-in services should receive the question; a service that requires authentication or changes its page structure shows a clear status and offers “Open in new tab”.
5. Use the platform-management button to add or remove services. Confirm one-row and two-row layouts and drag ordering.
6. Open the Edge side panel from the workbench. Confirm that the workbench tab closes and that the side panel shows DeepSeek by default. Switch service tabs and send to more than one selected service.
7. From the side panel, open full-page mode. Confirm that the side panel closes and the workbench opens.
8. Select text on a normal HTTPS page, right-click, and choose the extension's Translation, Summary, or Explanation operation. Alternatively use `Alt+Shift+P` to open the action picker.
9. In Settings, inspect or edit prompt actions and shortcut slots. All such data remains in extension storage.
10. Open Featured AI Tools from the top toolbar. Confirm the Sponsored label, bilingual disclosure, empty state or currently active catalog, and the option to hide the entry.
11. Open Privacy Policy from Settings and switch between Chinese and English.

## DNR behavior

The extension uses 14 enabled static rulesets: one for each of 13 AI-service groups and one for supported search/content services. Every rule is limited to explicitly listed `requestDomains` and `resourceTypes: ["sub_frame"]`. The rules remove CSP, CSP Report Only, and X-Frame-Options response headers so official pages can render in the comparison workbench. They do not modify ordinary top-level navigation, request bodies, cookies, or credentials.

## Optional broad host access

The optional `http://*/*` and `https://*/*` host access is requested only if the user chooses to show the local pet launcher on all regular websites. Declining this request automatically uses supported-sites-only scope and does not disable the core extension.

## Network and code

- The extension fetches signed JSON and catalog icons from `multi-ai-workbench-catalog.pages.dev` and `joelovechen.github.io`. These requests do not contain prompts, answers, files, history, or an extension-generated user identifier.
- No remote JavaScript or WebAssembly is loaded.
- Questions and attachments go directly to user-selected third-party services after a user action.
- All executable extension code, pet animations, and core product assets are packaged locally. Catalog icons are remote display data restricted to the two declared catalog origins.
