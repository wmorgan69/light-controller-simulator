import { t } from './localization.en.js';

type AccessState = 'checking' | 'enabled' | 'viewOnly' | 'unavailable';

export function createMutationAccess(fetcher: typeof fetch = fetch) {
  let state: AccessState = 'checking', editorAllowed = false, version = 0;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: AccessState, editor = false): void => {
    editor = next === 'enabled' && editor;
    if (state === next && editorAllowed === editor) return;
    state = next;
    editorAllowed = editor;
    listeners.forEach(listener => listener());
  };
  const access = {
    get allowed() { return state === 'enabled'; },
    get editorAllowed() { return access.allowed && editorAllowed; },
    get message() { return t(`mutationAccess_${state}`); },
    get editorMessage() { return access.allowed && !editorAllowed ? t('editorUnavailableHost') : access.message; },
    subscribe(listener: () => void) { listeners.add(listener); listener(); },
    invalidate() { version++; publish('unavailable'); },
    async refresh() {
      if (pending) return pending;
      const captured = version;
      pending = (async () => {
        try {
          const response = await fetcher('/api/capabilities', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
          if (!response.ok) throw new Error();
          const result: unknown = await response.json();
          if (typeof result !== 'object' || result === null ||
              !('mutationsAllowed' in result) || !('editorAllowed' in result) ||
              typeof result.mutationsAllowed !== 'boolean' || typeof result.editorAllowed !== 'boolean')
            throw new Error();
          if (captured === version) publish(result.mutationsAllowed ? 'enabled' : 'viewOnly', result.editorAllowed);
        } catch {
          if (captured === version) publish('unavailable');
        }
      })();
      try { await pending; } finally { pending = null; }
    },
    async request(url: string, options: RequestInit = {}, editor = false): Promise<Response> {
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase());
      if (mutation && !(editor ? access.editorAllowed : access.allowed))
        throw new Error(editor ? access.editorMessage : access.message);
      const response = await fetcher(url, options);
      if ((mutation || editor) && response.status === 403) access.invalidate();
      return response;
    }
  };
  return access;
}

export async function responseDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const problem: unknown = JSON.parse(text);
      if (typeof problem === 'string') return problem;
      const fields = problem !== null && typeof problem === 'object' ? problem : {};
      const detail = [
        'detail' in fields ? fields.detail : undefined,
        'message' in fields ? fields.message : undefined,
        'title' in fields ? fields.title : undefined
      ]
        .find(value => typeof value === 'string' && value);
      const errorItems: unknown = 'errors' in fields ? fields.errors : undefined;
      const errors = Array.isArray(errorItems) ? errorItems
        .filter((item: unknown): item is { message: string; path?: unknown } =>
          item !== null && typeof item === 'object' && 'message' in item && typeof item.message === 'string')
        .map(item => `${typeof item.path === 'string' ? `${item.path}: ` : ''}${item.message}`).join('; ') : '';
      return [detail, errors].filter(Boolean).join(' ') || t('requestNoDetail');
    } catch { return text || t('requestNoDetail'); }
  } catch { return t('requestNoDetail'); }
}

export function syncMutationControls(root: ParentNode, access: { allowed: boolean }, busy = false): void {
  root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('[data-mutation]')
    .forEach(node => { node.disabled = !access.allowed || busy; });
}
