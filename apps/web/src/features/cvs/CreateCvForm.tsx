import { CreateCvRequestSchema } from '@cv-builder/shared';
import { type FormEvent, useId, useState } from 'react';
import { useCreateCv } from './api';

const inputClassName =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none';

export function CreateCvForm() {
  const createCv = useCreateCv();
  const [title, setTitle] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const titleId = useId();
  const targetRoleId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Same schema the API validates with, so most mistakes are caught before a request is sent.
    const parsed = CreateCvRequestSchema.safeParse({ title, targetRole });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Please check the form.');
      return;
    }

    setValidationError(null);
    createCv.mutate(parsed.data, {
      onSuccess: () => {
        setTitle('');
        setTargetRole('');
      },
    });
  }

  const errorMessage = validationError ?? createCv.error?.message;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold">New CV</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={titleId} className="text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id={titleId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="e.g. Backend engineer CV"
            className={inputClassName}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={targetRoleId} className="text-sm font-medium text-slate-700">
            Target role <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id={targetRoleId}
            value={targetRole}
            onChange={(event) => setTargetRole(event.target.value)}
            maxLength={120}
            placeholder="e.g. Senior Backend Engineer"
            className={inputClassName}
          />
        </div>
      </div>

      {errorMessage && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={createCv.isPending}
          className="min-h-11 w-full rounded-lg bg-indigo-600 px-4 text-base font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 sm:w-auto"
        >
          {createCv.isPending ? 'Creating…' : 'Create CV'}
        </button>
      </div>
    </form>
  );
}
