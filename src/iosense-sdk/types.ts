export interface UNSNode {
  id: string;
  type: string;
  name?: string;
  path: string | null;
  parentId: string | null;
}

export interface SeriesSlot {
  from: number;
  to: number;
  label: string;
  value: number | null;
  quality: string;
  isPartial?: boolean;
}

export interface SeriesAggregation {
  operator: string;
  downscale: number;
  resolution: string;
}

export interface SeriesMeta {
  type: string;
  key: string;
  unit: string | null;
  dataPrecision: number | null;
  aggregation: SeriesAggregation;
  devID: string;
  sensor: string;
}

export interface SeriesPayload {
  __type: 'series';
  path: string;
  meta: SeriesMeta;
  range: { from: number; to: number };
  slots: SeriesSlot[];
}

export interface ScalarBinding { key: string; topic: string; }
export interface SeriesBinding  { key: string; topic: string; type: 'series'; }
export type BindingEntry = ScalarBinding | SeriesBinding;

export interface DataEntry {
  key: string;
  value: string | number | null | SeriesPayload;
}

export interface Duration {
  id: string;
  label?: string;
  x?: number;
  xPeriod: string; // "minute" | "hour" | "day" | "week" | "month" | "year"
}

export interface TimeConfig {
  timezone: string;
  type: 'local' | 'fixed' | string;
  startTime: number | null;
  endTime: number | null;
  defaultDurationId: string;
  allDurations: Duration[];
  defaultPeriodicity: 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly';
}

export type WidgetEvent =
  | { type: 'TIME_CHANGE'; payload: { startTime: string; endTime: string; periodicity: string } }
  | { type: 'FILTER_CHANGE'; payload: Record<string, unknown> };

// ---------------------------------------------------------------------------
// ImageWidget
// ---------------------------------------------------------------------------

export interface ImageEventConfig {
  id: string;
  label: string;
  image: string;                                        // base64 data URL
  alignment:
    | 'Top Left' | 'Top Center' | 'Top Right'
    | 'Left' | 'Center' | 'Right'
    | 'Bottom Left' | 'Bottom Center' | 'Bottom Right';
  width: number;                                        // px (0 = auto)
  height: number;                                       // px (0 = auto)
  topic: string;                                        // bindable — user stores {{uns:wsId://path}}
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
  value: string;                                        // comparison threshold
  frameRangeEnabled: boolean;                           // when true, the event is also gated by [startFrame, endFrame]
  startFrame: number;                                   // Lottie frame (0 = unset)
  endFrame: number;                                     // Lottie frame (0 = unset)
}

export interface ImageWidgetUIConfig {
  defaultImage: string;    // base64 data URL — shown when no rule matches
  linkConfig: {
    enabled: boolean;
    url: string;           // URL to navigate to when image is clicked
  };
  events: ImageEventConfig[];
  style: {
    card: { wrapInCard: boolean; bg: string };
  };
}

export interface ImageWidgetEnvelope {
  _id: string;
  type: 'ImageWidget';
  general: { title: string };
  timeConfig?: TimeConfig;
  /** Default rendered size of the widget's image, in px (0 = auto). Top-level, outside uiConfig. */
  width: number;
  height: number;
  uiConfig: ImageWidgetUIConfig;
  dynamicBindingPathList: Array<BindingEntry>;
}
