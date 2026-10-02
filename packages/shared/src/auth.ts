import { z } from 'zod';

export const NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// The messages below are shown next to the fields, on the web and from the API alike.
// `abort: true` stops at the first problem, so a field never gets two messages at once.
// No preprocess or transform: the web forms use the same schemas with plain string inputs.

const email = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .min(1, { error: 'Enter your email address.', abort: true })
  .max(EMAIL_MAX_LENGTH, { error: 'Enter a valid email address.' })
  .pipe(z.email({ error: 'Enter a valid email address.' }));

// Passwords are never trimmed: spaces are characters like any other.
const newPassword = z
  .string({ error: 'Create a password.' })
  .min(1, { error: 'Create a password.', abort: true })
  .min(PASSWORD_MIN_LENGTH, { error: `Use at least ${PASSWORD_MIN_LENGTH} characters.` })
  .max(PASSWORD_MAX_LENGTH, { error: `Use ${PASSWORD_MAX_LENGTH} characters or fewer.` });

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export const SignUpRequestSchema = z.strictObject({
  name: z
    .string({ error: 'Enter your full name.' })
    .trim()
    .min(1, { error: 'Enter your full name.', abort: true })
    .max(NAME_MAX_LENGTH, { error: `Use ${NAME_MAX_LENGTH} characters or fewer.`, abort: true })
    // Can't be typed in the form, and PostgreSQL text can't store U+0000: reject before hashing.
    .refine((name) => !CONTROL_CHARACTERS.test(name), { error: 'Enter your full name.' }),
  email,
  password: newPassword,
});

export type SignUpRequest = z.infer<typeof SignUpRequestSchema>;

/** Login checks only that a password was typed: the rules for new passwords may change. */
export const LoginRequestSchema = z.strictObject({
  email,
  password: z
    .string({ error: 'Enter your password.' })
    .min(1, { error: 'Enter your password.', abort: true })
    .max(1_024, { error: 'Enter your password.' }),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** The signed-in user as the API returns it. Never includes the password hash. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthResponse {
  user: AuthUser;
}
