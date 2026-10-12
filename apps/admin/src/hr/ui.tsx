import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X, ArrowUpRight } from 'lucide-react';
import { errorMessage } from '@quicksort/hr-db';
import { z } from 'zod';
import { DateField } from '../DateField';
export type RunCommand = (input: unknown, success?: string) => Promise<void>;
export const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
export const nullable = (data: FormData, key: string) => text(data, key) || null;
export const number = (data: FormData, key: string) => Number(text(data, key));
export const checked = (data: FormData, key: string) => data.get(key) === 'on';
export const today = () => new Date().toISOString().slice(0, 10);
export const label = (value: string) => value.replace(/_/g, ' ').replace(/^./, s => s.toUpperCase());
export const date = (value: string | null | undefined) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
}) : 'Not set';
export const initials = (name: string) => name.trim().split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
export function useRetryCommand() {
  const pending = useRef<{ payload: string; requestId: string } | null>(null);
  return {
    prepare(input: unknown) {
      const command = z.record(z.string(), z.unknown()).parse(input);
      const payload = JSON.stringify(command);
      if (!pending.current || pending.current.payload !== payload) {
        pending.current = { payload, requestId: crypto.randomUUID() };
      }
      return { ...command, request_id: pending.current.requestId };
    },
    complete() { pending.current = null; },
  };
}
export function Tag({
  children,
  tone = ''
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`hr-tag ${tone}`}>
    {children}
  </span>;
}
export function Field({
  name,
  label: title,
  type = 'text',
  value,
  required = false,
  options,
  hint,
  min,
  max,
  step,
  rows = 3,
  onChange
}: {
  name: string;
  label: string;
  type?: string;
  value?: string | number | null;
  required?: boolean;
  options?: {
    value: string;
    label: string;
  }[];
  hint?: string;
  min?: number | string;
  max?: number | string;
  step?: string;
  rows?: number;
  onChange?: (value: string) => void;
}) {
  return <label className={`hr-field ${type === 'textarea' ? 'hr-wide' : ''}`}>
    <span>
      {title}
      {required && <span aria-hidden="true"> *</span>}
    </span>
    {options ? <select name={name} required={required} defaultValue={value ?? ''} onChange={onChange ? event => onChange(event.target.value) : undefined}>
      {!required && <option value="">Not set</option>}
      {required && !value && <option value="" disabled>Select…</option>}
      {options.map(option => <option key={option.value} value={option.value}>
        {option.label}
      </option>)}
    </select> : type === 'textarea' ? <textarea name={name} required={required} defaultValue={value ?? ''} rows={rows} maxLength={5000} /> : type === 'date' ? <DateField name={name} defaultValue={value == null ? '' : String(value)} required={required} min={typeof min === 'string' ? min : undefined} max={typeof max === 'string' ? max : undefined} aria-label={title} /> : <input name={name} type={type} required={required} defaultValue={value ?? ''} min={min} max={max} step={step} maxLength={type === 'text' ? 300 : undefined} />}
    {hint && <small>
      {hint}
    </small>}
  </label>;
}
export function SearchMultiField({
  name,
  label: title,
  values = [],
  options,
  placeholder = 'Search…',
  hint
}: {
  name: string;
  label: string;
  values?: string[];
  options: {
    value: string;
    label: string;
  }[];
  placeholder?: string;
  hint?: string;
}) {
  const [selected, setSelected] = useState<string[]>(values);
  const [query, setQuery] = useState('');
  const matches = options.filter(option => !selected.includes(option.value) && option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = (value: string) => {
    setSelected(current => current.includes(value) ? current : [...current, value]);
    setQuery('');
  };
  const drop = (value: string) => setSelected(current => current.filter(item => item !== value));
  return <div className="hr-field hr-wide">
    <span>
      {title}
    </span>
    {selected.length ? <div className="hr-labels">
      {selected.map(value => {
        const option = options.find(item => item.value === value);
        return <span className="hr-label" key={value}>
          {option?.label ?? 'Unknown record'}
          <button type="button" aria-label={`Remove ${option?.label ?? value}`} onClick={() => drop(value)}>
            <X size={12} aria-hidden="true" />
          </button>
          <input type="hidden" name={name} value={value} />
        </span>;
      })}
    </div> : <small>Nothing linked yet.</small>}
    <input value={query} onChange={event => setQuery(event.target.value)} placeholder={options.length ? placeholder : 'No records available yet'} aria-label={`Search ${title}`} />
    {query.trim() && <div className="hr-picks">
      {matches.map(option => <button type="button" className="hr-pick" key={option.value} onClick={() => pick(option.value)}>
        {option.label}
      </button>)}
      {!matches.length && <small>No record matches “{query.trim()}”.</small>}
    </div>}
    {hint && <small>
      {hint}
    </small>}
  </div>;
}
export function SkillListField({
  name,
  label: title,
  value = '',
  placeholder = 'Type a skill or certification, then press Enter'
}: {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
}) {
  const parse = (raw: string) => raw.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
  const [skills, setSkills] = useState<string[]>(() => parse(value));
  const [draft, setDraft] = useState('');
  const add = () => {
    const skill = draft.trim().replace(/,$/, '');
    if (skill && !skills.some(item => item.toLowerCase() === skill.toLowerCase())) setSkills(current => [...current, skill]);
    setDraft('');
  };
  const drop = (skill: string) => setSkills(current => current.filter(item => item !== skill));
  return <div className="hr-field hr-wide">
    <span>
      {title}
    </span>
    <div className="hr-skillbox" onClick={event => {
      if (event.target === event.currentTarget) event.currentTarget.querySelector('input')?.focus();
    }}>
      {skills.map(skill => <span className="hr-label" key={skill}>
        {skill}
        <button type="button" aria-label={`Remove ${skill}`} onClick={() => drop(skill)}>
          <X size={12} aria-hidden="true" />
        </button>
      </span>)}
      <input value={draft} placeholder={skills.length ? '' : placeholder} aria-label={title} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          add();
        }
        if (event.key === 'Backspace' && !draft && skills.length) setSkills(current => current.slice(0, -1));
      }} onBlur={add} />
    </div>
    <input type="hidden" name={name} value={skills.join(', ')} />
    <small>
      Press Enter to add · Backspace removes the last entry.
    </small>
  </div>;
}
export function Form({
  children,
  submit,
  run,
  title,
  success,
  button = 'Save',
  busy = false,
  reset = false
}: {
  children: ReactNode;
  submit: (form: FormData) => unknown;
  run: RunCommand;
  title?: string;
  success?: string;
  button?: string;
  busy?: boolean;
  reset?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fieldsKey, setFieldsKey] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const retry = useRetryCommand();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await run(retry.prepare(submit(new FormData(form))), success);
      retry.complete();
      setMessage(success ?? 'Saved.');
      if (reset) {
        form.reset();
        // State-driven fields (e.g. DateField) ignore form.reset(); remount
        // the fields so every control returns to its default value.
        setFieldsKey(key => key + 1);
      }
    } catch (failure) {
      setError(errorMessage(failure));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }
  return <form className="hr-form" onSubmit={event => void onSubmit(event)}>
    {title && <h3>
      {title}
    </h3>}
    <div className="hr-fields" key={fieldsKey}>
      {children}
    </div>
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="hr-error">
      {error}
    </p>}
    {message && <p role="status" className="hr-source-list">{message}</p>}
    <div className="hr-form-actions">
      <button className="btn" disabled={busy || saving} type="submit">
        {saving ? 'Saving…' : button}
      </button>
    </div>
  </form>;
}
export function Action({
  children,
  input,
  run,
  success,
  disabled,
  secondary = true
}: {
  children: ReactNode;
  input: unknown;
  run: RunCommand;
  success?: string;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const retry = useRetryCommand();
  return <div className="hr-action"><button className={`btn ${secondary ? 'secondary' : ''}`} disabled={disabled || saving} onClick={() => {
    setSaving(true);
    setError(''); setMessage('');
    void run(retry.prepare(input), success).then(() => { retry.complete(); setMessage(success ?? 'Saved.'); }).catch((failure) => setError(errorMessage(failure))).finally(() => setSaving(false));
  }}>
    {saving ? 'Saving…' : children}
  </button>{error && <p role="alert" className="hr-error">{error}</p>}{message && <p role="status" className="hr-source-list">{message}</p>}</div>;
}
export function Section({
  title,
  detail,
  children,
  action
}: {
  title: string;
  detail?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return <section className="hr-section">
    <div className="hr-section-heading">
      <div>
        <h2>
          {title}
        </h2>
        {detail && <p>
          {detail}
        </p>}
      </div>
      {action}
    </div>
    {children}
  </section>;
}
export function Empty({
  children
}: {
  children: ReactNode;
}) {
  return <div className="hr-empty">
    {children}
  </div>;
}
export function PersonLink({
  name,
  detail,
  open
}: {
  name: string;
  detail?: string;
  open: () => void;
}) {
  return <button className="hr-person-link" onClick={open}>
    <span className="hr-avatar">
      {initials(name)}
    </span>
    <span>
      <strong>
        {name}
      </strong>
      {detail && <small>
        {detail}
      </small>}
    </span>
    <ArrowUpRight size={15} aria-hidden="true" />
  </button>;
}
export function Dialog({
  title,
  meta,
  children,
  close,
  className = '',
  bare = false
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  close: () => void;
  className?: string;
  bare?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={`hr-dialog ${className}`} aria-label={typeof title === 'string' ? title : undefined} onCancel={close} onClick={event => {
    if (event.target === event.currentTarget) close();
  }}>
    {bare ? <div className="hr-dialog-bare">
      {children}
    </div> : <>
      <div className="hr-dialog-heading">
        <h2>
          {title}
        </h2>
        {meta}
        <button className="hr-icon-button" aria-label="Close record" onClick={close}>
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      <div className="hr-dialog-body">
        {children}
      </div>
    </>}
  </dialog>;
}
