// Shared by the headhunter admin scripts: argument parsing and the Firestore connection.
// Same conventions as scripts/seed-projects: dry run by default, `--commit` writes and needs an explicit project,
// Application Default Credentials (run `gcp-auth` first).
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export type CliOptions = { project?: string; commit: boolean; values: Map<string, string>; flags: Set<string> };

/** `--name value` options listed in `valueOptions`, bare `--flag`s listed in `flagOptions`; anything else is an error. */
export function parseCli(argv: string[], valueOptions: readonly string[], flagOptions: readonly string[] = []): { ok: true; options: CliOptions } | { ok: false; error: string } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const name = argument.startsWith('--') ? argument.slice(2) : '';
    if (flagOptions.includes(name)) { flags.add(name); continue; }
    if (!valueOptions.includes(name)) return { ok: false, error: `Unknown argument: ${argument}` };
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) return { ok: false, error: `--${name} needs a value` };
    values.set(name, value);
    index += 1;
  }
  const project = values.get('project') || process.env.GOOGLE_CLOUD_PROJECT || undefined;
  return { ok: true, options: { ...(project ? { project } : {}), commit: flags.has('commit'), values, flags } };
}

export function openFirestore(project: string) {
  return getFirestore(initializeApp({ credential: applicationDefault(), projectId: project }));
}

export function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}
