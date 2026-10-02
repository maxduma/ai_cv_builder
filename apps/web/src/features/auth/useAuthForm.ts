import { type ChangeEvent, type FormEvent, useState } from 'react';
import { flushSync } from 'react-dom';
import { ApiError } from '../../lib/api-client';

/** A problem with one field: a zod issue, or an entry of the API's error `details`. */
interface Issue {
  path: readonly PropertyKey[];
  message: string;
}

/** What the form needs from a shared zod schema (the web app doesn't depend on zod itself). */
interface Schema<Data> {
  safeParse(
    input: unknown,
  ): { success: true; data: Data } | { success: false; error: { issues: readonly Issue[] } };
}

/** The login or sign-up mutation from `api.ts`. */
interface Submission<Data> {
  mutateAsync: (data: Data) => Promise<unknown>;
  isPending: boolean;
  isSuccess: boolean;
}

type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

const SUBMIT_FAILED = 'Something went wrong. Try again in a moment.';

function isFieldDetail(value: unknown): value is { path: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

/** Field problems the API reported: invalid values, or an email that already has an account. */
function serverIssues(error: ApiError): Issue[] {
  if (error.code !== 'VALIDATION_ERROR' && error.code !== 'EMAIL_TAKEN') return [];
  if (!Array.isArray(error.details)) return [];
  return error.details.flatMap((detail: unknown) =>
    isFieldDetail(detail) ? [{ path: [detail.path], message: detail.message }] : [],
  );
}

/** One message per field (the schemas stop at a field's first problem anyway). */
function toFieldErrors<Field extends string>(issues: readonly Issue[], fields: readonly Field[]) {
  const errors: FieldErrors<Field> = {};
  for (const issue of issues) {
    const field = fields.find((name) => name === issue.path[0]);
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/**
 * State of the Log in and Sign up forms. Values are checked with the shared schema on submit,
 * never while typing; editing a field clears its error. An invalid submit shakes the form and
 * moves focus to the first invalid field — also when the API rejects a field (a taken email).
 * Any other failure (wrong password, no connection) shows in the form's alert.
 */
export function useAuthForm<Data, Field extends keyof Data & string>({
  fields,
  schema,
  submission,
}: {
  /** Every field, in the order focus looks for the first invalid one. */
  fields: readonly Field[];
  schema: Schema<Data>;
  submission: Submission<Data>;
}) {
  const [values, setValues] = useState<Partial<Record<Field, string>>>({});
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [alert, setAlert] = useState<string | null>(null);
  // Counted in state, so each invalid submit can switch the shake animation and replay it.
  const [shakes, setShakes] = useState(0);

  // Still busy after success: the next page replaces the form.
  const busy = submission.isPending || submission.isSuccess;

  /** Props for a field's input: its value, its error and a change handler. */
  function field(name: Field) {
    return {
      value: values[name] ?? '',
      error: errors[name],
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        setValues((current) => ({ ...current, [name]: value }));
        setErrors((current) => ({ ...current, [name]: undefined }));
      },
    };
  }

  function rejectFields(form: HTMLFormElement, fieldErrors: FieldErrors<Field>) {
    // Rendered before focus moves, so the field is announced together with its error.
    flushSync(() => {
      setErrors(fieldErrors);
      setShakes((count) => count + 1);
    });
    const first = fields.find((name) => fieldErrors[name]);
    const input = first ? form.elements.namedItem(first) : null;
    if (input instanceof HTMLInputElement) input.focus();
  }

  async function submit(form: HTMLFormElement) {
    if (busy) return;
    // A new attempt: an alert that comes back is announced again.
    setAlert(null);

    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      rejectFields(form, toFieldErrors(parsed.error.issues, fields));
      return;
    }
    setErrors({});

    try {
      await submission.mutateAsync(parsed.data);
    } catch (error) {
      const fieldErrors: FieldErrors<Field> =
        error instanceof ApiError ? toFieldErrors(serverIssues(error), fields) : {};
      if (fields.some((name) => fieldErrors[name])) {
        rejectFields(form, fieldErrors);
      } else {
        setAlert(error instanceof ApiError ? error.message : SUBMIT_FAILED);
      }
    }
  }

  let className = 'auth-form';
  if (shakes > 0) className += shakes % 2 ? ' is-shake-a' : ' is-shake-b';

  return {
    field,
    busy,
    alert,
    className,
    onSubmit: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit(event.currentTarget);
    },
  };
}
