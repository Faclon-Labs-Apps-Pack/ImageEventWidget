import { FileText } from 'react-feather';
import Lottie from 'lottie-react';
import { EmptyState } from '@faclon-labs/design-sdk/EmptyState';
import { NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/NoDataOneIllustration';
import { Button } from '@faclon-labs/design-sdk/Button';
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
  onConfigureClick,
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
          title="Set Your Default Image"
          description="Add a default image and configure events."
          primaryAction={
            <Button
              variant="Primary"
              label="Configure Widget"
              onClick={() => onConfigureClick?.()}
            />
          }
        />
      </Card>
    </div>
  );
}

export function ImageWidget({ config, data, onEvent: _onEvent, onConfigureClick }: ImageWidgetProps) {
  if (!config) return <NoConfigScreen wrapInCard onConfigureClick={onConfigureClick} />;

  const wrapInCard = config.style?.card?.wrapInCard ?? true;
  const widgetClass = `iw-widget${wrapInCard ? '' : ' iw-widget--no-wrap'}`;

  const events = config.events ?? [];

  // Evaluate events in order — find first matching
  let activeImage = config.defaultImage;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (evt.topic) {
      const resolved = getValue(`events[${i}].topic`, config, data);
      if (evaluateCondition(evt.operator, evt.value, resolved)) {
        activeImage = evt.image || config.defaultImage;
        break;
      }
    } else if (!evt.topic && evt.image) {
      activeImage = evt.image;
      break;
    }
  }

  if (!activeImage) {
    return <NoConfigScreen wrapInCard={wrapInCard} onConfigureClick={onConfigureClick} />;
  }

  const linkUrl =
    config.linkConfig?.enabled && isValidLinkUrl(config.linkConfig.url)
      ? config.linkConfig.url.trim()
      : null;

  return (
    <div className={widgetClass}>
      {linkUrl ? (
        <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="iw-widget__link">
          <ActiveAsset src={activeImage} style={{}} />
        </a>
      ) : (
        <ActiveAsset src={activeImage} style={{}} />
      )}
    </div>
  );
}

function ActiveAsset({ src, style }: { src: string; style: React.CSSProperties }) {
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
