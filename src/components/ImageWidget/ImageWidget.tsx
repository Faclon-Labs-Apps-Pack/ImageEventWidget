import { FileText } from 'react-feather';
import Lottie from 'lottie-react';
import { EmptyState } from '@faclon-labs/design-sdk/EmptyState';
import { NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/NoDataOneIllustration';
import { Card } from '@faclon-labs/design-sdk/Card';
import { DataEntry, WidgetEvent, ImageWidgetUIConfig, ImageEventConfig } from '../../iosense-sdk/types';
import { isJsonAsset, useLottieAnimation } from '../../iosense-sdk/lottie';
import './ImageWidget.css';

interface ImageWidgetProps {
  config: ImageWidgetUIConfig;
  data: DataEntry[];
  onEvent: (event: WidgetEvent) => void;
  /** Default rendered image size (px, 0 = auto). Top-level envelope keys, outside uiConfig. */
  width?: number;
  height?: number;
  /** When true, the widget is being rendered inside the dashboard editor.
   *  Link redirection is disabled so clicks don't navigate the user away
   *  while they're arranging widgets. */
  editMode?: boolean;
  /** Called when "Configure Widget" is clicked in the no-config empty state. Host should open the file picker / configurator. */
  onConfigureClick?: () => void;
}

// Read a bindable value: resolved data takes priority, config field is the fallback.
function getValue(key: string, config: unknown, data: DataEntry[]): string | number | null {
  const entry = data.find((d) => d.key === key);
  if (entry !== undefined) {
    const v = entry.value;
    // Series payloads are objects — callers must use getSeriesData() for series keys.
    if (v !== null && typeof v === 'object') return null;
    return v as string | number | null;
  }
  return getValueAtPath(config, key) as string | number | null;
}

function getValueAtPath(obj: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce((acc: unknown, k) => (acc as Record<string, unknown>)?.[k], obj);
}

/**
 * Normalize user-entered link input:
 * - Already has http(s):// → use as-is
 * - Starts with '/' → treated as absolute path on current origin (SPA route)
 * - Has a dot before any slash (e.g. "faclon.com" or "sub.foo.io/path") →
 *   prepend "https://" so it's a real external URL
 * - Otherwise → return as-is (will be resolved relative to current origin)
 *
 * Prevents "faclon.com" from being interpreted as `iosense.io/faclon.com`.
 */
function normalizeLinkUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  const beforeSlash = trimmed.split('/')[0];
  if (beforeSlash.includes('.')) return `https://${trimmed}`;
  return trimmed;
}

function isValidLinkUrl(raw: string): boolean {
  const normalized = normalizeLinkUrl(raw);
  if (!normalized) return false;
  try {
    const u = new URL(normalized, window.location.origin);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Handle a link click on the widget.
 *
 * - Modifier-clicks (Ctrl/Cmd/Shift or middle button) fall through to the browser
 *   so power-users can still open in a new tab explicitly.
 * - Same-origin URLs use history.pushState + popstate to trigger the host's
 *   SPA router (Angular Router listens to popstate) without a full page reload.
 * - Cross-origin URLs navigate the current window via location.href (no new tab).
 *
 * NOTE on Angular integration: Angular Router (HTML5 mode) reacts to popstate
 * events and will match the pushed URL against its route table. If the host uses
 * HashLocationStrategy or a custom router config that doesn't listen to
 * popstate, this will still change the URL but Angular may not re-render;
 * in that case the host needs to observe the URL change and route accordingly.
 */
function handleLinkClick(e: React.MouseEvent<HTMLAnchorElement>, url: string, newTab: boolean) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  // Open-in-new-tab: let the native anchor (target="_blank") handle it so the
  // current dashboard tab is preserved. No SPA interception.
  if (newTab) return;
  e.preventDefault();
  const normalized = normalizeLinkUrl(url);
  if (!normalized) return;
  let target: URL;
  try {
    target = new URL(normalized, window.location.origin);
  } catch {
    return;
  }
  if (target.origin === window.location.origin) {
    const relative = target.pathname + target.search + target.hash;
    window.history.pushState(null, '', relative);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } else {
    window.location.href = target.href;
  }
}

/**
 * Compare a device's resolved value against the event's rule.
 *
 * String vs numeric semantics:
 * - `==` / `!=` compare as strings first (so `"N/A"` matches `"N/A"`). If both
 *   sides parse as numbers, we also accept a numeric-equality match so that
 *   trailing zeros / whitespace don't cause false negatives on numbers.
 * - `>` / `<` / `>=` / `<=` are numeric-only: they require both sides to
 *   parse as valid numbers. A string-only value (e.g. `"N/A"`) never matches
 *   an ordering operator, which is the right behavior for a state indicator.
 * - `within range` / `outside range` are numeric-only and use both `value`
 *   (low bound) and `value2` (high bound), inclusive on both ends.
 */
function evaluateCondition(
  operator: ImageEventConfig['operator'],
  ruleValue: string,
  resolvedValue: string | number | null,
  ruleValue2?: string,
): boolean {
  if (resolvedValue === null || resolvedValue === undefined) return false;
  const resolvedStr = String(resolvedValue);
  const a = typeof resolvedValue === 'number' ? resolvedValue : parseFloat(resolvedStr);
  const b = parseFloat(ruleValue);
  const b2 = ruleValue2 !== undefined ? parseFloat(ruleValue2) : NaN;
  switch (operator) {
    case '==': return resolvedStr === ruleValue || (!isNaN(a) && !isNaN(b) && a === b);
    case '!=': return resolvedStr !== ruleValue && !(!isNaN(a) && !isNaN(b) && a === b);
    case '>':  return !isNaN(a) && !isNaN(b) && a > b;
    case '<':  return !isNaN(a) && !isNaN(b) && a < b;
    case '>=': return !isNaN(a) && !isNaN(b) && a >= b;
    case '<=': return !isNaN(a) && !isNaN(b) && a <= b;
    case 'within range':  return !isNaN(a) && !isNaN(b) && !isNaN(b2) && a >= Math.min(b, b2) && a <= Math.max(b, b2);
    case 'outside range': return !isNaN(a) && !isNaN(b) && !isNaN(b2) && (a < Math.min(b, b2) || a > Math.max(b, b2));
    default:   return false;
  }
}

function NoConfigScreen({
  wrapInCard,
}: {
  wrapInCard: boolean;
  onConfigureClick?: () => void;
}) {
  return (
    <div className={`iw-widget iw-widget__empty${wrapInCard ? '' : ' iw-widget--no-wrap'}`}>
      <Card elevation="LowRaised" className="iw-widget__empty-card">
        <EmptyState
          size="Medium"
          illustration={<NoDataOneIllustration />}
          title="Image not configured"
          description="Double click or drag and drop Image widget to configure an image"
        />
      </Card>
    </div>
  );
}

export function ImageWidget({ config, data, onEvent: _onEvent, editMode, onConfigureClick }: ImageWidgetProps) {
  // The widget fills whatever cell the host gives it. Images inside stretch to
  // fill via object-fit: fill so they track single-axis resize. No aspect-ratio
  // lock — user resize on the dashboard controls dimensions directly.
  if (!config) return <NoConfigScreen wrapInCard onConfigureClick={onConfigureClick} />;

  const wrapInCard = config.style?.card?.wrapInCard ?? true;
  const widgetClass = `iw-widget${wrapInCard ? '' : ' iw-widget--no-wrap'}`;

  const events = config.events ?? [];

  // Evaluate events in order — find first matching event that contributes an overlay image
  let activeEvent: ImageEventConfig | null = null;
  let activeFrameSegment: [number, number] | undefined;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const matches = evt.topic
      ? evaluateCondition(evt.operator, evt.value, getValue(`events[${i}].topic`, config, data), evt.value2)
      : !!evt.image;
    if (matches) {
      activeEvent = evt;
      if (evt.frameRangeEnabled && (evt.startFrame || evt.endFrame)) {
        activeFrameSegment = [evt.startFrame ?? 0, evt.endFrame ?? 0];
      }
      break;
    }
  }

  // Event image replaces the default (same size, fills container). The
  // `alignment` field is preserved in config for future overlay support but
  // does not affect rendering — the active image simply fills the widget cell.
  const activeImage = activeEvent?.image || config.defaultImage;

  if (!activeImage) {
    return <NoConfigScreen wrapInCard={wrapInCard} onConfigureClick={onConfigureClick} />;
  }

  // In edit mode, suppress link redirection so dashboard editors can click the
  // widget without being navigated away. The linkConfig is preserved in the
  // envelope; only the runtime <a> wrap is skipped. `normalizeLinkUrl` ensures
  // inputs like "faclon.com" (no protocol) are treated as external URLs, not
  // as a relative path against the current dashboard origin.
  const linkUrl =
    !editMode && config.linkConfig?.enabled && isValidLinkUrl(config.linkConfig.url)
      ? normalizeLinkUrl(config.linkConfig.url)
      : null;
  const linkNewTab = !!config.linkConfig?.newTab;

  const objectFit = config.style?.objectFit ?? 'fill';
  const content = (
    <ActiveAsset
      src={activeImage}
      style={{ objectFit }}
      frameSegment={activeFrameSegment}
    />
  );

  return (
    <div className={widgetClass}>
      {linkUrl ? (
        <a
          href={linkUrl}
          className="iw-widget__link"
          target={linkNewTab ? '_blank' : undefined}
          rel={linkNewTab ? 'noopener noreferrer' : undefined}
          onClick={(e) => handleLinkClick(e, linkUrl, linkNewTab)}
        >
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  );
}

function ActiveAsset({
  src,
  style,
  frameSegment,
}: {
  src: string;
  style: React.CSSProperties;
  frameSegment?: [number, number];
}) {
  const lottie = useLottieAnimation(isJsonAsset(src) ? src : undefined);

  if (isJsonAsset(src)) {
    if (lottie.status === 'ready') {
      return (
        <Lottie
          className="iw-widget__lottie"
          style={style}
          animationData={lottie.data}
          loop
          autoplay
          initialSegment={frameSegment}
        />
      );
    }
    if (lottie.status === 'loading') {
      return <div className="iw-widget__skeleton" style={style} />;
    }
    return (
      <div className="iw-widget__file-tile" style={style}>
        <FileText size={28} />
        <span className="BodySmallRegular">data.json</span>
      </div>
    );
  }

  return <img className="iw-widget__image" src={src} alt="widget" style={style} />;
}
