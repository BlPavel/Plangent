import { nextTick, onBeforeUnmount, ref, watch, type CSSProperties, type Ref } from 'vue';
const popoverAnchors = new WeakMap<HTMLElement, HTMLElement>();
export interface PopoverOptions {
    align?: 'left' | 'right';
    placement?: 'top' | 'bottom';
    at?: {
        x: number;
        y: number;
    } | null;
    minWidth?: number;
    maxWidth?: number;
    matchAnchor?: boolean;
}
export function usePopover(open: Ref<boolean>, anchor: Ref<HTMLElement | null | undefined>, panel: Ref<HTMLElement | undefined>, options: () => PopoverOptions, close: () => void) {
    const style = ref<CSSProperties>({});
    let frame = 0;
    let observer: ResizeObserver | undefined;
    async function place() {
        await nextTick();
        if (!open.value || !panel.value)
            return;
        const opts = options(), rect = anchor.value?.getBoundingClientRect();
        const point = opts.at;
        if (!rect && !point)
            return;
        const edge = 8, gap = 6, width = Math.min(opts.matchAnchor && rect ? rect.width : Math.max(opts.minWidth ?? 0, rect?.width ?? 0, panel.value.offsetWidth), opts.maxWidth ?? Infinity, window.innerWidth - edge * 2);
        const left = point?.x ?? (opts.align === 'right' ? rect!.right - width : rect!.left);
        const below = window.innerHeight - (point?.y ?? rect!.bottom) - gap - edge;
        const above = (point?.y ?? rect!.top) - gap - edge;
        const up = opts.placement === 'top' ? above > 100 || above > below : below < 160 && above > below;
        const maxHeight = Math.max(0, Math.min(360, up ? above : below));
        const height = Math.min(panel.value.scrollHeight, maxHeight);
        const top = point?.y ?? (up ? rect!.top - gap - height : rect!.bottom + gap);
        style.value = { position: 'fixed', left: Math.max(edge, Math.min(left, window.innerWidth - width - edge)) + 'px', top: Math.max(edge, Math.min(top, window.innerHeight - height - edge)) + 'px', width: width + 'px', maxHeight: maxHeight + 'px' };
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => void place()); };
    function outside(event: Event) {
        const target = event.target as Node;
        // A label forwards its click to its control after pointerdown. Treat it
        // as part of the anchor so that the forwarded click toggles only once.
        const label = target instanceof Element ? target.closest('label') : null;
        const controlId = label?.getAttribute('for');
        const control = controlId ? document.getElementById(controlId) : label?.querySelector('button,input,select,textarea');
        if (control && (anchor.value === control || anchor.value?.contains(control))) return;
        const nested = target instanceof Element ? target.closest<HTMLElement>('.popover') : null;
        const nestedAnchor = nested && popoverAnchors.get(nested);
        if (!panel.value?.contains(target) && !anchor.value?.contains(target) && !(nestedAnchor && panel.value?.contains(nestedAnchor))) close();
    }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        (anchor.value?.querySelector<HTMLElement>('button,input') ?? anchor.value)?.focus();
    }
    else if (event.key === 'Tab')
        close(); }
    function listen(on: boolean) {
        const method = on ? 'addEventListener' : 'removeEventListener';
        document[method]('pointerdown', outside);
        document[method]('keydown', key as EventListener, true);
        window[method]('resize', schedule);
        window[method]('scroll', schedule, true);
    }
    watch([open, anchor, panel, options], ([visible]) => {
        listen(false);
        observer?.disconnect();
        if (!visible) return;
        if (panel.value && anchor.value) popoverAnchors.set(panel.value, anchor.value);
        listen(true);
        if (panel.value && typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(schedule);
            observer.observe(panel.value);
        }
        void place();
    }, { immediate: true });
    onBeforeUnmount(() => { listen(false); observer?.disconnect(); cancelAnimationFrame(frame); });
    return { style, place };
}
