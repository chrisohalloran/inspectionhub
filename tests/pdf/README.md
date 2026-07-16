# Recipient PDF validation

Build the reporting package, then run the Poppler-backed parity and rendering
gate:

```sh
pnpm --filter @inspection/reporting build
node tests/pdf/run.mjs
```

The gate generates separate Building and Timber Pest formal records from the
same immutable semantic report snapshot used by the HTML portal. It checks A4
page metadata, marked-content intent, required semantic text, prohibited text,
page count, and rasterises every page at 144 DPI. PDF and rendered-page hashes
are compared with the reviewed baseline when the same Poppler version is in
use.

Intermediate PDFs, extracted text, PNG pages and the observed manifest are
written to `tmp/pdfs/u9/`. They are validation artifacts, not source of truth,
and should be removed after visual inspection.
