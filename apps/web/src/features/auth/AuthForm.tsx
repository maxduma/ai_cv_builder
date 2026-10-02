import type { ComponentProps, CSSProperties, FormEvent, ReactNode } from 'react';
import { ErrorIcon } from '../../ui/icons';

function classes(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ');
}

/** Form blocks rise 60ms apart, as in the design's entrance choreography. */
const rise = (delayMs: number): CSSProperties => ({ animationDelay: `${delayMs}ms` });

export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="error">
      <ErrorIcon />
      <span>{message}</span>
    </p>
  );
}

type TextFieldProps = Omit<ComponentProps<'input'>, 'id' | 'name' | 'className'> & {
  id: string;
  /** The schema field it edits; focus finds the field by it. */
  name: string;
  label: string;
  error?: string;
};

/** A labelled input with its error underneath, linked for screen readers. */
export function TextField({ id, name, label, error, ...input }: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        {...input}
        id={id}
        name={name}
        className="input"
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      />
      {error && <FieldError id={errorId} message={error} />}
    </div>
  );
}

/** The parts of `useAuthForm`'s state the frame renders. */
interface FormState {
  className: string;
  busy: boolean;
  alert: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * The Log in / Sign up form: heading, fields, and the submit button with its link to the other
 * form. Errors that belong to no field show in an alert right above the button.
 */
export function AuthForm({
  form,
  title,
  subtitle,
  submitLabel,
  busyLabel,
  footer,
  children,
}: {
  form: FormState;
  title: string;
  subtitle: string;
  submitLabel: string;
  /** Replaces the label while the request runs, e.g. "Logging in…". */
  busyLabel: string;
  footer: ReactNode;
  /** The fields. */
  children: ReactNode;
}) {
  return (
    <form
      className={form.className}
      noValidate
      aria-labelledby="auth-title"
      onSubmit={form.onSubmit}
    >
      <div className="auth-head auth-in">
        <h1 id="auth-title" className="auth-title">
          {title}
        </h1>
        <p className="auth-sub">{subtitle}</p>
      </div>

      <div className="auth-fields auth-in" style={rise(60)}>
        {children}
      </div>

      <div className="auth-actions auth-in" style={rise(120)}>
        {form.alert && (
          <div className="alert is-inline" role="alert">
            <ErrorIcon width={16} height={16} />
            <p className="alert-text">{form.alert}</p>
          </div>
        )}
        <button
          type="submit"
          className={classes('btn btn-primary btn-lg btn-block', form.busy && 'is-loading')}
          disabled={form.busy}
          aria-busy={form.busy}
        >
          {form.busy && <span className="spinner" aria-hidden="true" />}
          <span>{form.busy ? busyLabel : submitLabel}</span>
        </button>
        <p className="auth-foot">{footer}</p>
      </div>
    </form>
  );
}
