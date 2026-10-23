# Fixtures (offline / test only)

These fixtures exist **only** for offline development and automated tests. They are
**clearly labeled** and are **never** used as a silent fallback for a failing AWS call —
the main end-to-end workflow always uses the real AWS integrations. If an AWS call fails,
the app surfaces the error; it does not substitute a fixture.

Contents:

- `retrieval.sample.json` — a small set of pre-chunked passages with the shape the
  OpenSearch index stores (minus embeddings). Useful for unit-testing ranking/citation
  rendering without network access.

To use a fixture in a test, import it explicitly from the test file. There is no runtime
code path that loads these automatically.
