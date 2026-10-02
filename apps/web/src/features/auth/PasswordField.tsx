import { type ChangeEvent, type ReactNode, useState } from 'react';
import { EyeIcon, EyeOffIcon } from '../../ui/icons';
import { FieldError } from './AuthForm';

/** The password input with a Show / Hide toggle. Its name is always `password`. */
export function PasswordField({
  id,
  autoComplete,
  placeholder,
  value,
  error,
  hint,
  onChange,
  children,
}: {
  id: string;
  autoComplete: 'current-password' | 'new-password';
  placeholder: string;
  value: string;
  error?: string;
  /** Advice shown under the field while it has no error. */
  hint?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Shown right under the input: the strength meter when creating a password. */
  children?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const showHint = !!hint && !error;

  return (
    <div className="field">
      <label htmlFor={id} className="label">
        Password
      </label>
      <div className="control">
        <input
          id={id}
          name="password"
          className="input has-clear"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          // A shown password is plain text: keep phones from capitalising or correcting it.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : showHint ? hintId : undefined}
          onChange={onChange}
        />
        <button
          type="button"
          className="icon-btn"
          // The label alone says what a press does; aria-pressed as well would announce both.
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-controls={id}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {children}
      {showHint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId} message={error} />}
    </div>
  );
}
