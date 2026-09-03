# Affiliate catalog maintenance

The catalog is remote data, not executable extension code. Its two public mirrors must serve identical signed bytes.

## Publish or change a tool

1. Edit `catalog.json` and use only a verified affiliate destination owned by the listed provider.
2. Set `status` to `active` and `visible` to `true` only after the link, disclosure, icon rights, and localized copy have been checked.
3. Increase `version`, refresh `generatedAt`, and set a new `expiresAt`.
4. Run `npm run catalog:validate` and `npm run catalog:sign` from the extension source directory.
5. Commit `catalog.json`, `catalog.sig`, and any authorized icons together.
6. Confirm both Pages endpoints return the same catalog bytes and signature before announcing the change.

To remove a promotion immediately, set the entry to `inactive` or `visible: false`, increase the catalog version, sign, and publish again. Never commit the private signing key.
