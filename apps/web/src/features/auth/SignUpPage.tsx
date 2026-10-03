import { PASSWORD_MIN_LENGTH, SignUpRequestSchema } from '@cv-builder/shared';
import { Link, useLocation } from 'react-router';
import { useSignUp } from './api';
import { AuthForm, TextField } from './AuthForm';
import { PasswordField } from './PasswordField';
import { PasswordStrength } from './PasswordStrength';
import { useAuthForm } from './useAuthForm';

/** `/signup`. The new account is signed in straight away; `GuestOnly` then opens My CVs. */
export function SignUpPage() {
  const location = useLocation();
  const signUp = useSignUp();
  const form = useAuthForm({
    fields: ['name', 'email', 'password'],
    schema: SignUpRequestSchema,
    submission: signUp,
  });
  const password = form.field('password');

  return (
    <>
      <title>Sign up · CV Builder</title>
      <AuthForm
        form={form}
        title="Create your account"
        subtitle="Create and edit your CVs in one place."
        submitLabel="Create account"
        busyLabel="Creating account…"
        footer={
          <>
            Already have an account?{' '}
            <Link to="/login" state={location.state} className="link">
              Log in
            </Link>
          </>
        }
      >
        <TextField
          id="signup-name"
          name="name"
          label="Full name"
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          placeholder="Alex Morgan"
          {...form.field('name')}
        />
        <TextField
          id="signup-email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@example.com"
          {...form.field('email')}
        />
        <PasswordField
          id="signup-password"
          autoComplete="new-password"
          placeholder="Create a password"
          hint={`Use at least ${PASSWORD_MIN_LENGTH} characters. Mix in numbers or symbols to make it stronger.`}
          {...password}
        >
          <PasswordStrength password={password.value} />
        </PasswordField>
      </AuthForm>
    </>
  );
}
