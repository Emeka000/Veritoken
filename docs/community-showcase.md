# Community Showcase

This page collects integrations, extensions, and reference implementations built on top of Veritoken. It is maintained by the project maintainers and updated as the ecosystem grows.

If you have built something with Veritoken and would like to be listed here, see [How to contribute an example](#how-to-contribute-an-example) below.

---

## Featured Integrations

*This section will grow as the community builds on Veritoken. Be the first to submit an integration — see the contribution guide below.*

| Project | Description | Author | Link |
|---|---|---|---|
| *(your project here)* | *(a short description of what it does)* | *(GitHub handle)* | *(repo or demo URL)* |

---

## Reference Implementations

The following examples ship directly in this repository and serve as starting points for new integrations:

| Example | Language | What it demonstrates |
|---|---|---|
| [`docs/examples/python_example.py`](examples/python_example.py) | Python 3.10+ | Reading compliance rules, checking KYC state, submitting a transfer |
| [`docs/examples/javascript_example.js`](examples/javascript_example.js) | JavaScript (Node.js) | Same three workflows via raw Stellar SDK calls |
| [`docs/examples/sdk_client_factory_example.ts`](examples/sdk_client_factory_example.ts) | TypeScript | SDK client factory pattern (`createClients`) with mock injection for tests |

See [`docs/examples/README.md`](examples/README.md) for setup instructions and how each example maps to the TypeScript SDK.

---

## Extension Points

Veritoken is designed to be forked and extended. Common extension patterns include:

### New asset types

Extend `rwa-token` by adding asset-specific lifecycle logic (e.g. settlement, maturity, coupon payments) while reusing the compliance layer as-is.

```rust
// contracts/my-asset-token/src/lib.rs
// Call compliance-engine::can_transfer before any balance mutation.
```

### Custom compliance rules

Add fields to `ComplianceRules` in `compliance-engine` to encode jurisdiction-specific requirements, accreditation thresholds, or time-based lock-ups.

### Alternative frontends

The TypeScript SDK (`sdk/`) is framework-agnostic. Any frontend that can import an npm package can use it to interact with deployed Veritoken contracts.

### Off-chain anchoring

Every asset contract has an IPFS hash field for linking to legal documents. Off-chain systems can index these events and serve document retrieval without modifying any contract code.

---

## How to contribute an example

1. **Fork** the repository and add your example under `docs/examples/` (scripts, client code) or `contracts/` (new asset types).
2. **Add a row** to the Featured Integrations table above with a short description and a link to your public repository or live demo.
3. **Open a pull request** against `main`. Maintainers will review and merge contributions that are working, documented, and relevant to the Stellar/Veritoken ecosystem.

Please follow the [contribution guide](../CONTRIBUTING.md) and ensure any contract code passes `cargo test --features testutils` before submitting.

---

## Stay Connected

- **Issues** — Feature requests, bug reports, and integration questions: [GitHub Issues](https://github.com/abore9769/Veritoken/issues)
- **Security** — Vulnerability disclosures: see [SECURITY.md](../SECURITY.md)
- **Changelog** — What changed and when: [CHANGELOG.md](../CHANGELOG.md)
