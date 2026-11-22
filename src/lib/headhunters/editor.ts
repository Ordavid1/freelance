// Pure helpers of the apply/edit screen (/profile/headhunter): which state the screen is in, the form model, the request
// body and the live preview. No server-only imports, so the client editor, the page and the tests share them.
import { SITE_NAME } from '../seo/site.ts';
import { HEADHUNTER_LIMITS } from './constants.ts';
import { isHandleFormat } from './handle.ts';
import type { MinisiteView } from './minisite.ts';
import { resolveHeadhunterShare } from './share.ts';
import type { HeadhunterContact, HeadhunterKind, ContactLink } from './types.ts';
import type { ownerView } from './view.ts';

/** What `GET /api/headhunter` returns for the owner (also what the server page passes to the editor). */
export type OwnerView = ReturnType<typeof ownerView>;

/**
 * - closed:   no record and applications are not open yet
 * - apply:    no record, applications open
 * - draft:    saved, waiting for the project threshold (or changes were requested: `reason` is set)
 * - pending:  submitted, under review (still editable)
 * - approved: live (edits keep it live, except a new display name which goes back to review)
 * - readonly: rejected or suspended (the API blocks edits)
 */
export type EditorMode = 'closed' | 'apply' | 'draft' | 'pending' | 'approved' | 'readonly';

export function editorMode(view: OwnerView | null, applicationsOpen: boolean): EditorMode {
  if (!view) return applicationsOpen ? 'apply' : 'closed';
  switch (view.status) {
    case 'draft': return 'draft';
    case 'pending': return 'pending';
    case 'approved': return 'approved';
    default: return 'readonly';
  }
}

export type FormValues = {
  displayName: string;
  kind: HeadhunterKind;
  handle: string;
  city: string;
  tagline: string;
  about: string;
  email: string;
  phone: string;
  whatsapp: string;
  website: string;
  linkedin: string;
  shareTitle: string;
  shareDescription: string;
  attested: boolean;
};

export const EMPTY_FORM: FormValues = {
  displayName: '', kind: 'agency', handle: '', city: '', tagline: '', about: '',
  email: '', phone: '', whatsapp: '', website: '', linkedin: '', shareTitle: '', shareDescription: '', attested: false,
};

export function formFromView(view: OwnerView | null): FormValues {
  if (!view) return { ...EMPTY_FORM };
  return {
    displayName: view.displayName, kind: view.kind, handle: view.handle,
    city: view.city ?? '', tagline: view.tagline ?? '', about: view.about ?? '',
    email: view.contact.email ?? '', phone: view.contact.phone ?? '', whatsapp: view.contact.whatsapp ?? '',
    website: view.contact.website ?? '', linkedin: view.contact.linkedin ?? '',
    shareTitle: view.share?.title ?? '', shareDescription: view.share?.description ?? '',
    attested: false,
  };
}

const CONTACT_FIELDS = ['email', 'phone', 'whatsapp', 'website', 'linkedin'] as const;

/** The JSON body of POST (apply, with `handle` and `attested`) or PATCH (edit). Empty fields are left out. */
export function requestBody(values: FormValues, options: { apply: boolean }) {
  const contact: HeadhunterContact = {};
  for (const key of CONTACT_FIELDS) if (values[key].trim()) contact[key] = values[key].trim();
  const share = { ...(values.shareTitle.trim() ? { title: values.shareTitle.trim() } : {}), ...(values.shareDescription.trim() ? { description: values.shareDescription.trim() } : {}) };
  return {
    displayName: values.displayName.trim(),
    kind: values.kind,
    ...(values.city.trim() ? { city: values.city.trim() } : {}),
    ...(values.tagline.trim() ? { tagline: values.tagline.trim() } : {}),
    ...(values.about.trim() ? { about: values.about.trim() } : {}),
    contact,
    // PATCH merges over the stored record, so an emptied share block must be sent explicitly to clear it.
    share: options.apply && Object.keys(share).length === 0 ? undefined : share,
    ...(options.apply ? { handle: values.handle.trim().toLowerCase(), attested: values.attested } : {}),
  };
}

/** Maps the API's `field` (e.g. `contact.email`, `share.title`) to the form key it belongs to. */
export function formKeyForField(field: string | undefined): keyof FormValues | 'contact' | null {
  switch (field) {
    case 'displayName': case 'kind': case 'handle': case 'city': case 'tagline': case 'about': case 'attested': return field;
    case 'share.title': return 'shareTitle';
    case 'share.description': return 'shareDescription';
    case 'contact': return 'contact';
    case undefined: return null;
    default:
      if (field.startsWith('contact.')) {
        const key = field.slice('contact.'.length);
        return (CONTACT_FIELDS as readonly string[]).includes(key) ? (key as keyof FormValues) : 'contact';
      }
      return null;
  }
}

function previewHref(kind: ContactLink['kind'], value: string) {
  switch (kind) {
    case 'email': return `mailto:${value}`;
    case 'phone': return `tel:${value}`;
    case 'whatsapp': return `https://wa.me/${value.replace(/\D/g, '')}`;
    default: return value;
  }
}

const PREVIEW_LABEL: Partial<Record<ContactLink['kind'], string>> = { whatsapp: 'וואטסאפ', linkedin: 'LinkedIn' };

/** The page header as the minisite will show it, from the raw (not yet validated) form values. */
export function previewView(values: FormValues, fallbackName: string): MinisiteView {
  const contact: ContactLink[] = [];
  for (const kind of CONTACT_FIELDS) {
    const value = values[kind].trim();
    if (value) contact.push({ kind, href: previewHref(kind, value), label: PREVIEW_LABEL[kind] ?? value.replace(/^https:\/\//, '').replace(/\/+$/, '') });
  }
  const handle = isHandleFormat(values.handle.trim().toLowerCase()) ? values.handle.trim().toLowerCase() : '';
  return {
    displayName: values.displayName.trim() || fallbackName,
    handle,
    kind: values.kind,
    ...(values.city.trim() ? { city: values.city.trim() } : {}),
    ...(values.tagline.trim() ? { tagline: values.tagline.trim() } : {}),
    ...(values.about.trim() ? { about: values.about.trim() } : {}),
    contact,
    share: {},
  };
}

/** What the share card falls back to while a share field is empty (shown as the field's placeholder). */
export function shareFallbacks(values: FormValues, fallbackName: string) {
  const resolved = resolveHeadhunterShare({
    displayName: values.displayName.trim() || fallbackName,
    handle: 'preview',
    tagline: values.tagline.trim(),
    openProjects: 0,
  }, SITE_NAME);
  // With no tagline the resolver would say "no open projects" (the count is unknown while typing): use the plain sentence.
  const description = values.tagline.trim() ? resolved.description : `פרויקטים של ${values.displayName.trim() || fallbackName} ב־${SITE_NAME}.`;
  return { title: resolved.title, description };
}

export const LIMITS = HEADHUNTER_LIMITS;

/** A handle's availability check state in the form. */
export type HandleCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unavailable'; error: string };
