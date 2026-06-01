import { useEffect, useState } from 'react';

export function isJsonAsset(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith('data:application/json')) return true;
  const cleaned = url.split('?')[0].split('#')[0].toLowerCase();
  return cleaned.endsWith('.json');
}

export function looksLikeLottie(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return Array.isArray(o.layers) && typeof o.v === 'string';
}

function parseJsonDataUrl(dataUrl: string): unknown {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const header = dataUrl.slice(0, commaIdx);
  const payload = dataUrl.slice(commaIdx + 1);
  const isBase64 = /;base64/.test(header);
  try {
    const jsonText = isBase64 ? atob(payload) : decodeURIComponent(payload);
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

type LottieState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: object }
  | { status: 'error' };

export function useLottieAnimation(url: string | undefined): LottieState {
  const [state, setState] = useState<LottieState>({ status: 'idle' });

  useEffect(() => {
    if (!url || !isJsonAsset(url)) {
      setState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });

    if (url.startsWith('data:')) {
      const parsed = parseJsonDataUrl(url);
      if (parsed && looksLikeLottie(parsed)) {
        setState({ status: 'ready', data: parsed as object });
      } else {
        setState({ status: 'error' });
      }
      return;
    }

    fetch(url)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (looksLikeLottie(json)) setState({ status: 'ready', data: json });
        else setState({ status: 'error' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
