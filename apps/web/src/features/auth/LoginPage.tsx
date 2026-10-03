import { LoginRequestSchema } from '@cv-builder/shared';
import { Link, useLocation } from 'react-router';
import { useLogin } from './api';
import { AuthForm, TextField } from './AuthForm';
import { PasswordField } from './PasswordField';
import { useAuthForm } from './useAuthForm';

/** `/login`. After logging in, `GuestOnly` opens the page the user came for, or My CVs. */
export function LoginPage() {
  const location = useLocation();
  const login = useLogin();
  const form = useAuthForm({
    fields: ['email', 'password'],
    schema: LoginRequestSchema,
    submission: login,
  });

  return (
    <>
      <title>Log in · CV Builder</title>
      <AuthForm
        form={form}
        title="Welcome back"
        subtitle="Log in to open your CVs."
        submitLabel="Log in"
        busyLabel="Logging in…"
        footer={
          <>
            Don’t have an account?{' '}
            {/* Passes on where the user was going, for after signing up instead. */}
            <Link to="/signup" state={location.state} className="link">
              Sign up
            </Link>
          </>
        }
      >
        <TextField
          id="login-email"
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
          id="login-password"
          autoComplete="current-password"
          placeholder="Enter your password"
          {...form.field('password')}
        />
      </AuthForm>
    </>
  );
}
