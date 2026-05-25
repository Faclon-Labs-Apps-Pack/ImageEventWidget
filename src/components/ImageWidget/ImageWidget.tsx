import { Settings } from 'react-feather';
import { DataEntry, WidgetEvent, ImageWidgetUIConfig, ImageRuleConfig, ImageEventConfig } from '../../iosense-sdk/types';
import './ImageWidget.css';

interface ImageWidgetProps {
  config: ImageWidgetUIConfig;
  data: DataEntry[];
  onEvent: (event: WidgetEvent) => void;
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

function evaluateRule(
  rule: ImageRuleConfig,
  resolvedValue: string | number | null,
): boolean {
  if (resolvedValue === null || resolvedValue === undefined) return false;
  const a = typeof resolvedValue === 'number' ? resolvedValue : parseFloat(String(resolvedValue));
  const b = parseFloat(rule.value);

  switch (rule.operator) {
    case '==': return String(resolvedValue) === rule.value || (!isNaN(a) && !isNaN(b) && a === b);
    case '!=': return String(resolvedValue) !== rule.value;
    case '>':  return !isNaN(a) && !isNaN(b) && a > b;
    case '<':  return !isNaN(a) && !isNaN(b) && a < b;
    case '>=': return !isNaN(a) && !isNaN(b) && a >= b;
    case '<=': return !isNaN(a) && !isNaN(b) && a <= b;
    default:   return false;
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

function NoConfigScreen() {
  return (
    <div className="iw-widget iw-widget__empty">
      <Settings size={28} style={{ color: 'var(--text-default-tertiary, #616d75)', marginBottom: 8 }} />
      <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-default-secondary, #292f32)', margin: 0 }}>
        Widget not configured
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-default-tertiary, #616d75)', margin: 0 }}>
        Open the settings panel to configure this widget.
      </p>
    </div>
  );
}

export function ImageWidget({ config, data, onEvent: _onEvent }: ImageWidgetProps) {
  // If any event or rule has a topic binding but data hasn't loaded, show skeleton
  const hasBindings = config.events.some((e) => e.topic) || config.rules.some((r) => r.topic);
  if (hasBindings && data.length === 0) {
    return (
      <div className="iw-widget iw-widget--loading">
        <div className="iw-widget__skeleton" />
      </div>
    );
  }

  // Evaluate events in order — find first matching
  let activeImage = config.defaultImage;
  let activeAlignment: 'Left' | 'Center' | 'Right' = 'Center';
  let activeWidth = '';
  let activeHeight = '';

  for (let i = 0; i < config.events.length; i++) {
    const evt = config.events[i];
    if (evt.topic) {
      const resolved = getValue(`events[${i}].topic`, config, data);
      if (evaluateCondition(evt.operator, evt.value, resolved)) {
        activeImage = evt.image || config.defaultImage;
        activeAlignment = evt.alignment;
        activeWidth = evt.width;
        activeHeight = evt.height;
        break;
      }
    } else if (!evt.topic && evt.image) {
      // No condition — always show this event (use as fallback with alignment/size)
      activeImage = evt.image;
      activeAlignment = evt.alignment;
      activeWidth = evt.width;
      activeHeight = evt.height;
      break;
    }
  }

  // If no event matched, evaluate rules (legacy rules[] support)
  if (activeImage === config.defaultImage && config.rules.length > 0) {
    for (let i = 0; i < config.rules.length; i++) {
      const rule = config.rules[i];
      const resolvedValue = getValue(`rules[${i}].topic`, config, data);
      if (evaluateRule(rule, resolvedValue)) {
        const event = config.events.find((e) => e.id === rule.eventId);
        if (event?.image) {
          activeImage = event.image;
          activeAlignment = event.alignment ?? 'Center';
          activeWidth = event.width ?? '';
          activeHeight = event.height ?? '';
          break;
        }
      }
    }
  }

  if (!activeImage) {
    return <NoConfigScreen />;
  }

  const alignmentMap: Record<'Left' | 'Center' | 'Right', string> = {
    Left: 'flex-start',
    Center: 'center',
    Right: 'flex-end',
  };

  const imageEl = (
    <img
      className="iw-widget__image"
      src={activeImage}
      alt="widget"
      style={{
        width: activeWidth ? `${activeWidth}px` : '100%',
        height: activeHeight ? `${activeHeight}px` : '100%',
        alignSelf: alignmentMap[activeAlignment],
      }}
    />
  );

  return (
    <div
      className="iw-widget"
      style={{ justifyContent: alignmentMap[activeAlignment] }}
    >
      {config.linkConfig.enabled && config.linkConfig.url ? (
        <a href={config.linkConfig.url} target="_blank" rel="noopener noreferrer" className="iw-widget__link">
          {imageEl}
        </a>
      ) : imageEl}
    </div>
  );
}
