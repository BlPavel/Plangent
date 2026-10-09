import { computed, ref, onBeforeUnmount } from 'vue';
import { mrReviewApi } from '../api';
import type { MrDetail, ReviewRequest } from '../types';
/** One mounted tab owns its requests. No timers, polling or background refresh. */
export function createReviewStore(scope: string) {
  const detail = ref<MrDetail>(), requests = ref<ReviewRequest[]>([]), errors = ref<string[]>([]), error = ref(''), busy = ref(false);
  let alive = true;
  onBeforeUnmount(() => {
    alive = false;
  });
  const id = computed(() => detail.value?.session.id ?? '');
  async function run<T>(fn: () => Promise<T>, accept?: (value: T) => void) {
    if (busy.value)
      return undefined;
    busy.value = true;
    error.value = '';
    try {
      const result = await fn();
      if (alive)
        accept?.(result);
      return result;
    }
    catch (e) {
      if (alive)
        error.value = e instanceof Error ? e.message : String(e);
      return undefined;
    }
    finally {
      if (alive)
        busy.value = false;
    }
  }
  const accept = (v: MrDetail) => {
    detail.value = v;
    if (v.publication_error)
      error.value = v.publication_error;
  };
  const list = (query?: string) => run(() => mrReviewApi.list(scope, query), r => {
    requests.value = r.requests;
    errors.value = r.errors.map(e => e.message);
  });
  const open = (input: {
    url?: string;
    project_id?: string;
    iid?: number;
  }) => run(() => mrReviewApi.open(scope, input), accept);
  const refresh = (version?: number) => run(() => mrReviewApi.refresh(scope, id.value, version), accept);
  async function add(note: {
    body: string;
    path?: string;
    side?: 'old' | 'new';
    line?: number;
    head?: string;
  }, immediate = false) {
    return run(async () => {
      const draft = await mrReviewApi.add(scope, id.value, note);
      if (immediate) {
        try {
          return await mrReviewApi.publish(scope, id.value, [draft.id]);
        }
        catch (cause) {
          const result = await mrReviewApi.detail(scope, id.value);
          result.publication_error = cause instanceof Error ? cause.message : String(cause);
          return result;
        }
      }
      return mrReviewApi.detail(scope, id.value);
    }, accept);
  }
  const edit = (draft: string, body: string) => run(() => mrReviewApi.edit(scope, id.value, draft, body), accept);
  const remove = (draft: string) => run(() => mrReviewApi.remove(scope, id.value, draft), accept);
  const recover = (draft: string, published: boolean) => run(() => mrReviewApi.recover(scope, id.value, draft, published), accept);
  const publish = (ids: string[]) => run(() => mrReviewApi.publish(scope, id.value, ids), accept);
  const reply = (discussion: string, body: string) => run(() => mrReviewApi.reply(scope, id.value, discussion, body), accept);
  const approve = (value: boolean) => run(() => mrReviewApi.approve(scope, id.value, value), accept);
  const viewed = (path: string, value: boolean) => run(() => mrReviewApi.viewed(scope, id.value, path, value), accept);
  return { detail, requests, errors, error, busy, list, open, refresh, add, edit, remove, publish, recover, reply, approve, viewed };
}
