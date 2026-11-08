import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X, ArrowUpRight } from 'lucide-react';
import { errorMessage } from '@quicksort/hr-db';
import { z } from 'zod';
import { cn } from 'cn';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog as UiDialog,
  DialogContent,
  DialogTitle,
  Empty as UiEmpty,
  Field as UiField,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from '@quicksort-sas/ui';
import { DateField } from '../DateField';
import { PersonPhoto } from '../documents/PersonPhoto';
import type { CommandResult } from './domain';
/*
 * HR primitives on @quicksort-sas/ui. Export names, props and FormData keys
 * are a stable contract shared with PersonWorkspace and the HR shell.
 */
/** Runs an HR command; implementations may resolve with the command result (e.g. the new person_id). */
export type RunCommand = (input: unknown, success?: string) => Promise<CommandResult | void>;
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
/** Badge variant per legacy tone ('good', 'urgent', 'quiet'; anything else is neutral). */
const TAG_VARIANT: Record<string, 'success' | 'destructive' | 'outline'> = {
  good: 'success',
  urgent: 'destructive',
  quiet: 'outline'
};
export function Tag({
  children,
  tone = ''
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <Badge variant={TAG_VARIANT[tone] ?? 'secondary'}>
    {children}
  </Badge>;
}
/** Textarea grows with its content (field-sizing), so `rows` sets a floor height instead. */
const TEXTAREA_MIN: Record<number, string> = { 1: 'min-h-12', 2: 'min-h-16', 3: 'min-h-24', 4: 'min-h-28', 5: 'min-h-32' };
/** Removable chip used by the multi-value fields. */
function Chip({ children, remove, label: removeLabel }: { children: ReactNode; remove: () => void; label: string }) {
  return <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-secondary py-0.5 pr-0.5 pl-2.5 text-[13px] font-medium text-secondary-foreground">
    <span className="truncate">{children}</span>
    <button type="button" aria-label={removeLabel} onClick={remove} className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <X className="size-3" aria-hidden="true" />
    </button>
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
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  // DateField renders its own trigger button (named by aria-label), so its label has no target.
  const labelTarget = !options && type === 'date' ? undefined : id;
  return <UiField className={cn('min-w-0 gap-1.5', type === 'textarea' && !options && 'col-span-full')}>
    <FieldLabel htmlFor={labelTarget} className="gap-1">
      {title}
      {required && <span aria-hidden="true" className="text-muted-foreground">*</span>}
    </FieldLabel>
    {options ? <NativeSelect className="w-full" id={id} name={name} required={required} defaultValue={value ?? ''} aria-describedby={hintId} onChange={onChange ? event => onChange(event.target.value) : undefined}>
      {!required && <NativeSelectOption value="">Not set</NativeSelectOption>}
      {required && !value && <NativeSelectOption value="" disabled>Select…</NativeSelectOption>}
      {options.map(option => <NativeSelectOption key={option.value} value={option.value}>
        {option.label}
      </NativeSelectOption>)}
    </NativeSelect> : type === 'textarea' ? <Textarea id={id} name={name} required={required} defaultValue={value ?? ''} rows={rows} maxLength={5000} aria-describedby={hintId} className={cn('resize-y', TEXTAREA_MIN[rows] ?? 'min-h-40')} /> : type === 'date' ? <DateField name={name} defaultValue={value == null ? '' : String(value)} required={required} min={typeof min === 'string' ? min : undefined} max={typeof max === 'string' ? max : undefined} aria-label={title} /> : <Input id={id} name={name} type={type} required={required} defaultValue={value ?? ''} min={min} max={max} step={step} maxLength={type === 'text' ? 300 : undefined} aria-describedby={hintId} />}
    {hint && <FieldDescription id={hintId} className="text-xs">
      {hint}
    </FieldDescription>}
  </UiField>;
}
/** Single-value search over a long option list (e.g. countries). The input
    shows the picked label; typing filters, and the code travels through the
    form as a hidden input. Clearing the text unsets the value. */
export function SearchField({
  name,
  label: title,
  value,
  options,
  placeholder = 'Search…',
  hint
}: {
  name: string;
  label: string;
  value?: string | null;
  options: {
    value: string;
    label: string;
  }[];
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  const labelOf = (code: string) => options.find(option => option.value === code)?.label ?? '';
  const [selected, setSelected] = useState(value ?? '');
  const [query, setQuery] = useState(() => labelOf(value ?? ''));
  const [filtering, setFiltering] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const needle = query.trim().toLowerCase();
  const matches = filtering && needle ? options.filter(option => option.label.toLowerCase().includes(needle) || option.value.toLowerCase() === needle) : options;
  const pick = (code: string) => {
    setSelected(code);
    setQuery(labelOf(code));
    setFiltering(false);
    setOpen(false);
  };
  useEffect(() => {
    if (open) listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);
  return <UiField className="min-w-0 gap-1.5">
    <FieldLabel htmlFor={id}>
      {title}
    </FieldLabel>
    <div className="relative">
    <Input id={id} type="text" role="combobox" aria-label={title} aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" value={query} placeholder={placeholder} autoComplete="off" onFocus={event => {
      event.currentTarget.select();
      setHighlight(Math.max(0, options.findIndex(option => option.value === selected)));
      setOpen(true);
    }} onChange={event => {
      setQuery(event.target.value);
      setFiltering(true);
      setHighlight(0);
      setOpen(true);
    }} onBlur={() => {
      setOpen(false);
      setFiltering(false);
      if (!query.trim()) setSelected('');
      else setQuery(labelOf(selected));
    }} onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        setOpen(false);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setOpen(true);
        setHighlight(index => Math.min(index + 1, matches.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight(index => Math.max(index - 1, 0));
      } else if (event.key === 'Enter' && open && matches[highlight]) {
        event.preventDefault();
        pick(matches[highlight].value);
      }
    }} />
    <input type="hidden" name={name} value={selected} />
    {open && <ul id={`${id}-list`} className="absolute inset-x-0 top-full z-30 m-0 mt-1 max-h-60 list-none overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg" role="listbox" ref={listRef}>
      {matches.length ? matches.map((option, index) => <li key={option.value} role="option" aria-selected={option.value === selected} className={cn('cursor-pointer rounded-md px-2.5 py-1.5 text-sm aria-selected:font-medium', index === highlight && 'bg-accent')} onMouseDown={event => {
        event.preventDefault();
        pick(option.value);
      }} onMouseEnter={() => setHighlight(index)}>
        {option.label}
      </li>) : <li className="cursor-default px-2.5 py-1.5 text-[13px] text-muted-foreground">No match for “{query.trim()}”.</li>}
    </ul>}
    </div>
    {hint && <FieldDescription className="text-xs">
      {hint}
    </FieldDescription>}
  </UiField>;
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
  const id = useId();
  const [selected, setSelected] = useState<string[]>(values);
  const [query, setQuery] = useState('');
  const matches = options.filter(option => !selected.includes(option.value) && option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = (value: string) => {
    setSelected(current => current.includes(value) ? current : [...current, value]);
    setQuery('');
  };
  const drop = (value: string) => setSelected(current => current.filter(item => item !== value));
  return <UiField className="col-span-full min-w-0 gap-1.5">
    <FieldLabel htmlFor={id}>
      {title}
    </FieldLabel>
    {selected.length ? <div className="flex flex-wrap gap-2">
      {selected.map(value => {
        const option = options.find(item => item.value === value);
        return <Chip key={value} label={`Remove ${option?.label ?? value}`} remove={() => drop(value)}>
          {option?.label ?? 'Unknown record'}
          <input type="hidden" name={name} value={value} />
        </Chip>;
      })}
    </div> : <p className="m-0 text-xs text-muted-foreground">Nothing linked yet.</p>}
    <Input id={id} value={query} onChange={event => setQuery(event.target.value)} placeholder={options.length ? placeholder : 'No records available yet'} aria-label={`Search ${title}`} />
    {query.trim() && <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/40 p-2">
      {matches.map(option => <Button type="button" variant="outline" size="xs" className="rounded-full" key={option.value} onClick={() => pick(option.value)}>
        {option.label}
      </Button>)}
      {!matches.length && <p className="m-0 px-1 text-xs text-muted-foreground">No record matches “{query.trim()}”.</p>}
    </div>}
    {hint && <FieldDescription className="text-xs">
      {hint}
    </FieldDescription>}
  </UiField>;
}
export function SkillListField({
  name,
  label: title,
  value = '',
  hideLabel = false,
  placeholder = 'Type a skill or certification, then press Enter'
}: {
  name: string;
  label: string;
  value?: string;
  /** Hide the visible caption when a card heading already names the list. */
  hideLabel?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const parse = (raw: string) => raw.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
  const [skills, setSkills] = useState<string[]>(() => parse(value));
  const [draft, setDraft] = useState('');
  const add = () => {
    const skill = draft.trim().replace(/,$/, '');
    if (skill && !skills.some(item => item.toLowerCase() === skill.toLowerCase())) setSkills(current => [...current, skill]);
    setDraft('');
  };
  const drop = (skill: string) => setSkills(current => current.filter(item => item !== skill));
  return <UiField className="col-span-full min-w-0 gap-1.5">
    <FieldLabel htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
      {title}
    </FieldLabel>
    <div className="flex min-h-24 cursor-text flex-wrap content-start items-center gap-2 rounded-lg border border-dashed border-input p-2.5 transition-[border-color,box-shadow] duration-150 focus-within:border-solid focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/15" onClick={event => {
      if (event.target === event.currentTarget) event.currentTarget.querySelector('input')?.focus();
    }}>
      {skills.map(skill => <Chip key={skill} label={`Remove ${skill}`} remove={() => drop(skill)}>
        {skill}
      </Chip>)}
      <input id={id} className="min-w-40 flex-[1_1_220px] border-0 bg-transparent px-1 py-1 text-[15px] text-foreground outline-none placeholder:text-faint" value={draft} placeholder={skills.length ? '' : placeholder} aria-label={title} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          add();
        }
        if (event.key === 'Backspace' && !draft && skills.length) setSkills(current => current.slice(0, -1));
      }} onBlur={add} />
    </div>
    <input type="hidden" name={name} value={skills.join(', ')} />
    <FieldDescription className="text-xs">
      Press Enter to add · Backspace removes the last entry.
    </FieldDescription>
  </UiField>;
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
  const errorRef = useRef<HTMLDivElement>(null);
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
  return <form className="@container flex min-w-0 flex-col gap-4" onSubmit={event => void onSubmit(event)}>
    {title && <h3 className="m-0 text-[15px] font-medium">
      {title}
    </h3>}
    <div className="grid gap-4 @md:grid-cols-2" key={fieldsKey}>
      {children}
    </div>
    {error && <Alert ref={errorRef} tabIndex={-1} variant="destructive" className="outline-none">
      <AlertDescription>{error}</AlertDescription>
    </Alert>}
    {message && <p role="status" className="m-0 text-[13px] text-muted-foreground">{message}</p>}
    <div className="flex justify-end">
      <Button disabled={busy || saving} type="submit">
        {saving ? 'Saving…' : button}
      </Button>
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
  return <div className="flex flex-col items-start gap-1.5"><Button type="button" size="sm" variant={secondary ? 'outline' : 'default'} disabled={disabled || saving} onClick={() => {
    setSaving(true);
    setError(''); setMessage('');
    void run(retry.prepare(input), success).then(() => { retry.complete(); setMessage(success ?? 'Saved.'); }).catch((failure) => setError(errorMessage(failure))).finally(() => setSaving(false));
  }}>
    {saving ? 'Saving…' : children}
  </Button>{error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}{message && <p role="status" className="m-0 text-xs text-muted-foreground">{message}</p>}</div>;
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
  return <section className="flex min-w-0 flex-col gap-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="m-0 font-heading text-lg leading-tight font-medium tracking-[-0.02em]">
          {title}
        </h2>
        {detail && <p className="m-0 text-[13px] text-muted-foreground">
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
  return <UiEmpty className="gap-0 border border-dashed border-border p-6 md:p-8">
    <div className="max-w-md text-sm leading-relaxed text-muted-foreground">
      {children}
    </div>
  </UiEmpty>;
}
/** Initials / photo avatar shared by person rows and board cards. */
export const avatarClass = 'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted object-cover text-xs font-medium text-foreground';
export function PersonLink({
  name,
  detail,
  open,
  personId
}: {
  name: string;
  detail?: string;
  open: () => void;
  /** Shows the person's filed photo in place of the initials when set. */
  personId?: string;
}) {
  return <button type="button" className="group/person flex max-w-full min-w-0 cursor-pointer items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={open}>
    {personId
      ? <PersonPhoto personId={personId} name={name} fallback={initials(name)} className={avatarClass} />
      : <span className={avatarClass} aria-hidden="true">
          {initials(name)}
        </span>}
    <span className="min-w-0">
      <strong className="block truncate text-sm font-medium underline-offset-4 group-hover/person:underline">
        {name}
      </strong>
      {detail && <small className="block truncate text-xs text-muted-foreground">
        {detail}
      </small>}
    </span>
    <ArrowUpRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  </button>;
}
/** Modal record panel, open while mounted. `className` sizes the panel
    (default 768px wide); `bare` renders the children without the heading. */
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
  return <UiDialog open onOpenChange={(open, details) => {
    if (open) return;
    // A control inside handled Escape itself (e.g. a date picker closing its calendar).
    if (details.reason === 'escape-key' && details.event.defaultPrevented) return;
    close();
  }}>
    <DialogContent showCloseButton={false} aria-label={bare && typeof title === 'string' ? title : undefined} className={cn('flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl sm:p-0', className)}>
      {bare ? children : <>
        <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-4 sm:px-6">
          <DialogTitle className="min-w-0 flex-1 text-lg sm:text-xl">
            {title}
          </DialogTitle>
          {meta}
          <Button variant="ghost" size="icon" aria-label="Close record" onClick={close}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5 sm:p-6 *:shrink-0">
          {children}
        </div>
      </>}
    </DialogContent>
  </UiDialog>;
}
