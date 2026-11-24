import { t } from './localization.en.mjs?v=6';

export function createMutationAccess(fetcher = fetch) {
  let state = 'checking', editorAllowed = false, version = 0, pending;
  const listeners = new Set();
  const publish = (next, editor = false) => {
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
    subscribe(listener) { listeners.add(listener); listener(); },
    invalidate() { version++; publish('unavailable'); },
    async refresh() {
      if (pending) return pending;
      const captured = version;
      pending = (async () => {
        try {
          const response = await fetcher('/api/capabilities', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
          if (!response.ok) throw new Error();
          const result = await response.json();
          if (typeof result.mutationsAllowed !== 'boolean' || typeof result.editorAllowed !== 'boolean')
            throw new Error();
          if (captured === version) publish(result.mutationsAllowed ? 'enabled' : 'viewOnly', result.editorAllowed);
        } catch {
          if (captured === version) publish('unavailable');
        }
      })();
      try { await pending; } finally { pending = null; }
    },
    async request(url, options = {}, editor = false) {
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

export async function responseDetail(response) {
  try {
    const text = await response.text();
    try {
      const problem = JSON.parse(text);
      if (typeof problem === 'string') return problem;
      const detail = [problem?.detail, problem?.message, problem?.title].find(value => typeof value === 'string' && value);
      const errors = Array.isArray(problem?.errors) ? problem.errors
        .filter(item => typeof item?.message === 'string')
        .map(item => `${typeof item.path === 'string' ? `${item.path}: ` : ''}${item.message}`).join('; ') : '';
      return [detail, errors].filter(Boolean).join(' ') || t('requestNoDetail');
    } catch { return text || t('requestNoDetail'); }
  } catch { return t('requestNoDetail'); }
}

export function syncMutationControls(root, access, busy = false) {
  root.querySelectorAll('[data-mutation]').forEach(node => { node.disabled = !access.allowed || busy; });
}
