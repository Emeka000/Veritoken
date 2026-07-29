/**
 * Frontend compatibility surface for the canonical SDK transaction pipeline.
 *
 * Keep this module so existing frontend imports remain stable, but never
 * duplicate transaction lifecycle or error logic here. Runtime classes are
 * re-exported directly, so `instanceof` checks behave identically in SDK and
 * frontend consumers.
 */
export {
  TxPipeline,
  SequenceCache,
  TxError,
  SequenceError,
  SimulationError,
  SigningError,
  SubmissionError,
  ConfirmError,
  TimeoutError,
  TransientError,
  isTransientError,
} from "@veritoken/sdk";

export type {
  PipelineOptions,
  ReadResult,
  WriteResult,
} from "@veritoken/sdk";
