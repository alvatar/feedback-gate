export {
  getOrderedProviders,
  detectAutoProviderPriority,
  sortProvidersByPriority,
} from './auth-order.js';
export type { AuthProviderOrderingEnvironment } from './auth-order.js';
export { FeedbackGate } from './feedback-gate.js';
export { FeedbackGateError, createSubmissionPayload, prepareSubmission } from './payload.js';
export { buildEndpointUrl, submitFeedback } from './transport.js';
export type {
  FeedbackAuthConfig,
  FeedbackAuthProvider,
  FeedbackClassNames,
  FeedbackContextConfig,
  FeedbackCustomField,
  FeedbackCustomFieldContext,
  FeedbackField,
  FeedbackFieldOption,
  FeedbackGateConfig,
  FeedbackMessageConfig,
  FeedbackPrivacyConfig,
  FeedbackRequestConfig,
  FeedbackResult,
  FeedbackStrings,
  FeedbackSubmissionPayload,
  FeedbackTheme,
  FeedbackTriggerConfig,
  FeedbackUser,
  PreparedSubmission,
} from './types.js';
