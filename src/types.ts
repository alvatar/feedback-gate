export type FeedbackFieldOption =
  | string
  | {
      label: string;
      value: string;
    };

interface FeedbackFieldBase {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface FeedbackTextField extends FeedbackFieldBase {
  type: 'text' | 'email';
  placeholder?: string;
  initialValue?: string;
  autocomplete?: string;
}

export interface FeedbackTextareaField extends FeedbackFieldBase {
  type: 'textarea';
  placeholder?: string;
  initialValue?: string;
  rows?: number;
}

export interface FeedbackSelectField extends FeedbackFieldBase {
  type: 'select';
  placeholder?: string;
  options: FeedbackFieldOption[];
  initialValue?: string;
}

export interface FeedbackCustomFieldContext {
  id: string;
  name: string;
  root: HTMLDivElement;
}

export interface FeedbackCustomField extends FeedbackFieldBase {
  type: 'custom';
  render: (context: FeedbackCustomFieldContext) => HTMLElement;
  getValue: (context: FeedbackCustomFieldContext) => unknown;
}

export type FeedbackField =
  | FeedbackTextField
  | FeedbackTextareaField
  | FeedbackSelectField
  | FeedbackCustomField;

export interface FeedbackMessageConfig {
  label?: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
}

export interface FeedbackTheme {
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  overlayColor: string;
  borderColor: string;
  borderRadius: string;
  zIndex: string;
}

export interface FeedbackClassNames {
  trigger: string;
  overlay: string;
  panel: string;
  header: string;
  form: string;
  field: string;
  input: string;
  actions: string;
  cancelButton: string;
  submitButton: string;
  status: string;
}

export interface FeedbackRequestConfig {
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  query?:
    | Record<string, string>
    | (() => Promise<Record<string, string>> | Record<string, string>);
}

export interface FeedbackTurnstileConfig {
  siteKey: string;
  action?: string;
  scriptUrl?: string;
  tokenTimeoutMs?: number;
}

export interface FeedbackProtectionConfig {
  turnstile?: FeedbackTurnstileConfig;
}

export interface FeedbackContextConfig {
  site?: string;
  page?: string;
  meta?: Record<string, unknown>;
  getMeta?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface FeedbackTriggerConfig {
  text?: string;
  ariaLabel?: string;
  container?: string | HTMLElement;
}

export interface FeedbackStrings {
  title?: string;
  description?: string;
  submitLabel?: string;
  cancelLabel?: string;
  sendingLabel?: string;
  genericError?: string;
}

export interface FeedbackResult {
  payload: FeedbackSubmissionPayload;
  response: Response;
}

export interface FeedbackGateConfig {
  endpoint: string;
  target?: string | HTMLElement;
  trigger?: FeedbackTriggerConfig;
  fields?: FeedbackField[];
  message?: FeedbackMessageConfig;
  protection?: FeedbackProtectionConfig;
  request?: FeedbackRequestConfig;
  context?: FeedbackContextConfig;
  strings?: FeedbackStrings;
  theme?: Partial<FeedbackTheme>;
  classes?: Partial<FeedbackClassNames>;
  onSuccess?: (result: FeedbackResult) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface FeedbackSubmissionPayload {
  timestamp: string;
  site: string;
  page: string;
  message: string;
  fields: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface FeedbackVerificationPayload {
  turnstileToken?: string;
  honeypot?: string;
}

export interface FeedbackSubmissionRequestBody {
  payload: FeedbackSubmissionPayload;
  verification?: FeedbackVerificationPayload;
}

export interface PreparedSubmission {
  payload: FeedbackSubmissionPayload;
  headers: Record<string, string>;
}
