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

function isValidLinkUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function evaluateCondition(
  operator: ImageEventConfig['operator'],
  ruleValue: string,
  resolvedValue: string | number | null,
): boolean {
  if (resolvedValue === null || resolvedValue === undefined) return false;
  const a = typeof resolvedValue === 'number' ? resolvedValue : parseFloat(String(resolvedValue));
  const b = parseFloat(ruleValue);
  switch (operator) {
    case '==': return String(resolvedValue) === ruleValue || (!isNaN(a) && !isNaN(b) && a === b);
    case '!=': return String(resolvedValue) !== ruleValue;
    case '>':  return !isNaN(a) && !isNaN(b) && a > b;
    case '<':  return !isNaN(a) && !isNaN(b) && a < b;
    case '>=': return !isNaN(a) && !isNaN(b) && a >= b;
    case '<=': return !isNaN(a) && !isNaN(b) && a <= b;
    default:   return false;
  }
}

function NoConfigScreen({
  wrapInCard,
  aspectStyle,
}: {
  wrapInCard: boolean;
  aspectStyle?: React.CSSProperties;
  onConfigureClick?: () => void;
}) {
  return (
    <div
      className={`iw-widget iw-widget__empty${wrapInCard ? '' : ' iw-widget--no-wrap'}`}
      style={aspectStyle}
    >
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

export function ImageWidget({ config, data, onEvent: _onEvent, width, height, editMode, onConfigureClick }: ImageWidgetProps) {
  // Aspect-ratio lock based on the uploaded image's natural dimensions (stored
  // in the envelope's top-level width/height). When both are set we apply
  // CSS aspect-ratio so the widget keeps its proportions on resize.
  const aspectStyle: React.CSSProperties =
    width && height && width > 0 && height > 0
      ? { aspectRatio: `${width} / ${height}` }
      : {};

  if (!config) return <NoConfigScreen wrapInCard aspectStyle={aspectStyle} onConfigureClick={onConfigureClick} />;

  const wrapInCard = config.style?.card?.wrapInCard ?? true;
  const widgetClass = `iw-widget${wrapInCard ? '' : ' iw-widget--no-wrap'}`;

  const events = config.events ?? [];

  // Evaluate events in order — find first matching event that contributes an overlay image
  let activeEvent: ImageEventConfig | null = null;
  let activeFrameSegment: [number, number] | undefined;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const matches = evt.topic
      ? evaluateCondition(evt.operator, evt.value, getValue(`events[${i}].topic`, config, data))
      : !!evt.image;
    if (matches) {
      activeEvent = evt;
      if (evt.frameRangeEnabled && (evt.startFrame || evt.endFrame)) {
        activeFrameSegment = [evt.startFrame ?? 0, evt.endFrame ?? 0];
      }
      break;
    }
  }

  // When an event matches AND has its own image, that image REPLACES the default
  // (no base/overlay stacking). When the event has its own image, render it at
  // natural size anchored to the alignment corner; otherwise render the active
  // image (default or event's fallback to default) filling the container.
  const useAlignment = !!activeEvent?.image;
  const activeImage = activeEvent?.image || config.defaultImage;

  if (!activeImage) {
    return <NoConfigScreen wrapInCard={wrapInCard} aspectStyle={aspectStyle} onConfigureClick={onConfigureClick} />;
  }

  // In edit mode, suppress link redirection so dashboard editors can click the
  // widget without being navigated away. The linkConfig is preserved in the
  // envelope; only the runtime <a> wrap is skipped.
  const linkUrl =
    !editMode && config.linkConfig?.enabled && isValidLinkUrl(config.linkConfig.url)
      ? config.linkConfig.url.trim()
      : null;

  const overlayClass = useAlignment
    ? `iw-widget__overlay iw-widget__overlay--${alignmentToClass(activeEvent!.alignment)}`
    : '';

  const content = useAlignment ? (
    <div className={overlayClass}>
      <ActiveAsset src={activeImage} style={{}} frameSegment={activeFrameSegment} isOverlay />
    </div>
  ) : (
    <ActiveAsset src={activeImage} style={{}} frameSegment={activeFrameSegment} />
  );

  return (
    <div className={widgetClass} style={aspectStyle}>
      {linkUrl ? (
        <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="iw-widget__link">
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  );
}

function alignmentToClass(a: ImageEventConfig['alignment']): string {
  const v = a.startsWith('Top') ? 'top' : a.startsWith('Bottom') ? 'bottom' : 'middle';
  const h = a.endsWith('Left') ? 'left' : a.endsWith('Right') ? 'right' : 'center';
  return `${v}-${h}`;
}

function ActiveAsset({
  src,
  style,
  frameSegment,
  isOverlay = false,
}: {
  src: string;
  style: React.CSSProperties;
  frameSegment?: [number, number];
  isOverlay?: boolean;
}) {
  const lottie = useLottieAnimation(isJsonAsset(src) ? src : undefined);
  const imgClass = isOverlay ? 'iw-widget__image iw-widget__image--overlay' : 'iw-widget__image';
  const lottieClass = isOverlay ? 'iw-widget__lottie iw-widget__lottie--overlay' : 'iw-widget__lottie';

  if (isJsonAsset(src)) {
    if (lottie.status === 'ready') {
      return (
        <Lottie
          className={lottieClass}
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

  return <img className={imgClass} src={src} alt="widget" style={style} />;
}
