# Store navigation — 9 October 2026

The horizontal category strip is replaced by a desktop Categories dropdown and a mobile menu button at the far right of the header. Desktop category names wrap inside a two/three-column panel. Mobile opens a vertical drawer with a fixed title/close button and a independently scrollable list. No sideways navigation is required.

`src/components/site-header.tsx` reads active categories from `storeCategories()`. It passes serializable category names/slugs and page links to `src/components/store-navigation.tsx`; private supplier data never enters navigation. Inicio and Contacto are always included. Envíos and Preguntas frecuentes appear only if those policy pages are enabled in the existing store settings. Tracking remains in the top bar and mobile drawer. Search, favorites, cart and optional customer account remain available; the customer account moves into the drawer on small screens.

The mobile dialog uses the existing Radix dependency for focus trapping, Escape, overlay dismissal and focus return. Selecting a link closes it. Resizing to desktop closes the drawer. The desktop native disclosure supports keyboard navigation, closes on Escape/outside click and after route navigation. Existing category test IDs and `data-slug` values are preserved; browser helpers now open the visible navigation before choosing a category.

Validation at this stage: production webpack build, TypeScript and lint passed. Full local tests: 1,073 passed, 840 integration tests skipped because no disposable local test database is configured. Navigation interaction tests cover category URLs, page links, dismissal and the supplied category list. No production database steps were run. GitHub CI status is recorded in the release follow-up.

Browser verification used the production build on a database-disabled localhost preview, not the live catalog. Phone widths 320 and 390 and desktop widths 1024 and 1440 fit without horizontal overflow. The 320-pixel drawer had clientWidth=scrollWidth=319. Escape returned focus to the menu trigger; Shift+Tab wrapped inside the dialog; category navigation closed it. The preview's six fallback categories are not evidence of the live nine-category count. Photos and the 262-product publication are documented separately.

The menu update does not fix an upstream HTTP 429/428. Live publication/deployment and the owner-reported 428 must be distinguished from local rendering. See [Workers assessment and CDN diagnosis](WORKERS-ASSESSMENT-2026-10-09.md).

To edit category names/visibility, use the existing admin category editor. To enable policy pages, use store settings. For menu layout/copy, edit only the header/navigation components and their interaction tests. Keep pricing, stock, orders, session protections and schema out of UI changes. Roll back by reverting the menu PR and redeploying; no database rollback is needed.
