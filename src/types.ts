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

export interface FeedbackUser {
  id: string;
  email?: string;
  name?: string;
  provider?: string;
  [key: string]: unknown;
}

export interface FeedbackAuthProvider {
  id: string;
  label: string;
}

export interface FeedbackAuthConfig {
  required?: boolean;
  providers?: FeedbackAuthProvider[];
  getUser?: () => Promise<FeedbackUser | null> | FeedbackUser | null;
  getHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  login?: (providerId: string) => Promise<FeedbackUser | null | void> | FeedbackUser | null | void;
}

export interface FeedbackPrivacyConfig {
  shareEmailByDefault?: boolean;
  allowUserToggle?: boolean;
}

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
  loginRequired?: string;
  authTitle?: string;
  authDescription?: string;
  checkingAuthLabel?: string;
  signedInPrefix?: string;
  shareEmailLabel?: string;
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
  auth?: FeedbackAuthConfig;
  privacy?: FeedbackPrivacyConfig;
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
  user: FeedbackUser | null;
  meta: Record<string, unknown>;
}

export interface PreparedSubmission {
  payload: FeedbackSubmissionPayload;
  headers: Record<string, string>;
}
