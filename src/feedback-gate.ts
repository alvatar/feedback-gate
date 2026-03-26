import { FeedbackGateError, prepareSubmission } from './payload.js';
import { submitFeedback } from './transport.js';
import { TurnstileController } from './turnstile.js';
import {
  type FeedbackClassNames,
  type FeedbackCustomField,
  type FeedbackCustomFieldContext,
  type FeedbackField,
  type FeedbackFieldOption,
  type FeedbackGateConfig,
  type FeedbackResult,
  type FeedbackSubmissionRequestBody,
  type FeedbackTheme,
} from './types.js';

const DEFAULT_THEME: FeedbackTheme = {
  accentColor: '#111827',
  backgroundColor: '#ffffff',
  surfaceColor: '#ffffff',
  textColor: '#111827',
  mutedTextColor: '#6b7280',
  overlayColor: 'rgba(15, 23, 42, 0.48)',
  borderColor: '#d1d5db',
  borderRadius: '16px',
  zIndex: '2147483647',
};

const DEFAULT_CLASSES: FeedbackClassNames = {
  trigger: '',
  overlay: '',
  panel: '',
  header: '',
  form: '',
  field: '',
  input: '',
  actions: '',
  cancelButton: '',
  submitButton: '',
  status: '',
};

const DEFAULT_STRINGS = {
  title: 'Share feedback',
  description: 'Tell us what happened and what would make this better.',
  submitLabel: 'Send feedback',
  cancelLabel: 'Cancel',
  sendingLabel: 'Sending…',
  genericError: 'Unable to send feedback right now.',
};

const STYLE_ID = 'feedback-gate-styles';
let instanceCount = 0;

type StatusVariant = 'error' | 'idle';

interface MountedElements {
  trigger: HTMLElement;
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  form: HTMLFormElement;
  turnstileContainer: HTMLDivElement;
  honeypotInput: HTMLInputElement;
  status: HTMLParagraphElement;
  message: HTMLTextAreaElement;
  submitButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  dismissButton: HTMLButtonElement;
  customFields: Map<string, FeedbackCustomFieldContext>;
}

export class FeedbackGate {
  private readonly instanceId = ++instanceCount;
  private mountedElements: MountedElements | null = null;
  private mounted = false;
  private isOpen = false;
  private isSubmitting = false;
  private restoreFocusTarget: HTMLElement | null = null;
  private previousBodyOverflow = '';
  private generatedTrigger = false;
  private turnstile: TurnstileController | null = null;

  constructor(private readonly config: FeedbackGateConfig) {
    if (typeof document !== 'undefined') {
      this.mount();
    }
  }

  mount(): void {
    if (this.mounted || typeof document === 'undefined') {
      return;
    }

    ensureStyles();
    const trigger = this.resolveTrigger();
    const elements = this.createModal(trigger);

    trigger.addEventListener('click', this.handleTriggerClick);

    this.mountedElements = elements;
    this.mounted = true;
  }

  open(): void {
    this.mount();
    if (!this.mountedElements || this.isOpen || this.isSubmitting) {
      return;
    }

    this.restoreFocusTarget =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    this.mountedElements.overlay.hidden = false;
    this.isOpen = true;
    this.setStatus('');
    void this.ensureProtectionReady();

    queueMicrotask(() => {
      this.focusFirstFocusable();
    });
  }

  close(force = false): void {
    if (!this.mountedElements || !this.isOpen || (!force && this.isSubmitting)) {
      return;
    }

    this.mountedElements.overlay.hidden = true;
    this.isOpen = false;
    document.body.style.overflow = this.previousBodyOverflow;
    this.restoreFocusTarget?.focus();
  }

  destroy(): void {
    if (!this.mountedElements) {
      return;
    }

    const { trigger, overlay } = this.mountedElements;
    trigger.removeEventListener('click', this.handleTriggerClick);
    this.turnstile?.destroy();
    this.turnstile = null;
    overlay.remove();

    if (this.generatedTrigger) {
      trigger.remove();
    }

    if (this.isOpen) {
      document.body.style.overflow = this.previousBodyOverflow;
    }

    this.mountedElements = null;
    this.mounted = false;
    this.isOpen = false;
  }

  private resolveTrigger(): HTMLElement {
    const target = this.config.target;

    if (target instanceof HTMLElement) {
      return target;
    }

    if (typeof target === 'string') {
      const element = document.querySelector<HTMLElement>(target);
      if (!element) {
        throw new Error(`FeedbackGate target not found: ${target}`);
      }
      return element;
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = this.config.trigger?.text ?? 'Feedback';
    trigger.setAttribute('aria-label', this.config.trigger?.ariaLabel ?? 'Open feedback form');
    trigger.className = joinClasses('feedback-gate-trigger', this.config.classes?.trigger);
    applyTheme(trigger, this.resolveTheme());

    const container = this.resolveTriggerContainer();
    container.appendChild(trigger);
    this.generatedTrigger = true;
    return trigger;
  }

  private resolveTriggerContainer(): HTMLElement {
    const container = this.config.trigger?.container;

    if (container instanceof HTMLElement) {
      return container;
    }

    if (typeof container === 'string') {
      const element = document.querySelector<HTMLElement>(container);
      if (!element) {
        throw new Error(`FeedbackGate trigger container not found: ${container}`);
      }
      return element;
    }

    return document.body;
  }

  private createModal(trigger: HTMLElement): MountedElements {
    const strings = this.resolveStrings();
    const overlay = document.createElement('div');
    const panel = document.createElement('div');
    const header = document.createElement('div');
    const headerCopy = document.createElement('div');
    const title = document.createElement('h2');
    const description = document.createElement('p');
    const dismissButton = document.createElement('button');
    const form = document.createElement('form');
    const turnstileContainer = document.createElement('div');
    const honeypotInput = document.createElement('input');
    const messageField = document.createElement('div');
    const messageLabel = document.createElement('label');
    const messageInput = document.createElement('textarea');
    const fieldsContainer = document.createElement('div');
    const status = document.createElement('p');
    const actions = document.createElement('div');
    const cancelButton = document.createElement('button');
    const submitButton = document.createElement('button');
    const customFields = new Map<string, FeedbackCustomFieldContext>();

    const overlayId = `feedback-gate-overlay-${this.instanceId}`;
    const titleId = `feedback-gate-title-${this.instanceId}`;
    const descriptionId = `feedback-gate-description-${this.instanceId}`;
    const messageId = `feedback-gate-message-${this.instanceId}`;

    overlay.id = overlayId;
    overlay.hidden = true;
    overlay.className = joinClasses('feedback-gate-overlay', this.config.classes?.overlay);
    overlay.dataset.feedbackGate = 'overlay';
    applyTheme(overlay, this.resolveTheme());

    panel.className = joinClasses('feedback-gate-panel', this.config.classes?.panel);
    panel.dataset.feedbackGate = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', titleId);
    panel.setAttribute('aria-describedby', descriptionId);
    panel.tabIndex = -1;
    applyTheme(panel, this.resolveTheme());

    header.className = joinClasses('feedback-gate-header', this.config.classes?.header);
    headerCopy.className = 'feedback-gate-header-copy';

    title.id = titleId;
    title.textContent = strings.title;

    description.id = descriptionId;
    description.textContent = strings.description;

    dismissButton.type = 'button';
    dismissButton.className = 'feedback-gate-dismiss';
    dismissButton.setAttribute('aria-label', 'Close feedback dialog');
    dismissButton.textContent = '×';

    form.className = joinClasses('feedback-gate-form', this.config.classes?.form);
    form.noValidate = true;

    turnstileContainer.className = 'feedback-gate-turnstile';
    turnstileContainer.hidden = !this.config.protection?.turnstile;

    honeypotInput.type = 'text';
    honeypotInput.name = 'hp';
    honeypotInput.tabIndex = -1;
    honeypotInput.autocomplete = 'off';
    honeypotInput.className = 'feedback-gate-honeypot';
    honeypotInput.setAttribute('aria-hidden', 'true');

    messageField.className = joinClasses('feedback-gate-field', this.config.classes?.field);
    messageField.dataset.size = 'full';
    messageLabel.htmlFor = messageId;
    messageLabel.textContent = this.config.message?.label ?? 'Message';

    messageInput.id = messageId;
    messageInput.name = 'message';
    messageInput.rows = this.config.message?.rows ?? 6;
    messageInput.required = this.config.message?.required ?? true;
    messageInput.placeholder = this.config.message?.placeholder ?? 'What happened?';
    messageInput.className = joinClasses('feedback-gate-input', this.config.classes?.input);

    fieldsContainer.className = 'feedback-gate-fields';
    for (const field of this.config.fields ?? []) {
      const fieldRoot = this.createField(field, customFields);
      fieldsContainer.appendChild(fieldRoot);
    }

    status.className = joinClasses('feedback-gate-status', this.config.classes?.status);
    status.hidden = true;
    status.setAttribute('aria-live', 'polite');

    actions.className = joinClasses('feedback-gate-actions', this.config.classes?.actions);

    cancelButton.type = 'button';
    cancelButton.className = joinClasses('feedback-gate-button-secondary', this.config.classes?.cancelButton);
    cancelButton.textContent = strings.cancelLabel;

    submitButton.type = 'submit';
    submitButton.className = joinClasses('feedback-gate-button-primary', this.config.classes?.submitButton);
    submitButton.textContent = strings.submitLabel;

    headerCopy.append(title, description);
    header.append(headerCopy, dismissButton);
    messageField.append(messageLabel, messageInput);
    actions.append(cancelButton, submitButton);
    form.append(turnstileContainer, honeypotInput, messageField, fieldsContainer, status, actions);
    panel.append(header, form);
    overlay.append(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', this.handleOverlayClick);
    panel.addEventListener('click', stopPropagation);
    panel.addEventListener('keydown', this.handlePanelKeyDown);
    form.addEventListener('submit', this.handleSubmit);
    cancelButton.addEventListener('click', this.handleCancelClick);
    dismissButton.addEventListener('click', this.handleCancelClick);

    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', overlayId);

    return {
      trigger,
      overlay,
      panel,
      form,
      turnstileContainer,
      honeypotInput,
      status,
      message: messageInput,
      submitButton,
      cancelButton,
      dismissButton,
      customFields,
    };
  }

  private createField(
    field: FeedbackField,
    customFields: Map<string, FeedbackCustomFieldContext>,
  ): HTMLDivElement {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    const description = document.createElement('p');
    const id = `feedback-gate-field-${this.instanceId}-${field.name}`;

    wrapper.className = joinClasses('feedback-gate-field', this.config.classes?.field);
    wrapper.dataset.fieldName = field.name;
    wrapper.dataset.size = field.type === 'textarea' ? 'full' : 'half';

    label.textContent = field.label;
    label.htmlFor = id;

    if (field.description) {
      description.className = 'feedback-gate-description';
      description.textContent = field.description;
    }

    wrapper.appendChild(label);
    if (field.description) {
      wrapper.appendChild(description);
    }

    if (field.type === 'custom') {
      const context: FeedbackCustomFieldContext = {
        id,
        name: field.name,
        root: wrapper,
      };
      const customElement = field.render(context);
      customElement.id ||= id;
      wrapper.appendChild(customElement);
      customFields.set(field.name, context);
      return wrapper;
    }

    const control = createControl(field, id, this.config.classes?.input);
    wrapper.appendChild(control);
    return wrapper;
  }

  private collectFieldValues(): Record<string, unknown> {
    if (!this.mountedElements) {
      return {};
    }

    const values: Record<string, unknown> = {};

    for (const field of this.config.fields ?? []) {
      if (field.type === 'custom') {
        const context = this.mountedElements.customFields.get(field.name);
        if (!context) {
          continue;
        }
        values[field.name] = field.getValue(context);
        continue;
      }

      const element = this.mountedElements.form.elements.namedItem(field.name);
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        )
      ) {
        continue;
      }
      values[field.name] = element.value.trim();
    }

    return values;
  }

  private validateFieldValues(values: Record<string, unknown>): void {
    for (const field of this.config.fields ?? []) {
      if (!field.required) {
        continue;
      }

      const value = values[field.name];
      const text = typeof value === 'string' ? value.trim() : value;
      const isMissing = text === '' || text === undefined || text === null;

      if (isMissing) {
        throw new FeedbackGateError(`${field.label} is required.`);
      }
    }
  }

  private async handleSubmission(): Promise<FeedbackResult> {
    if (!this.mountedElements) {
      throw new Error('FeedbackGate is not mounted.');
    }

    const fieldValues = this.collectFieldValues();
    this.validateFieldValues(fieldValues);

    const prepared = await prepareSubmission({
      message: this.mountedElements.message.value,
      fields: fieldValues,
      context: this.config.context,
      requestHeaders: this.config.request?.headers,
      userAgent: globalThis.navigator?.userAgent,
    });

    const response = await submitFeedback({
      endpoint: this.config.endpoint,
      body: await this.buildRequestBody(prepared.payload),
      headers: prepared.headers,
      credentials: this.config.request?.credentials,
      query: await resolveRequestQuery(this.config.request?.query),
    });

    return {
      payload: prepared.payload,
      response,
    };
  }

  private async buildRequestBody(payload: FeedbackSubmissionRequestBody['payload']): Promise<FeedbackSubmissionRequestBody> {
    return {
      payload,
      verification: {
        turnstileToken: await this.getTurnstileToken(),
        honeypot: this.mountedElements?.honeypotInput.value ?? '',
      },
    };
  }

  private async getTurnstileToken(): Promise<string | undefined> {
    if (!this.config.protection?.turnstile) {
      return undefined;
    }

    await this.ensureProtectionReady();
    if (!this.turnstile) {
      throw new Error('Turnstile protection is not available.');
    }

    return await this.turnstile.getToken();
  }

  private async ensureProtectionReady(): Promise<void> {
    if (!this.config.protection?.turnstile || !this.mountedElements) {
      return;
    }

    if (!this.turnstile) {
      this.turnstile = new TurnstileController(
        this.mountedElements.turnstileContainer,
        this.config.protection.turnstile,
      );
    }

    await this.turnstile.ensureWidget();
  }

  private setSubmitting(submitting: boolean): void {
    if (!this.mountedElements) {
      return;
    }

    const strings = this.resolveStrings();
    this.isSubmitting = submitting;
    this.mountedElements.submitButton.disabled = submitting;
    this.mountedElements.cancelButton.disabled = submitting;
    this.mountedElements.dismissButton.disabled = submitting;
    this.mountedElements.message.disabled = submitting;
    this.mountedElements.submitButton.textContent = submitting
      ? strings.sendingLabel
      : strings.submitLabel;

    for (const field of this.config.fields ?? []) {
      if (field.type === 'custom') {
        continue;
      }

      const element = this.mountedElements.form.elements.namedItem(field.name);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        element.disabled = submitting;
      }
    }
  }

  private resetForm(): void {
    if (!this.mountedElements) {
      return;
    }

    this.mountedElements.form.reset();
  }

  private setStatus(message: string, variant: StatusVariant = 'idle'): void {
    if (!this.mountedElements) {
      return;
    }

    const { status } = this.mountedElements;
    status.hidden = message.length === 0;
    status.textContent = message;
    status.dataset.variant = variant;
  }

  private focusFirstFocusable(): void {
    if (!this.mountedElements) {
      return;
    }

    const focusable = getFocusableElements(this.mountedElements.panel);
    (focusable[0] ?? this.mountedElements.panel).focus();
  }

  private resolveTheme(): FeedbackTheme {
    return {
      ...DEFAULT_THEME,
      ...this.config.theme,
    };
  }

  private resolveStrings() {
    return {
      ...DEFAULT_STRINGS,
      ...this.config.strings,
    };
  }

  private readonly handleTriggerClick = (event: Event): void => {
    event.preventDefault();
    this.open();
  };

  private readonly handleCancelClick = (): void => {
    this.close();
  };

  private readonly handleOverlayClick = (): void => {
    this.close();
  };

  private readonly handlePanelKeyDown = (event: KeyboardEvent): void => {
    if (!this.mountedElements || !this.isOpen) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = getFocusableElements(this.mountedElements.panel);
    if (focusable.length === 0) {
      event.preventDefault();
      this.mountedElements.panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;

    if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  };

  private readonly handleSubmit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (this.isSubmitting) {
      return;
    }

    const strings = this.resolveStrings();
    this.setStatus('');
    this.setSubmitting(true);

    try {
      const result = await this.handleSubmission();
      this.resetForm();
      this.close(true);
      await this.config.onSuccess?.(result);
    } catch (error) {
      const message =
        error instanceof FeedbackGateError
          ? error.message
          : resolveErrorMessage(error, strings.genericError);

      this.setStatus(message, 'error');
      await this.config.onError?.(error);
    } finally {
      this.setSubmitting(false);
    }
  };
}

function createControl(
  field: Exclude<FeedbackField, FeedbackCustomField>,
  id: string,
  inputClassName?: string,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (field.type === 'textarea') {
    const textarea = document.createElement('textarea');
    textarea.id = id;
    textarea.name = field.name;
    textarea.rows = field.rows ?? 4;
    textarea.required = field.required ?? false;
    textarea.placeholder = field.placeholder ?? '';
    textarea.value = field.initialValue ?? '';
    textarea.className = joinClasses('feedback-gate-input', inputClassName);
    return textarea;
  }

  if (field.type === 'select') {
    const select = document.createElement('select');
    select.id = id;
    select.name = field.name;
    select.required = field.required ?? false;
    select.className = joinClasses('feedback-gate-input', inputClassName);

    if (field.placeholder) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = field.placeholder;
      placeholder.disabled = field.required ?? false;
      placeholder.selected = !field.initialValue;
      select.appendChild(placeholder);
    }

    for (const option of field.options) {
      const normalized = normalizeOption(option);
      const optionElement = document.createElement('option');
      optionElement.value = normalized.value;
      optionElement.textContent = normalized.label;
      optionElement.selected = normalized.value === field.initialValue;
      select.appendChild(optionElement);
    }

    return select;
  }

  const input = document.createElement('input');
  input.id = id;
  input.name = field.name;
  input.type = field.type;
  input.required = field.required ?? false;
  input.placeholder = field.placeholder ?? '';
  input.value = field.initialValue ?? '';
  input.setAttribute('autocomplete', field.autocomplete ?? 'off');
  input.className = joinClasses('feedback-gate-input', inputClassName);
  return input;
}

function normalizeOption(option: FeedbackFieldOption): { label: string; value: string } {
  if (typeof option === 'string') {
    return {
      label: option,
      value: option,
    };
  }

  return option;
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hidden && !element.hasAttribute('aria-hidden'));
}

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function applyTheme(element: HTMLElement, theme: FeedbackTheme): void {
  element.style.setProperty('--feedback-gate-accent-color', theme.accentColor);
  element.style.setProperty('--feedback-gate-background-color', theme.backgroundColor);
  element.style.setProperty('--feedback-gate-surface-color', theme.surfaceColor);
  element.style.setProperty('--feedback-gate-text-color', theme.textColor);
  element.style.setProperty('--feedback-gate-muted-text-color', theme.mutedTextColor);
  element.style.setProperty('--feedback-gate-overlay-color', theme.overlayColor);
  element.style.setProperty('--feedback-gate-border-color', theme.borderColor);
  element.style.setProperty('--feedback-gate-border-radius', theme.borderRadius);
  element.style.setProperty('--feedback-gate-z-index', theme.zIndex);
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .feedback-gate-trigger {
      position: fixed;
      right: 24px;
      bottom: 24px;
      border: 0;
      border-radius: 999px;
      background: var(--feedback-gate-accent-color);
      color: #ffffff;
      font: inherit;
      font-weight: 600;
      padding: 12px 18px;
      cursor: pointer;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
      z-index: var(--feedback-gate-z-index);
    }

    .feedback-gate-overlay {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--feedback-gate-overlay-color);
      z-index: var(--feedback-gate-z-index);
    }

    .feedback-gate-panel {
      width: min(100%, 720px);
      max-height: min(880px, calc(100vh - 48px));
      overflow: auto;
      background: var(--feedback-gate-surface-color);
      color: var(--feedback-gate-text-color);
      border-radius: calc(var(--feedback-gate-border-radius) + 4px);
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
      padding: 32px;
      border: 1px solid var(--feedback-gate-border-color);
      display: grid;
      gap: 24px;
    }

    .feedback-gate-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
    }

    .feedback-gate-overlay[hidden],
    .feedback-gate-status[hidden],
    .feedback-gate-turnstile[hidden] {
      display: none !important;
    }

    .feedback-gate-header-copy {
      display: grid;
      gap: 10px;
      max-width: 56ch;
    }

    .feedback-gate-header h2 {
      margin: 0;
      font-size: 1.75rem;
      line-height: 1.15;
      letter-spacing: -0.02em;
    }

    .feedback-gate-header p,
    .feedback-gate-description,
    .feedback-gate-status {
      margin: 0;
      color: var(--feedback-gate-muted-text-color);
    }

    .feedback-gate-dismiss {
      flex: 0 0 auto;
      inline-size: 40px;
      block-size: 40px;
      border: 1px solid var(--feedback-gate-border-color);
      border-radius: 999px;
      background: var(--feedback-gate-background-color);
      color: var(--feedback-gate-text-color);
      font: inherit;
      font-size: 1.5rem;
      line-height: 1;
      cursor: pointer;
    }

    .feedback-gate-form {
      display: grid;
      gap: 24px;
    }

    .feedback-gate-turnstile {
      min-height: 0;
    }

    .feedback-gate-honeypot {
      position: absolute;
      left: -10000px;
      top: auto;
      width: 1px;
      height: 1px;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    }

    .feedback-gate-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20px;
    }

    .feedback-gate-field {
      display: grid;
      gap: 10px;
      min-width: 0;
    }

    .feedback-gate-field[data-size="full"] {
      grid-column: 1 / -1;
    }

    .feedback-gate-field label {
      font-size: 0.95rem;
      font-weight: 600;
      line-height: 1.3;
    }

    .feedback-gate-input {
      width: 100%;
      min-height: 50px;
      border: 1px solid var(--feedback-gate-border-color);
      border-radius: 14px;
      padding: 13px 15px;
      font: inherit;
      color: inherit;
      background: var(--feedback-gate-background-color);
      box-sizing: border-box;
      transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
    }

    textarea.feedback-gate-input {
      min-height: 168px;
      resize: vertical;
    }

    .feedback-gate-input:focus,
    .feedback-gate-button-primary:focus,
    .feedback-gate-button-secondary:focus,
    .feedback-gate-dismiss:focus {
      outline: 2px solid var(--feedback-gate-accent-color);
      outline-offset: 2px;
      border-color: var(--feedback-gate-accent-color);
    }

    .feedback-gate-button-primary,
    .feedback-gate-button-secondary {
      min-height: 48px;
      border-radius: 14px;
      padding: 12px 16px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease;
    }

    .feedback-gate-button-secondary:hover,
    .feedback-gate-dismiss:hover {
      background: rgba(15, 23, 42, 0.03);
    }

    .feedback-gate-button-primary:hover {
      transform: translateY(-1px);
      filter: brightness(1.03);
    }

    .feedback-gate-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding-top: 20px;
      border-top: 1px solid rgba(15, 23, 42, 0.08);
    }

    .feedback-gate-button-primary {
      border: 0;
      background: var(--feedback-gate-accent-color);
      color: #ffffff;
      padding-inline: 20px;
    }

    .feedback-gate-button-secondary {
      border: 1px solid var(--feedback-gate-border-color);
      background: transparent;
      color: var(--feedback-gate-text-color);
    }

    .feedback-gate-button-primary[disabled],
    .feedback-gate-button-secondary[disabled],
    .feedback-gate-dismiss[disabled],
    .feedback-gate-input[disabled] {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .feedback-gate-status[data-variant="error"] {
      color: #b91c1c;
    }

    @media (max-width: 720px) {
      .feedback-gate-overlay {
        padding: 12px;
      }

      .feedback-gate-panel {
        width: 100%;
        max-height: calc(100vh - 24px);
        padding: 20px;
        gap: 20px;
      }

      .feedback-gate-header {
        padding-bottom: 16px;
      }

      .feedback-gate-header h2 {
        font-size: 1.4rem;
      }

      .feedback-gate-fields {
        grid-template-columns: 1fr;
        gap: 16px;
      }

      .feedback-gate-actions {
        flex-direction: column-reverse;
      }

      .feedback-gate-button-primary,
      .feedback-gate-button-secondary {
        width: 100%;
      }
    }
  `;

  document.head.appendChild(style);
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function resolveRequestQuery(
  query?: Record<string, string> | (() => Promise<Record<string, string>> | Record<string, string>),
): Promise<Record<string, string> | undefined> {
  if (!query) {
    return undefined;
  }

  return typeof query === 'function' ? await query() : query;
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}
