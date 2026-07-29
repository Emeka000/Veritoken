/**
 * Backward-compatible entry point for the canonical frontend contract clients.
 *
 * The implementation lives in `./contracts/index.ts`. Keeping this facade
 * prevents extensionless imports from resolving to the former parallel carbon
 * client implementation.
 */
export * from "./contracts/index";
