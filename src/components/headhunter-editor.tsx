'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { HeadhunterHero } from '@/components/headhunter-minisite';
import { HeadhunterTagPill } from '@/components/headhunter-tag';
import { trackEvent } from '@/lib/analytics';
import { HEADHUNTER_LIMITS } from '@/lib/headhunters/constants';
import {
  editorMode, formFromView, formKeyForField, previewView, requestBody, shareFallbacks,
  type FormValues, type HandleCheck, type OwnerView,
} from '@/lib/headhunters/editor';
import { ANALYTICS, EDITOR_TEXT as T, STATUS_PILL } from '@/lib/headhunters/editor-copy';
import { HANDLE_FORMAT_ERROR, isHandleFormat, suggestHandle, validateHandle } from '@/lib/headhunters/handle';
import { HEADHUNTER_API_ERRORS } from '@/lib/headhunters/messages';
import { HEADHUNTER_KIND_LABEL } from '@/lib/headhunters/presentation';
import { minisiteDisplay } from '@/lib/headhunters/urls';
import './headhunter-editor.css';

// The apply/edit screen. The server page loads the owner's record (same functions as GET /api/headhunter) and passes it
// in; writes go through POST/PATCH /api/headhunter and POST /api/headhunter/handle, then router.refresh() reloads the record.
type Errors = Partial<Record<keyof FormValues | 'contact', string>>;
const HANDLE_PREFIX = minisiteDisplay('abc').slice(0, -3);
const CHECK_DELAY_MS = 450;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { error?: string; field?: string; status?: string };
  return { ok: response.ok, data };
}

function Field({ id, label, hint, count, error, children }: { id: string; label: string; hint?: string; count?: ReactNode; error?: string; children: ReactNode }) {
  return <div className="hh-ed-field">
    <label htmlFor={id}><span>{label}{hint && <small> · {hint}</small>}</span>{count && <small className="hh-ed-count">{count}</small>}</label>
    {children}
    {error && <p className="hh-ed-error" id={`${id}-error`} role="alert">{error}</p>}
  </div>;
}

export function HeadhunterEditor({ view, applicationsOpen }: { view: OwnerView | null; applicationsOpen: boolean }) {
  const router = useRouter();
  const mode = editorMode(view, applicationsOpen);
  const editable = mode === 'apply' || mode === 'draft' || mode === 'pending' || mode === 'approved';
  const [values, setValues] = useState<FormValues>(() => formFromView(view));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [handleTouched, setHandleTouched] = useState(false);
  const [check, setCheck] = useState<HandleCheck>({ state: 'idle' });
  const [newHandle, setNewHandle] = useState(view?.handle ?? '');
  const [renameError, setRenameError] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };
  const suggestion = suggestHandle(values.displayName);

  // Live availability of the handle being typed: the local format and reserved-word check first (instant), then the server
  // check, debounced. The current handle of an existing record is never checked.
  const checkedHandle = (mode === 'apply' ? values.handle : newHandle).trim().toLowerCase();
  const checking = mode === 'apply' || (editable && !!view);
  useEffect(() => {
    if (!checking) return;
    if (!checkedHandle || checkedHandle === view?.handle) { setCheck({ state: 'idle' }); return; }
    const local = validateHandle(checkedHandle);
    if (!local.ok) { setCheck({ state: 'unavailable', error: local.error }); return; }
    setCheck({ state: 'checking' });
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/headhunter/handle?handle=${encodeURIComponent(checkedHandle)}`, { signal: controller.signal });
        const data = await response.json().catch(() => ({})) as { available?: boolean; error?: string };
        if (controller.signal.aborted) return;
        if (data.available === true) setCheck({ state: 'available' });
        else if (data.error) setCheck({ state: 'unavailable', error: data.error });
        else setCheck({ state: 'idle' });
      } catch { /* aborted or offline: the submit still validates on the server */ }
    }, CHECK_DELAY_MS);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [checkedHandle, checking, view?.handle]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setErrors({}); setFormError(''); setNotice('');
    try {
      const apply = mode === 'apply';
      const { ok, data } = await send('/api/headhunter', apply ? 'POST' : 'PATCH', requestBody(values, { apply }));
      if (!ok) {
        const key = formKeyForField(data.field);
        if (key && data.error) setErrors({ [key]: data.error });
        else setFormError(data.error || HEADHUNTER_API_ERRORS.UNAVAILABLE);
        return;
      }
      if (apply) trackEvent(ANALYTICS.apply, { handle: values.handle.trim().toLowerCase() });
      setNotice(apply ? T.applied : data.status === 'pending' && mode !== 'pending' ? T.savedPending : T.saved);
      setValues((current) => ({ ...current, attested: false }));
      router.refresh();
    } catch {
      setFormError(HEADHUNTER_API_ERRORS.UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (renameBusy) return;
    setRenameBusy(true); setRenameError(''); setNotice('');
    try {
      const { ok, data } = await send('/api/headhunter/handle', 'POST', { handle: newHandle.trim().toLowerCase() });
      if (!ok) { setRenameError(data.error || HEADHUNTER_API_ERRORS.UNAVAILABLE); return; }
      setNotice(T.renamed);
      router.refresh();
    } catch {
      setRenameError(HEADHUNTER_API_ERRORS.UNAVAILABLE);
    } finally {
      setRenameBusy(false);
    }
  }

  async function copyLink() {
    if (!view?.publicUrl) return;
    try { await navigator.clipboard.writeText(view.publicUrl); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the link stays visible */ }
  }

  if (mode === 'closed') {
    return <section className="hh-ed-panel" aria-labelledby="hh-closed-title"><h2 id="hh-closed-title">{T.closedTitle}</h2><p className="hh-ed-help">{T.closedText}</p></section>;
  }

  const fallbackName = T.previewNamePlaceholder;
  const preview = previewView(values, fallbackName);
  const share = shareFallbacks(values, fallbackName);
  const tagHandle = view?.handle ?? (isHandleFormat(values.handle.trim().toLowerCase()) ? values.handle.trim().toLowerCase() : '');
  const nameChanged = mode === 'approved' && values.displayName.trim() !== (view?.displayName ?? '');
  const errorProps = (key: keyof Errors, id: string) => errors[key] ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {};
  const handleBadge = check.state === 'available' ? <span className="hh-ed-ok">{T.handleAvailable}</span>
    : check.state === 'checking' ? <span className="hh-ed-wait">{T.handleChecking}</span>
    : check.state === 'unavailable' ? <span className="hh-ed-bad" aria-hidden="true">✕</span> : null;
  const handleMessage = errors.handle || (check.state === 'unavailable' ? check.error : '');

  return <div className="hh-ed">
    <div className="hh-ed-main">
      {view && <section className="hh-ed-panel" aria-labelledby="hh-status-title">
        <div className="hh-ed-top"><h2 id="hh-status-title">{mode === 'draft' ? (view.reason ? T.changesRequestedTitle : T.progressHeading) : mode === 'pending' ? T.pendingTitle : mode === 'approved' ? T.liveTitle : view.status === 'rejected' ? T.rejectedTitle : T.suspendedTitle}</h2><span className="hh-ed-pill" data-status={view.status}>{STATUS_PILL[view.status]}</span></div>
        {mode === 'draft' && <div className="hh-ed-meter">
          <div className="hh-ed-meter-row"><b>{view.progress.label}</b><span>{view.progress.remaining}</span></div>
          <div className="hh-ed-bar" role="progressbar" aria-valuemin={0} aria-valuemax={view.progress.required} aria-valuenow={Math.min(view.progress.published, view.progress.required)} aria-label={view.progress.label}><i style={{ width: `${Math.min(100, Math.round((view.progress.published / view.progress.required) * 100))}%` }} /></div>
          <p className="hh-ed-hint">{T.progressHint} <Link href="/projects/new" className="hh-ed-link-button">{T.publishProject}</Link></p>
        </div>}
        {mode === 'draft' && view.reason && <p className="hh-ed-reason"><strong>{T.reasonLabel}</strong>{view.reason}</p>}
        {mode === 'draft' && view.reason && <p className="hh-ed-note">{T.changesRequestedText}</p>}
        {mode === 'pending' && <p className="hh-ed-note">{T.pendingText}</p>}
        {mode === 'pending' && view.reason && <p className="hh-ed-reason"><strong>{T.reasonLabel}</strong>{view.reason}</p>}
        {mode === 'approved' && view.publicUrl && <div className="hh-ed-live">
          <code dir="ltr">{minisiteDisplay(view.handle)}</code>
          <button type="button" className="hh-ed-btn" onClick={copyLink}>{copied ? T.liveCopied : T.liveCopy}</button>
          <Link className="hh-ed-btn pri" href={`/${view.handle}`}>{T.liveOpen}</Link>
        </div>}
        {mode === 'approved' && <p className="hh-ed-note">{T.liveShare}</p>}
        {mode === 'readonly' && <><p className="hh-ed-reason"><strong>{T.reasonLabel}</strong>{view.reason ?? ''}</p><p className="hh-ed-note">{T.readonlyText}</p></>}
      </section>}

      {mode === 'apply' && <p className="hh-ed-note" style={{ marginTop: 0 }}>{T.applyNote}</p>}

      {editable && <form onSubmit={submit} noValidate>
        <section className="hh-ed-panel" aria-labelledby="hh-identity-title">
          <h2 id="hh-identity-title">{T.identityTitle}</h2><p className="hh-ed-help">{T.identityHelp}</p>
          <Field id="hh-name" label={T.displayName} count={`${values.displayName.length} / ${HEADHUNTER_LIMITS.displayName.max}`} error={errors.displayName}>
            <input id="hh-name" type="text" value={values.displayName} maxLength={HEADHUNTER_LIMITS.displayName.max} autoComplete="organization"
              onChange={(event) => {
                const name = event.target.value;
                set('displayName', name);
                if (mode === 'apply' && !handleTouched) setValues((current) => ({ ...current, displayName: name, handle: suggestHandle(name) }));
              }} {...errorProps('displayName', 'hh-name')} />
          </Field>
          {nameChanged && <p className="hh-ed-hint">{T.nameChangeWarning}</p>}
          {mode === 'apply' && <Field id="hh-handle" label={T.handle} hint={T.handleHint} error={handleMessage}>
            <div className="hh-ed-handle" aria-invalid={!!handleMessage || undefined}><span className="pre">{HANDLE_PREFIX}</span>
              <input id="hh-handle" type="text" dir="ltr" value={values.handle} maxLength={30} spellCheck={false} autoCapitalize="none" autoComplete="off"
                onChange={(event) => { setHandleTouched(true); set('handle', event.target.value); }} aria-describedby={handleMessage ? 'hh-handle-error' : 'hh-handle-hint'} />{handleBadge}</div>
            <p className="hh-ed-hint" id="hh-handle-hint">{T.handleLatinOnly}</p>
            {suggestion && suggestion !== values.handle.trim().toLowerCase() && <p className="hh-ed-suggest">{T.handleSuggest} <button type="button" onClick={() => { setHandleTouched(true); set('handle', suggestion); }}><bdi dir="ltr">{suggestion}</bdi></button></p>}
          </Field>}
          <div className="hh-ed-row">
            <Field id="hh-kind" label={T.kind} error={errors.kind}>
              <select id="hh-kind" value={values.kind} onChange={(event) => set('kind', event.target.value as FormValues['kind'])} {...errorProps('kind', 'hh-kind')}>
                <option value="agency">{HEADHUNTER_KIND_LABEL.agency}</option><option value="independent">{HEADHUNTER_KIND_LABEL.independent}</option>
              </select>
            </Field>
            <Field id="hh-city" label={T.city} hint={T.optional} error={errors.city}>
              <input id="hh-city" type="text" value={values.city} maxLength={HEADHUNTER_LIMITS.city} onChange={(event) => set('city', event.target.value)} {...errorProps('city', 'hh-city')} />
            </Field>
          </div>
        </section>

        <section className="hh-ed-panel" aria-labelledby="hh-header-title">
          <h2 id="hh-header-title">{T.headerTitle}</h2><p className="hh-ed-help">{T.headerHelp}</p>
          <Field id="hh-tagline" label={T.tagline} count={`${values.tagline.length} / ${HEADHUNTER_LIMITS.tagline}`} error={errors.tagline}>
            <input id="hh-tagline" type="text" value={values.tagline} maxLength={HEADHUNTER_LIMITS.tagline} onChange={(event) => set('tagline', event.target.value)} {...errorProps('tagline', 'hh-tagline')} />
          </Field>
          <Field id="hh-about" label={T.about} count={`${values.about.length} / ${HEADHUNTER_LIMITS.about}`} error={errors.about}>
            <textarea id="hh-about" value={values.about} maxLength={HEADHUNTER_LIMITS.about} onChange={(event) => set('about', event.target.value)} {...errorProps('about', 'hh-about')} />
          </Field>
        </section>

        <section className="hh-ed-panel" aria-labelledby="hh-contact-title">
          <h2 id="hh-contact-title">{T.contactTitle}</h2><p className="hh-ed-help">{T.contactHelp}</p>
          {errors.contact && <p className="hh-ed-error" role="alert">{errors.contact}</p>}
          <div className="hh-ed-row">
            <Field id="hh-email" label={T.email} error={errors.email}><input id="hh-email" type="email" dir="ltr" value={values.email} maxLength={HEADHUNTER_LIMITS.email} autoComplete="off" onChange={(event) => set('email', event.target.value)} {...errorProps('email', 'hh-email')} /></Field>
            <Field id="hh-phone" label={T.phone} error={errors.phone}><input id="hh-phone" type="tel" dir="ltr" value={values.phone} maxLength={20} autoComplete="off" onChange={(event) => set('phone', event.target.value)} {...errorProps('phone', 'hh-phone')} /></Field>
            <Field id="hh-whatsapp" label={T.whatsapp} error={errors.whatsapp}><input id="hh-whatsapp" type="tel" dir="ltr" value={values.whatsapp} maxLength={20} autoComplete="off" placeholder="050-000-0000" onChange={(event) => set('whatsapp', event.target.value)} {...errorProps('whatsapp', 'hh-whatsapp')} /></Field>
            <Field id="hh-website" label={T.website} hint={T.websiteHint} error={errors.website}><input id="hh-website" type="url" dir="ltr" value={values.website} maxLength={HEADHUNTER_LIMITS.url} autoComplete="off" placeholder="https://" onChange={(event) => set('website', event.target.value)} {...errorProps('website', 'hh-website')} /></Field>
          </div>
          <Field id="hh-linkedin" label={T.linkedin} hint={T.linkedinHint} error={errors.linkedin}><input id="hh-linkedin" type="url" dir="ltr" value={values.linkedin} maxLength={HEADHUNTER_LIMITS.url} autoComplete="off" placeholder="https://www.linkedin.com/company/…" onChange={(event) => set('linkedin', event.target.value)} {...errorProps('linkedin', 'hh-linkedin')} /></Field>
          <p className="hh-ed-public">{T.contactPublic}</p>
        </section>

        <section className="hh-ed-panel" aria-labelledby="hh-share-title">
          <h2 id="hh-share-title">{T.shareTitle} <small className="hh-ed-hint">{T.optional}</small></h2><p className="hh-ed-help">{T.shareHelp}</p>
          <Field id="hh-share-title-input" label={T.shareTitleField} count={`${values.shareTitle.length} / ${HEADHUNTER_LIMITS.shareTitle}`} error={errors.shareTitle}>
            <input id="hh-share-title-input" type="text" value={values.shareTitle} maxLength={HEADHUNTER_LIMITS.shareTitle} placeholder={share.title} onChange={(event) => set('shareTitle', event.target.value)} {...errorProps('shareTitle', 'hh-share-title-input')} />
          </Field>
          <Field id="hh-share-description" label={T.shareDescriptionField} count={`${values.shareDescription.length} / ${HEADHUNTER_LIMITS.shareDescription}`} error={errors.shareDescription}>
            <input id="hh-share-description" type="text" value={values.shareDescription} maxLength={HEADHUNTER_LIMITS.shareDescription} placeholder={share.description} onChange={(event) => set('shareDescription', event.target.value)} {...errorProps('shareDescription', 'hh-share-description')} />
          </Field>
        </section>

        <section className="hh-ed-panel" aria-label={mode === 'apply' ? T.submitApply : T.submitSave}>
          {mode === 'apply' && <>
            <label className="hh-ed-check"><input type="checkbox" checked={values.attested} onChange={(event) => set('attested', event.target.checked)} aria-describedby={errors.attested ? 'hh-attested-error' : undefined} /><span>{T.attestation}</span></label>
            {errors.attested && <p className="hh-ed-error" id="hh-attested-error" role="alert">{errors.attested}</p>}
          </>}
          {formError && <p className="hh-ed-error" role="alert">{formError}</p>}
          <div className="hh-ed-btns">
            <button type="submit" className="hh-ed-btn pri" disabled={busy}>{mode === 'apply' ? (busy ? T.submitApplying : T.submitApply) : (busy ? T.submitSaving : T.submitSave)}</button>
          </div>
          {notice && <p className="hh-ed-ok-msg" role="status">{notice}</p>}
        </section>
      </form>}

      {editable && view && <section className="hh-ed-panel" aria-labelledby="hh-rename-title">
        <h2 id="hh-rename-title">{T.renameHeading}</h2><p className="hh-ed-help">{T.renameNote}</p>
        <Field id="hh-new-handle" label={T.handle} hint={T.handleHint} error={renameError || (check.state === 'unavailable' && checkedHandle !== view.handle ? check.error : '')}>
          <div className="hh-ed-handle"><span className="pre">{HANDLE_PREFIX}</span>
            <input id="hh-new-handle" type="text" dir="ltr" value={newHandle} maxLength={30} spellCheck={false} autoCapitalize="none" autoComplete="off" onChange={(event) => { setRenameError(''); setNewHandle(event.target.value); }} />{handleBadge}</div>
          <p className="hh-ed-hint">{T.handleLatinOnly}</p>
        </Field>
        <div className="hh-ed-btns"><button type="button" className="hh-ed-btn" disabled={renameBusy || checkedHandle === view.handle || check.state !== 'available'} onClick={rename}>{renameBusy ? T.renaming : T.renameButton}</button></div>
      </section>}
    </div>

    <aside className="hh-ed-aside" aria-label={T.previewHeading}>
      <p className="hh-ed-preview-label"><strong>{T.previewHeading}</strong><span>{T.previewNote}</span></p>
      <div className="hh-ed-preview-box" inert><HeadhunterHero view={preview} openCount={0} publishedCount={0} preview /></div>
      <section className="hh-ed-panel hh-ed-tag" aria-labelledby="hh-tag-title">
        <h2 id="hh-tag-title">{T.tagHeading}</h2>
        <p className="row" inert>{tagHandle ? <HeadhunterTagPill headhunter={{ name: preview.displayName, handle: tagHandle }} /> : <span className="hh-ed-hint">{T.tagNeedsHandle}</span>}</p>
        <p className="hh-ed-note">{view?.live ? T.tagLive : T.tagNotLive}</p>
      </section>
    </aside>
  </div>;
}
