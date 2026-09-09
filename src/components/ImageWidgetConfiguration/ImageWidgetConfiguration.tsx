import { useState, useEffect, useRef } from 'react';
import {
  Lock, Unlock, X, FileText, ArrowLeft, Play, Pause, Plus,
  ArrowUpLeft, ArrowUp, ArrowUpRight, Circle, ArrowRight,
  ArrowDownLeft, ArrowDown, ArrowDownRight, MoreVertical, Download,
} from 'react-feather';
import { ListCard, ListCardTrailingItem } from '@faclon-labs/design-sdk/ListCard';
import { FileUpload, type UploadFile } from '@faclon-labs/design-sdk/UploadCta';
import { IconButton } from '@faclon-labs/design-sdk/IconButton';
import { Tooltip } from '@faclon-labs/design-sdk/Tooltip';
import { InputFieldHeader } from '@faclon-labs/design-sdk/InputFieldHeader';
import { Radio } from '@faclon-labs/design-sdk/Radio';
import { Alert } from '@faclon-labs/design-sdk/Alert';
import { Switch } from '@faclon-labs/design-sdk/Switch';
import { TextInput } from '@faclon-labs/design-sdk/TextInput';
import { SelectInput } from '@faclon-labs/design-sdk/SelectInput';
import { Divider } from '@faclon-labs/design-sdk/Divider';
import { ProductAccordionItem } from '@faclon-labs/design-sdk/ProductAccordion';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@faclon-labs/design-sdk/Modal';
import { Button } from '@faclon-labs/design-sdk/Button';
import { UNSTreePicker } from '@faclon-labs/design-sdk/UNSTreePicker';
import type { UNSNode, UNSWorkspace } from '@faclon-labs/design-sdk/UNSTreePicker';
import { DropdownMenu } from '@faclon-labs/design-sdk/DropdownMenu';
import { ActionListItem } from '@faclon-labs/design-sdk/ActionListItem';
import { useUNSTreePicker } from '../../iosense-sdk/useUNSTreePicker';
import { uploadImageToS3 } from '../../iosense-sdk/api';
import { isJsonAsset, useLottieAnimation } from '../../iosense-sdk/lottie';
import Lottie, { type LottieRefCurrentProps } from 'lottie-react';
import {
  ImageWidgetEnvelope,
  ImageWidgetUIConfig,
  ImageEventConfig,
  ImageObjectFit,
} from '../../iosense-sdk/types';
import './ImageWidgetConfiguration.css';

interface ImageWidgetConfigurationProps {
  config: ImageWidgetEnvelope | undefined;
  authentication?: string;
  onChange: (config: ImageWidgetEnvelope) => void;
  /** Optional back-button handler. When absent, the back IconButton is a no-op. */
  onBack?: () => void;
  // Host-injectable UNS picker source (all-or-none). When absent, the dev-harness
  // fallback (useUNSTreePicker) fetches via the widget's own token-backed API.
  unsWorkspaces?: UNSWorkspace[];
  isLoadingWorkspaces?: boolean;
  loadUnsChildren?: (wsId: string, parentId?: string) => Promise<UNSNode[]>;
  searchUnsNodes?: (wsId: string, query: string, limit?: number) => Promise<UNSNode[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VARIABLE_REGEX = /^\{\{(.+)\}\}$/;

type Alignment = ImageEventConfig['alignment'];

const ALIGNMENTS: Alignment[] = [
  'Top Left', 'Top Center', 'Top Right',
  'Left', 'Center', 'Right',
  'Bottom Left', 'Bottom Center', 'Bottom Right',
];

function alignmentIcon(a: Alignment) {
  const map: Record<Alignment, React.ReactNode> = {
    'Top Left': <ArrowUpLeft size={16} />,
    'Top Center': <ArrowUp size={16} />,
    'Top Right': <ArrowUpRight size={16} />,
    'Left': <ArrowLeft size={16} />,
    'Center': <Circle size={16} />,
    'Right': <ArrowRight size={16} />,
    'Bottom Left': <ArrowDownLeft size={16} />,
    'Bottom Center': <ArrowDown size={16} />,
    'Bottom Right': <ArrowDownRight size={16} />,
  };
  return map[a];
}

function buildDynamicBindingPathList(uiConfig: unknown): Array<{ key: string; topic: string }> {
  const paths: Array<{ key: string; topic: string }> = [];

  function walk(obj: unknown, currentPath: string): void {
    if (obj === null || obj === undefined) return;
    if (typeof obj === 'string') {
      const match = VARIABLE_REGEX.exec(obj.trim());
      if (match) paths.push({ key: currentPath, topic: match[1] });
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => walk(item, `${currentPath}[${index}]`));
      return;
    }
    if (typeof obj === 'object') {
      Object.entries(obj as Record<string, unknown>).forEach(([key, val]) => {
        walk(val, currentPath ? `${currentPath}.${key}` : key);
      });
    }
  }

  walk(uiConfig, '');
  return paths;
}

function buildEnvelope(
  existing: ImageWidgetEnvelope | undefined,
  uiConfig: ImageWidgetUIConfig,
  width: number,
  height: number,
): ImageWidgetEnvelope {
  return {
    _id: existing?._id ?? `iw_${Date.now()}`,
    type: 'ImageWidget',
    general: existing?.general ?? { title: '' },
    width,
    height,
    uiConfig,
    dynamicBindingPathList: buildDynamicBindingPathList(uiConfig),
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const OPERATOR_OPTIONS = ['==', '!=', '>', '<', '>=', '<=', 'within range', 'outside range'] as const;
type Operator = typeof OPERATOR_OPTIONS[number];
const RANGE_OPERATORS: readonly Operator[] = ['within range', 'outside range'];
function isRangeOperator(op: Operator): boolean {
  return RANGE_OPERATORS.includes(op);
}

/** Human-readable label used in the dropdown + selected-value display so
 *  every option is consistently text (the six math operators were showing
 *  as bare symbols, the two range operators as words — mismatched). */
function operatorLabel(op: Operator): string {
  switch (op) {
    case '==':             return 'Equals';
    case '!=':             return 'Not equals';
    case '>':              return 'Greater than';
    case '<':              return 'Less than';
    case '>=':             return 'Greater than or equal';
    case '<=':             return 'Less than or equal';
    case 'within range':   return 'Within range';
    case 'outside range':  return 'Outside range';
  }
}

/** Short glyph rendered as the leadingIcon in the operator dropdown so every
 *  option has a visual anchor (previously the six math ops showed as bare
 *  symbols and the two range ops as text — visually mismatched). */
function operatorGlyph(op: Operator): string {
  switch (op) {
    case '==':             return '=';
    case '!=':             return '≠';
    case '>':              return '>';
    case '<':              return '<';
    case '>=':             return '≥';
    case '<=':             return '≤';
    case 'within range':   return '⟨⟩';
    case 'outside range':  return '↔';
  }
}
function OperatorGlyph({ op }: { op: Operator }) {
  return <span className="iw-op-glyph" aria-hidden="true">{operatorGlyph(op)}</span>;
}
function pos(v: string): number {
  return Math.max(0, Number(v) || 0);
}

/**
 * Validates the Link Configuration URL. Mirrors the widget-renderer's
 * `normalizeLinkUrl` semantics: bare domains like "faclon.com" are treated as
 * external, so the URL parses cleanly once we prefix a protocol when absent.
 * A path-only value (starts with '/') is accepted as a same-origin SPA route.
 */
function isLinkUrlValid(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const withProtocol =
    /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')
      ? trimmed
      : trimmed.split('/')[0].includes('.')
        ? `https://${trimmed}`
        : trimmed;
  try {
    const u = new URL(withProtocol, window.location.origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // Reject "http://" with an empty host.
    return u.hostname.length > 0 || trimmed.startsWith('/');
  } catch {
    return false;
  }
}

/** Every SelectInput in this configurator shares one open-state slot, so
 *  opening a second dropdown implicitly closes the first. */
type DropdownId = 'objectFit' | 'existingAsset' | 'alignment' | 'operator';

function fileNameFromUrl(url: string): string {
  try {
    const path = url.split('?')[0].split('#')[0];
    const last = path.split('/').pop() || 'file';
    return decodeURIComponent(last);
  } catch {
    return 'file';
  }
}

function uploadFileFromUrl(url: string, sizeBytes?: number): UploadFile {
  const name = fileNameFromUrl(url);
  const file = new File([], name) as UploadFile;
  if (typeof sizeBytes === 'number' && sizeBytes > 0) {
    Object.defineProperty(file, 'size', { value: sizeBytes, configurable: true });
  }
  file.state = 'completed';
  return file;
}

function uploadFileFromNative(native: File, state: UploadFile['state'], progress?: number): UploadFile {
  const f = native as UploadFile;
  f.state = state;
  if (progress !== undefined) f.progress = progress;
  return f;
}

/**
 * Download an asset from S3.
 *
 * Strategy: try to fetch the URL as a blob and trigger a client-side download.
 * If CORS blocks the fetch (opaque response, empty blob) or any step fails,
 * fall back to opening the URL in a new tab so the user can save it manually
 * via right-click. Better than silently producing a 0-byte file.
 */
async function downloadAsset(url: string): Promise<void> {
  if (!url) return;
  const filename = fileNameFromUrl(url);
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size === 0) throw new Error('empty blob (likely CORS-blocked)');
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  } catch (err) {
    console.warn('[ImageWidget] direct download failed, opening in new tab:', err);
    // Fallback: navigate to the URL in a new tab. Browser will either display
    // the image (user right-clicks Save Image As) or trigger a download if
    // the server sends Content-Disposition: attachment.
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      // Popup was blocked — last-resort inline navigation
      window.location.href = url;
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImageWidgetConfiguration(props: ImageWidgetConfigurationProps) {
  const { config, authentication, onChange, onBack } = props;

  // -------------------------------------------------------------------------
  // UNSTreePicker source: host injects workspaces + loadChildren together;
  // when absent, fall back to the dev-harness hook. The hook is always called
  // (Rules of Hooks) but no-ops when injection is present.
  // -------------------------------------------------------------------------
  const hasInjectedUNS =
    props.unsWorkspaces !== undefined && props.loadUnsChildren !== undefined;

  const hookResult = useUNSTreePicker(hasInjectedUNS ? undefined : authentication);
  const unsWorkspaces       = hasInjectedUNS ? props.unsWorkspaces!             : hookResult.workspaces;
  const isLoadingWorkspaces = hasInjectedUNS ? (props.isLoadingWorkspaces ?? false) : hookResult.isLoadingWorkspaces;
  const loadUnsChildren     = hasInjectedUNS ? props.loadUnsChildren!           : hookResult.loadChildren;
  const searchUnsNodes      = hasInjectedUNS ? (props.searchUnsNodes ?? hookResult.searchNodes) : hookResult.searchNodes;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [defaultImage, setDefaultImage] = useState<string>(
    config?.uiConfig?.defaultImage ?? '',
  );
  const [defaultImageSize, setDefaultImageSize] = useState<number>(
    config?.uiConfig?.defaultImageSize ?? 0,
  );
  const [defaultImageFiles, setDefaultImageFiles] = useState<UploadFile[]>(
    config?.uiConfig?.defaultImage
      ? [uploadFileFromUrl(config.uiConfig.defaultImage, config.uiConfig.defaultImageSize)]
      : [],
  );
  const [defaultWidth, setDefaultWidth] = useState<number>(
    config?.width || 580,
  );
  const [defaultHeight, setDefaultHeight] = useState<number>(
    config?.height || 300,
  );
  const [defaultLockAspect, setDefaultLockAspect] = useState(true);
  const [defaultAspectRatio, setDefaultAspectRatio] = useState<number | null>(null);
  const [linkEnabled, setLinkEnabled] = useState<boolean>(
    config?.uiConfig?.linkConfig?.enabled ?? false,
  );
  const [linkUrl, setLinkUrl] = useState<string>(
    config?.uiConfig?.linkConfig?.url ?? '',
  );
  const [linkNewTab, setLinkNewTab] = useState<boolean>(
    config?.uiConfig?.linkConfig?.newTab ?? false,
  );
  const [events, setEvents] = useState<ImageEventConfig[]>(
    config?.uiConfig?.events ?? [],
  );
  const [objectFit, setObjectFit] = useState<ImageObjectFit>(
    config?.uiConfig?.style?.objectFit ?? 'fill',
  );
  // Single open-dropdown slot — opening one SelectInput closes any other.
  const [openDropdown, setOpenDropdown] = useState<DropdownId | null>(null);
  const toggleDropdown = (id: DropdownId) =>
    setOpenDropdown((cur) => (cur === id ? null : id));

  // Accordion expand state
  const [eventsExpanded, setEventsExpanded] = useState(false);

  // Drag-and-drop reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Modal positioning
  const configRef = useRef<HTMLDivElement>(null);
  const eventsAccordionRef = useRef<HTMLDivElement>(null);
  const [modalX, setModalX] = useState(0);
  const [modalY, setModalY] = useState(0);

  // Hidden file inputs used to trigger re-upload from the row icon
  const defaultFileInputRef = useRef<HTMLInputElement>(null);
  const eventFileInputRef = useRef<HTMLInputElement>(null);

  // Upload loading states
  const [isUploadingDefault, setIsUploadingDefault] = useState(false);
  const [isUploadingEventImage, setIsUploadingEventImage] = useState(false);

  // Add/Edit Event modal state
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEventName, setNewEventName] = useState('');
  const [newEventImage, setNewEventImage] = useState('');
  const [newEventImageSize, setNewEventImageSize] = useState<number>(0);
  const [newEventFiles, setNewEventFiles] = useState<UploadFile[]>([]);
  const [assetSource, setAssetSource] = useState<'Upload New' | 'Select Existing'>('Upload New');
  const [existingAssetId, setExistingAssetId] = useState<string>('');
  const [newEventAlignment, setNewEventAlignment] = useState<Alignment>('Center');
  const [newEventWidth, setNewEventWidth] = useState<number>(0);
  const [newEventHeight, setNewEventHeight] = useState<number>(0);
  const [lockAspectRatio, setLockAspectRatio] = useState(false);
  const [newEventTopic, setNewEventTopic] = useState('');
  const [newEventOperator, setNewEventOperator] = useState<Operator>('==');
  const [newEventValue2, setNewEventValue2] = useState('');
  const [newEventValue, setNewEventValue] = useState('');
  const [newEventFrameRange, setNewEventFrameRange] = useState(false);
  const [newEventStartFrame, setNewEventStartFrame] = useState<number>(0);
  const [newEventEndFrame, setNewEventEndFrame] = useState<number>(0);

  // Aspect-ratio cache (captured on upload, used while lock is engaged)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  // Default-image preview modal
  const [defaultPreviewOpen, setDefaultPreviewOpen] = useState(false);

  // Event-asset preview modal
  const [eventPreviewOpen, setEventPreviewOpen] = useState(false);

  // -------------------------------------------------------------------------
  // Sync state from existing config on mount / config change
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (config) {
      const di = config.uiConfig?.defaultImage ?? '';
      const ds = config.uiConfig?.defaultImageSize ?? 0;
      setDefaultImage(di);
      setDefaultImageSize(ds);
      setDefaultImageFiles(di ? [uploadFileFromUrl(di, ds)] : []);
      const dw = config.width || 580;
      const dh = config.height || 300;
      setDefaultWidth(dw);
      setDefaultHeight(dh);
      setDefaultAspectRatio(dw > 0 && dh > 0 ? dw / dh : null);
      setLinkEnabled(config.uiConfig?.linkConfig?.enabled ?? false);
      setLinkUrl(config.uiConfig?.linkConfig?.url ?? '');
      setLinkNewTab(config.uiConfig?.linkConfig?.newTab ?? false);
      setEvents(config.uiConfig?.events ?? []);
      setObjectFit(config.uiConfig?.style?.objectFit ?? 'fill');
    }
  }, [config?._id]);


  // -------------------------------------------------------------------------
  // Emit helpers
  // -------------------------------------------------------------------------
  // Latest-state ref, mirrored after every render. `emit()` reads from this
  // instead of closure so that async callbacks (e.g. S3 upload completion)
  // don't overwrite fields the user changed while the upload was in flight.
  // -------------------------------------------------------------------------
  const latestStateRef = useRef({
    defaultImage,
    defaultImageSize,
    defaultWidth,
    defaultHeight,
    linkEnabled,
    linkUrl,
    linkNewTab,
    events,
    objectFit,
  });
  useEffect(() => {
    latestStateRef.current = {
      defaultImage,
      defaultImageSize,
      defaultWidth,
      defaultHeight,
      linkEnabled,
      linkUrl,
      linkNewTab,
      events,
      objectFit,
    };
  });
  // Mirror the incoming `config` prop into a ref so `emit()` can source the
  // envelope's current width/height from whatever the host most recently
  // handed us (updated when the user drags to resize the cell) instead of
  // from our own captured-at-upload state. Prevents "changing Image Fit
  // resets the cell to natural image size" by never overwriting the host's
  // authoritative dimensions on non-upload config changes.
  const envelopePropRef = useRef(config);
  useEffect(() => {
    envelopePropRef.current = config;
  });

  function emit(overrides?: Partial<{
    defaultImage: string;
    defaultImageSize: number;
    defaultWidth: number;
    defaultHeight: number;
    linkEnabled: boolean;
    linkUrl: string;
    linkNewTab: boolean;
    events: ImageEventConfig[];
    objectFit: ImageObjectFit;
  }>) {
    const s = latestStateRef.current;
    const c = envelopePropRef.current;
    const resolved = {
      defaultImage:     overrides?.defaultImage     ?? s.defaultImage,
      defaultImageSize: overrides?.defaultImageSize ?? s.defaultImageSize,
      // Prefer whatever dimensions the host currently has (config prop);
      // fall back to our local state only if the host hasn't set them yet.
      // Overrides (image upload) always win.
      defaultWidth:     overrides?.defaultWidth     ?? c?.width  ?? s.defaultWidth,
      defaultHeight:    overrides?.defaultHeight    ?? c?.height ?? s.defaultHeight,
      linkEnabled:      overrides?.linkEnabled      ?? s.linkEnabled,
      linkUrl:          overrides?.linkUrl          ?? s.linkUrl,
      linkNewTab:       overrides?.linkNewTab       ?? s.linkNewTab,
      events:           overrides?.events           ?? s.events,
      objectFit:        overrides?.objectFit        ?? s.objectFit,
    };

    const uiConfig: ImageWidgetUIConfig = {
      defaultImage:     resolved.defaultImage,
      defaultImageSize: resolved.defaultImageSize,
      linkConfig: {
        enabled: resolved.linkEnabled,
        url: resolved.linkUrl,
        newTab: resolved.linkNewTab,
      },
      events: resolved.events,
      style: {
        card: {
          wrapInCard: config?.uiConfig?.style?.card?.wrapInCard ?? false,
          bg: config?.uiConfig?.style?.card?.bg ?? '',
        },
        objectFit: resolved.objectFit,
      },
    };

    const envelope = buildEnvelope(config, uiConfig, resolved.defaultWidth, resolved.defaultHeight);
    console.log('[ImageWidgetConfiguration] envelope:', envelope);
    onChange(envelope);
  }

  // -------------------------------------------------------------------------
  // Modal handlers — Add Event
  // -------------------------------------------------------------------------
  function computeAnchorFromRef(
    ref: { current: HTMLElement | null },
    estHeight = 560,
  ) {
    const headerEl = ref.current?.querySelector('.fds-pa-item__header') ?? ref.current;
    const anchorRect = headerEl?.getBoundingClientRect();
    const panelEl = configRef.current?.closest('.app__config') ?? configRef.current;
    const panelRect = panelEl?.getBoundingClientRect();
    const margin = 16;
    const vh = window.innerHeight;
    const x = (panelRect?.right ?? 0) + 20;
    let y = anchorRect?.top ?? margin;
    if (y + estHeight + margin > vh) {
      y = Math.max(margin, vh - estHeight - margin);
    }
    if (y < margin) y = margin;
    setModalX(x);
    setModalY(y);
    document.documentElement.style.setProperty('--iw-anchor-y', `${y}px`);
  }

  function openAddEventModal(e: React.MouseEvent) {
    e.stopPropagation();
    computeAnchorFromRef(eventsAccordionRef, 560);
    setIsAddEventOpen(true);
  }

  function handleCloseAddEvent() {
    setIsAddEventOpen(false);
    setEditingEventId(null);
    setNewEventName('');
    setNewEventImage('');
    setNewEventImageSize(0);
    setNewEventFiles([]);
    setAssetSource('Upload New');
    setExistingAssetId('');
    setOpenDropdown(null);
    setNewEventAlignment('Center');
    setNewEventWidth(0);
    setNewEventHeight(0);
    setLockAspectRatio(false);
    setAspectRatio(null);
    setNewEventTopic('');
    setNewEventOperator('==');
    setNewEventValue('');
    setNewEventValue2('');
    setNewEventFrameRange(false);
    setNewEventStartFrame(0);
    setNewEventEndFrame(0);
  }

  function openEditEventModal(evt: ImageEventConfig, e: React.MouseEvent) {
    e.stopPropagation();
    computeAnchorFromRef(eventsAccordionRef, 560);
    setEditingEventId(evt.id);
    setNewEventName(evt.label);
    setNewEventImage(evt.image);
    setNewEventImageSize(evt.imageSize ?? 0);
    setNewEventFiles(evt.image ? [uploadFileFromUrl(evt.image, evt.imageSize)] : []);
    setAssetSource('Upload New');
    setExistingAssetId('');
    setNewEventAlignment(evt.alignment);
    setNewEventWidth(evt.width);
    setNewEventHeight(evt.height);
    setAspectRatio(evt.width > 0 && evt.height > 0 ? evt.width / evt.height : null);
    setLockAspectRatio(true);
    setNewEventTopic(evt.topic);
    setNewEventOperator(evt.operator);
    setNewEventValue(evt.value);
    setNewEventValue2(evt.value2 ?? '');
    setNewEventFrameRange(evt.frameRangeEnabled ?? false);
    setNewEventStartFrame(evt.startFrame ?? 0);
    setNewEventEndFrame(evt.endFrame ?? 0);
    setIsAddEventOpen(true);
  }

  function handleSubmitEvent() {
    if (!canSubmit) return;
    let updated: ImageEventConfig[];
    const isRange = isRangeOperator(newEventOperator);
    if (editingEventId) {
      const isLottie = isJsonAsset(newEventImage);
      updated = events.map((e) =>
        e.id === editingEventId
          ? {
              ...e,
              label: newEventName.trim(),
              image: newEventImage,
              imageSize: newEventImageSize,
              alignment: newEventAlignment,
              width: 0,
              height: 0,
              topic: newEventTopic,
              operator: newEventOperator,
              value: newEventValue,
              value2: isRange ? newEventValue2 : undefined,
              frameRangeEnabled: isLottie ? newEventFrameRange : false,
              startFrame: isLottie ? newEventStartFrame : 0,
              endFrame: isLottie ? newEventEndFrame : 0,
            }
          : e,
      );
    } else {
      const isLottie = isJsonAsset(newEventImage);
      const newEvent: ImageEventConfig = {
        id: `evt_${Date.now()}`,
        label: newEventName.trim(),
        image: newEventImage,
        imageSize: newEventImageSize,
        alignment: newEventAlignment,
        width: 0,
        height: 0,
        topic: newEventTopic,
        operator: newEventOperator,
        value: newEventValue,
        value2: isRange ? newEventValue2 : undefined,
        frameRangeEnabled: isLottie ? newEventFrameRange : false,
        startFrame: isLottie ? newEventStartFrame : 0,
        endFrame: isLottie ? newEventEndFrame : 0,
      };
      updated = [...events, newEvent];
    }
    setEvents(updated);
    emit({ events: updated });
    setEventsExpanded(true);
    handleCloseAddEvent();
  }

  // -------------------------------------------------------------------------
  // Upload handlers — shared by initial select + reupload re-trigger
  // -------------------------------------------------------------------------
  async function processDefaultImageFile(file: File) {
    if (!authentication) return;
    // Do NOT capture / emit natural image dimensions. The widget stays at
    // whatever size the host cell currently is (default or user-resized),
    // and the selected Image Fit determines how the image displays inside.
    // This keeps upload consistent with Fit clicks — neither resizes the widget.
    setDefaultImageFiles([uploadFileFromNative(file, 'loading', 0)]);
    setIsUploadingDefault(true);
    try {
      const publicUrl = await uploadImageToS3(authentication, file);
      setDefaultImage(publicUrl);
      setDefaultImageSize(file.size);
      setDefaultImageFiles([uploadFileFromNative(file, 'completed')]);
      emit({
        defaultImage: publicUrl,
        defaultImageSize: file.size,
      });
    } catch (err) {
      console.error('[ImageWidget] default image upload failed:', err);
      setDefaultImageFiles([uploadFileFromNative(file, 'failed')]);
    } finally {
      setIsUploadingDefault(false);
    }
  }

  async function processEventImageFile(file: File) {
    if (!authentication) return;
    setNewEventFiles([uploadFileFromNative(file, 'loading', 0)]);
    setIsUploadingEventImage(true);
    try {
      const publicUrl = await uploadImageToS3(authentication, file);
      setNewEventImage(publicUrl);
      setNewEventImageSize(file.size);
      setNewEventFiles([uploadFileFromNative(file, 'completed')]);
    } catch (err) {
      console.error('[ImageWidget] event image upload failed:', err);
      setNewEventFiles([uploadFileFromNative(file, 'failed')]);
    } finally {
      setIsUploadingEventImage(false);
    }
  }

  // -------------------------------------------------------------------------
  // Reorder helper — moves event from `from` index to `to` index (priority change)
  // -------------------------------------------------------------------------
  function reorderEvents(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= events.length || to >= events.length) return;
    const next = events.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setEvents(next);
    emit({ events: next });
  }

  // -------------------------------------------------------------------------
  // Delete helpers
  // -------------------------------------------------------------------------
  function deleteEvent(id: string) {
    const updated = events.filter((e) => e.id !== id);
    setEvents(updated);
    emit({ events: updated });
  }

  // -------------------------------------------------------------------------
  // Derived flags
  // -------------------------------------------------------------------------
  const hasImage = defaultImage.length > 0;
  const hasEvents = events.length > 0;

  // Existing assets are prior events (other than the one being edited) that uploaded an image.
  // Dedupe by image URL so the same asset isn't listed twice.
  const existingAssets = (() => {
    const seen = new Set<string>();
    return events
      .filter((e) => e.id !== editingEventId && e.image)
      .filter((e) => {
        if (seen.has(e.image)) return false;
        seen.add(e.image);
        return true;
      });
  })();
  const hasExistingAssets = existingAssets.length > 0;

  // Unique-name check: case-insensitive, ignores whitespace, and excludes the
  // event currently being edited (so you can Save without renaming it).
  const trimmedName = newEventName.trim().toLowerCase();
  const isDuplicateName =
    trimmedName.length > 0 &&
    events.some((e) => e.id !== editingEventId && e.label.trim().toLowerCase() === trimmedName);

  // Numeric-only operators (everything except `==`) require the value to be a
  // valid number. Range operators need both bounds to be numeric.
  const valueRequiresNumber = newEventOperator !== '==';
  const isNum = (v: string) => v.trim().length > 0 && Number.isFinite(Number(v));
  const valueIsValid = valueRequiresNumber ? isNum(newEventValue) : newEventValue.trim().length > 0;
  const value2IsValid = !isRangeOperator(newEventOperator) || isNum(newEventValue2);

  const canSubmit =
    newEventName.trim().length > 0 &&
    !isDuplicateName &&
    newEventTopic.trim().length > 0 &&
    valueIsValid &&
    value2IsValid &&
    newEventImage.length > 0;

  // Frame-range overlap detection — non-blocking warning.
  // Source: prior events (excluding the one being edited) with frameRangeEnabled.
  const existingFrameRanges = events
    .filter((e) => e.id !== editingEventId && e.frameRangeEnabled)
    .map((e) => ({ start: e.startFrame || 0, end: e.endFrame || 0 }));

  const hasFrameOverlap = (() => {
    if (!newEventFrameRange) return false;
    const s = newEventStartFrame || 0;
    const f = newEventEndFrame || 0;
    if (s === 0 && f === 0) return false;
    return existingFrameRanges.some((r) => !(f < r.start || s > r.end));
  })();


  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="iw-config" ref={configRef}>
      {/* Header */}
      <div className="iw-config__header">
        <Tooltip bodyText="Close" placement="Bottom">
          <IconButton
            className="iw-config__back-btn"
            icon={<ArrowLeft size={16} />}
            size="Medium"
            accessibilityLabel="Close"
            onClick={() => onBack?.()}
          />
        </Tooltip>
        <span className="iw-config__title LabelLargeSemibold">Image Config</span>
      </div>

      <Divider />

      {/* Default Mode section */}
      <div className="iw-config__section">
        <div className="iw-config__upload-section">
          <FileUpload
            label="Default Image Config"
            helpText="Supports PNG, JPG, SVG, and JSON files."
            uploadType="single"
            accept=".png,.jpg,.jpeg,.svg,.json,image/*,application/json"
            files={defaultImageFiles}
            isDisabled={isUploadingDefault}
            disableBuiltInPreview
            onPreview={() => setDefaultPreviewOpen(true)}
            onReupload={() => defaultFileInputRef.current?.click()}
            onFilesSelect={(files: FileList) => {
              if (!files || files.length === 0) return;
              processDefaultImageFile(files[0]);
            }}
            onRemove={() => {
              setDefaultImage('');
              setDefaultImageSize(0);
              setDefaultImageFiles([]);
              emit({ defaultImage: '', defaultImageSize: 0 });
            }}
          />
          <input
            ref={defaultFileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.svg,.json,image/*,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) processDefaultImageFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <div
          className={`iw-config__switch-row${hasImage ? '' : ' iw-config__switch-row--disabled'}`}
        >
          <InputFieldHeader label="Link Configuration" />
          <Switch
            accessibilityLabel="Link Configuration"
            isChecked={linkEnabled}
            isDisabled={!hasImage}
            onChange={({ isChecked }: { isChecked: boolean }) => {
              setLinkEnabled(isChecked);
              if (!isChecked) {
                // Reset link fields when the toggle is turned off so a stale URL /
                // new-tab preference doesn't linger in the envelope (and doesn't
                // reappear as pre-filled if the user re-enables the toggle later).
                setLinkUrl('');
                setLinkNewTab(false);
                emit({ linkEnabled: false, linkUrl: '', linkNewTab: false });
              } else {
                emit({ linkEnabled: true });
              }
            }}
          />
        </div>

        {hasImage && linkEnabled && (() => {
          const trimmed = linkUrl.trim();
          const urlIsEmpty = trimmed.length === 0;
          const urlIsInvalid = !urlIsEmpty && !isLinkUrlValid(trimmed);
          const errorText = urlIsEmpty
            ? 'URL is required'
            : urlIsInvalid
              ? 'Enter a valid URL (e.g. https://example.com)'
              : undefined;
          return (
            <TextInput
              label="URL"
              type="url"
              necessityIndicator="required"
              placeholder="https://example.com"
              value={linkUrl}
              validationState={errorText ? 'error' : 'none'}
              errorText={errorText}
              onChange={({ value }: { value: string }) => {
                setLinkUrl(value);
                emit({ linkUrl: value });
              }}
            />
          );
        })()}

        {hasImage && linkEnabled && (
          <div className="iw-config__switch-row">
            <InputFieldHeader label="Open in new tab" />
            <Switch
              accessibilityLabel="Open in new tab"
              isChecked={linkNewTab}
              onChange={({ isChecked }: { isChecked: boolean }) => {
                setLinkNewTab(isChecked);
                emit({ linkNewTab: isChecked });
              }}
            />
          </div>
        )}

        {hasImage && (
          <div className="iw-config__form-group">
            <InputFieldHeader label="Image Fit" />
            <SelectInput
              label=""
              value={objectFit.charAt(0).toUpperCase() + objectFit.slice(1)}
              helpText="Fill stretches to fill (may distort). Cover fills without distortion (may crop). Contain fits inside (may show empty space)."
              onClick={() => toggleDropdown('objectFit')}
              isOpen={openDropdown === 'objectFit'}
            >
              <DropdownMenu>
                {(['fill', 'cover', 'contain'] as const).map((opt) => (
                  <ActionListItem
                    key={opt}
                    contentType="Item"
                    selectionType="Single"
                    title={opt.charAt(0).toUpperCase() + opt.slice(1)}
                    isSelected={objectFit === opt}
                    onClick={() => {
                      setObjectFit(opt);
                      setOpenDropdown(null);
                      emit({ objectFit: opt });
                    }}
                  />
                ))}
              </DropdownMenu>
            </SelectInput>
          </div>
        )}
      </div>

      <Divider />

      {/* Event Configuration accordion */}
      <div className="iw-config__accordion-section" ref={eventsAccordionRef}>
        <ProductAccordionItem
          title={events.length > 0 ? `Event Configuration (${events.length})` : 'Event Configuration'}
          isDisabled={!hasImage}
          isActive={hasEvents}
          isExpanded={hasEvents && eventsExpanded}
          onToggle={() => setEventsExpanded((v) => !v)}
          headerAction={
            <Tooltip bodyText="Add event" placement="Bottom">
              <IconButton
                className="iw-config__add-btn"
                icon={<Plus size={16} aria-hidden="true" />}
                size="Medium"
                accessibilityLabel="Add event"
                isDisabled={!hasImage}
                onClick={(e: React.MouseEvent) => {
                  if (!hasImage) return;
                  openAddEventModal(e);
                }}
              />
            </Tooltip>
          }
        >
          {events.length === 0 ? (
            <p className="iw-config__empty-hint">No events added yet.</p>
          ) : (
            <div className="iw-config__event-list">
              {events.map((evt, index) => {
                const isEvtRange = evt.operator === 'within range' || evt.operator === 'outside range';
                const opLabel = operatorLabel(evt.operator as Operator);
                const subtitle = evt.frameRangeEnabled
                  ? `Frame Range : ${evt.startFrame || 0}-${evt.endFrame || 0}`
                  : isEvtRange
                    ? `${opLabel} ${evt.value} – ${evt.value2 ?? ''}`.trim()
                    : `${opLabel} ${evt.value}`.trim();
                const isDragging = dragIndex === index;
                const isDragOver = dragOverIndex === index && dragIndex !== index;
                const rowClass = [
                  'iw-config__event-row',
                  isDragging ? 'iw-config__event-row--dragging' : '',
                  isDragOver ? 'iw-config__event-row--drag-over' : '',
                ].filter(Boolean).join(' ');
                return (
                  <div
                    key={evt.id}
                    className={rowClass}
                    draggable
                    onDragStart={(e: React.DragEvent) => {
                      setDragIndex(index);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e: React.DragEvent) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverIndex !== index) setDragOverIndex(index);
                    }}
                    onDragLeave={() => {
                      if (dragOverIndex === index) setDragOverIndex(null);
                    }}
                    onDrop={(e: React.DragEvent) => {
                      e.preventDefault();
                      if (dragIndex !== null) reorderEvents(dragIndex, index);
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                  >
                    <Tooltip bodyText="Drag to reorder priority" placement="Right">
                      <span
                        className="iw-config__event-grip"
                        aria-hidden="true"
                      >
                        <MoreVertical size={14} />
                        <MoreVertical size={14} />
                      </span>
                    </Tooltip>
                    <ListCard
                      title={evt.label}
                      subtitle={subtitle}
                      onClick={(e: React.MouseEvent) => openEditEventModal(evt, e)}
                      trailingItems={
                        <ListCardTrailingItem trailing="Slot">
                          <Tooltip bodyText="Delete event" placement="Bottom">
                            <IconButton
                              icon={<X size={16} aria-hidden="true" />}
                              size="Medium"
                              accessibilityLabel={`Delete event ${evt.label}`}
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                deleteEvent(evt.id);
                              }}
                            />
                          </Tooltip>
                        </ListCardTrailingItem>
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </ProductAccordionItem>
      </div>

      {/* Add Event Modal */}
      <Modal
        {...({ transparent: true } as any)}
        isOpen={isAddEventOpen}
        positionX={modalX}
        positionY={modalY}
        hasBodyPadding={false}
        className="iw-event-modal"
        onClose={handleCloseAddEvent}
        header={<ModalHeader title={editingEventId ? 'Edit Event' : 'Create Event'} onClose={handleCloseAddEvent} />}
        footer={
          <ModalFooter
            stacking="Vertical"
            primaryAction={
              <Button
                variant="Primary"
                size="Medium"
                label={editingEventId ? 'Save Event' : 'Add Event'}
                isFullWidth
                isDisabled={!canSubmit}
                onClick={handleSubmitEvent}
              />
            }
          />
        }
      >
        <ModalBody>
          <div className="iw-event-modal__body">
            {/* 1. Event name — must be unique across events (case/whitespace insensitive) */}
            <TextInput
              label="Event name"
              necessityIndicator="required"
              size="Medium"
              placeholder="e.g. Machine Running"
              value={newEventName}
              validationState={isDuplicateName ? 'error' : 'none'}
              errorText={isDuplicateName ? 'An event with this name already exists' : undefined}
              onChange={({ value }: { value: string }) => setNewEventName(value)}
            />

            {/* 2. Asset source radio — only when there are prior events with uploaded assets */}
            {hasExistingAssets && (
              <div className="iw-config__form-group">
                <InputFieldHeader label="Asset" size="Medium" />
                <div className="iw-event-modal__radio-row">
                  <Radio
                    label="Upload New"
                    name="iw-evt-asset-source"
                    size="Medium"
                    checked={assetSource === 'Upload New'}
                    onChange={() => {
                      setAssetSource('Upload New');
                      setExistingAssetId('');
                      setNewEventImage('');
                      setNewEventImageSize(0);
                    }}
                  />
                  <Radio
                    label="Select Existing"
                    name="iw-evt-asset-source"
                    size="Medium"
                    checked={assetSource === 'Select Existing'}
                    onChange={() => {
                      setAssetSource('Select Existing');
                      setNewEventFiles([]);
                      setNewEventImage('');
                      setNewEventImageSize(0);
                    }}
                  />
                </div>
              </div>
            )}

            {/* 2b. Existing-asset picker (Select Existing mode) */}
            {hasExistingAssets && assetSource === 'Select Existing' && (
              <SelectInput
                label=""
                placeholder="e.g. Running Animation"
                value={existingAssets.find((e) => e.id === existingAssetId)?.label ?? ''}
                onClick={() => toggleDropdown('existingAsset')}
                isOpen={openDropdown === 'existingAsset'}
              >
                <DropdownMenu>
                  {existingAssets.map((a) => (
                    <ActionListItem
                      key={a.id}
                      contentType="Item"
                      selectionType="Single"
                      title={a.label}
                      isSelected={existingAssetId === a.id}
                      onClick={() => {
                        setExistingAssetId(a.id);
                        setNewEventImage(a.image);
                        setNewEventImageSize(a.imageSize ?? 0);
                        setNewEventWidth(a.width);
                        setNewEventHeight(a.height);
                        setAspectRatio(a.width > 0 && a.height > 0 ? a.width / a.height : null);
                        setOpenDropdown(null);
                      }}
                    />
                  ))}
                </DropdownMenu>
              </SelectInput>
            )}

            {/* 2c. Upload Asset (Upload New mode, or first event) */}
            {(!hasExistingAssets || assetSource === 'Upload New') && (
            <FileUpload
              label={hasExistingAssets ? undefined : 'Upload Asset'}
              helpText="Supports PNG, JPG, SVG, and JSON files."
              uploadType="single"
              accept=".png,.jpg,.jpeg,.svg,.json,image/*,application/json"
              files={newEventFiles}
              isDisabled={isUploadingEventImage}
              disableBuiltInPreview
              onPreview={() => setEventPreviewOpen(true)}
              onReupload={() => eventFileInputRef.current?.click()}
              onFilesSelect={(files: FileList) => {
                if (!files || files.length === 0) return;
                processEventImageFile(files[0]);
              }}
              onRemove={() => {
                setNewEventImage('');
                setNewEventImageSize(0);
                setNewEventFiles([]);
              }}
            />
            )}
            <input
              ref={eventFileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.svg,.json,image/*,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processEventImageFile(f);
                e.target.value = '';
              }}
            />

            {/* 3. Alignment */}
            <div className="iw-config__form-group">
              <InputFieldHeader label="Alignment" size="Medium" necessityIndicator="required" />
              <SelectInput
                label=""
                value={newEventAlignment}
                leadingIcon={alignmentIcon(newEventAlignment)}
                onClick={() => toggleDropdown('alignment')}
                isOpen={openDropdown === 'alignment'}
              >
                <DropdownMenu>
                  {ALIGNMENTS.map((opt) => (
                    <ActionListItem
                      key={opt}
                      contentType="Item"
                      selectionType="Single"
                      title={opt}
                      leadingIcon={alignmentIcon(opt)}
                      isSelected={newEventAlignment === opt}
                      onClick={() => { setNewEventAlignment(opt); setOpenDropdown(null); }}
                    />
                  ))}
                </DropdownMenu>
              </SelectInput>
            </div>

            {/* 5. UNS Path */}
            <div className="iw-config__form-group">
              <InputFieldHeader label="UNS Path" size="Medium" necessityIndicator="required" />
              <UNSTreePicker
                label=""
                placeholder="e.g. Plant1/Line2/Motor/status"
                value={newEventTopic}
                workspaces={unsWorkspaces}
                isLoadingWorkspaces={isLoadingWorkspaces}
                loadChildren={loadUnsChildren}
                searchNodes={searchUnsNodes}
                onChange={(value: string) => setNewEventTopic(value)}
              />
            </div>

            {/* 6. Condition header */}
            <p className="iw-event-modal__section-title">Condition</p>

            {/* 7. Operator */}
            <div className="iw-config__form-group">
              <InputFieldHeader label="Operator" size="Medium" necessityIndicator="required" />
              <SelectInput
                label=""
                value={operatorLabel(newEventOperator)}
                leadingIcon={<OperatorGlyph op={newEventOperator} />}
                onClick={() => toggleDropdown('operator')}
                isOpen={openDropdown === 'operator'}
              >
                <DropdownMenu>
                  {OPERATOR_OPTIONS.map((op) => (
                    <ActionListItem
                      key={op}
                      title={operatorLabel(op)}
                      leadingIcon={<OperatorGlyph op={op} />}
                      isSelected={newEventOperator === op}
                      onClick={() => {
                        setNewEventOperator(op);
                        setOpenDropdown(null);
                        // Clear the high bound when switching away from a range operator
                        if (!isRangeOperator(op)) setNewEventValue2('');
                      }}
                    />
                  ))}
                </DropdownMenu>
              </SelectInput>
            </div>

            {/* 8. Value(s) — string values (e.g. "N/A") are only allowed with `==`.
                Every other operator (!=, ordering, range) accepts numbers only. */}
            {isRangeOperator(newEventOperator) ? (
              <div className="iw-event-modal__frame-row">
                <TextInput
                  label="Min Value"
                  necessityIndicator="required"
                  size="Medium"
                  type="number"
                  placeholder="e.g. 10"
                  value={newEventValue}
                  onChange={({ value }: { value: string }) => setNewEventValue(value)}
                />
                <TextInput
                  label="Max Value"
                  necessityIndicator="required"
                  size="Medium"
                  type="number"
                  placeholder="e.g. 100"
                  value={newEventValue2}
                  onChange={({ value }: { value: string }) => setNewEventValue2(value)}
                />
              </div>
            ) : (
              (() => {
                const allowStrings = newEventOperator === '==';
                const trimmed = newEventValue.trim();
                // Numeric-only operators show an error if the current value is not a valid number.
                const isNonNumeric = !allowStrings && trimmed.length > 0 && !Number.isFinite(Number(trimmed));
                return (
                  <TextInput
                    label="Value"
                    necessityIndicator="required"
                    size="Medium"
                    type={allowStrings ? 'text' : 'number'}
                    placeholder={allowStrings ? 'e.g. 50 or N/A' : 'e.g. 50'}
                    value={newEventValue}
                    validationState={isNonNumeric ? 'error' : 'none'}
                    errorText={isNonNumeric ? 'This operator only accepts numeric values' : undefined}
                    onChange={({ value }: { value: string }) => setNewEventValue(value)}
                  />
                );
              })()
            )}

            {/* 9–11. Frame Range — only for Lottie (.json) assets */}
            {isJsonAsset(newEventImage) && (
              <>
                <div className="iw-event-modal__toggle-row">
                  <span className="iw-event-modal__toggle-label">Frame Range</span>
                  <Switch
                    accessibilityLabel="Frame Range"
                    isChecked={newEventFrameRange}
                    onChange={({ isChecked }: { isChecked: boolean }) => setNewEventFrameRange(isChecked)}
                  />
                </div>

                {newEventFrameRange && (
                  <div className="iw-event-modal__frame-row">
                    <TextInput
                      label="Start Frame"
                      size="Medium"
                      type="number"
                      min={0}
                      placeholder="e.g. 0"
                      value={newEventStartFrame > 0 ? String(newEventStartFrame) : ''}
                      onChange={({ value }: { value: string }) => setNewEventStartFrame(pos(value))}
                    />
                    <TextInput
                      label="End Frame"
                      size="Medium"
                      type="number"
                      min={0}
                      placeholder="e.g. 120"
                      value={newEventEndFrame > 0 ? String(newEventEndFrame) : ''}
                      onChange={({ value }: { value: string }) => setNewEventEndFrame(pos(value))}
                    />
                  </div>
                )}

                {hasFrameOverlap && (
                  <Alert
                    color="Notice"
                    emphasis="Subtle"
                    isFullWidth
                    title="Overlapping Frame Range"
                    description="This frame range is already in use. Overlapping ranges may cause unpredictable behavior. Adjust the frame range to avoid conflicts."
                  />
                )}
              </>
            )}
          </div>
        </ModalBody>
      </Modal>

      {/* Default-image preview modal */}
      <Modal
        isOpen={defaultPreviewOpen}
        className="iw-preview-modal"
        onClose={() => setDefaultPreviewOpen(false)}
        header={
          <ModalHeader
            title={fileNameFromUrl(defaultImage) || 'Preview'}
            onClose={() => setDefaultPreviewOpen(false)}
          />
        }
        footer={
          <ModalFooter
            primaryAction={
              <Button
                variant="Primary"
                size="Medium"
                label="Download"
                leadingIcon={<Download size={16} />}
                onClick={() => downloadAsset(defaultImage)}
                isDisabled={!defaultImage}
              />
            }
          />
        }
      >
        <ModalBody>
          <AssetPreview src={defaultImage} />
        </ModalBody>
      </Modal>

      {/* Event-asset preview modal */}
      <Modal
        isOpen={eventPreviewOpen}
        className="iw-preview-modal"
        onClose={() => setEventPreviewOpen(false)}
        header={
          <ModalHeader
            title={fileNameFromUrl(newEventImage) || 'Preview'}
            onClose={() => setEventPreviewOpen(false)}
          />
        }
        footer={
          <ModalFooter
            primaryAction={
              <Button
                variant="Primary"
                size="Medium"
                label="Download"
                leadingIcon={<Download size={16} />}
                onClick={() => downloadAsset(newEventImage)}
                isDisabled={!newEventImage}
              />
            }
          />
        }
      >
        <ModalBody>
          <AssetPreview src={newEventImage} />
        </ModalBody>
      </Modal>
    </div>
  );
}

function AssetPreview({ src }: { src: string }) {
  const lottie = useLottieAnimation(isJsonAsset(src) ? src : undefined);
  if (!src) return null;
  if (isJsonAsset(src)) {
    if (lottie.status === 'ready') {
      return <LottiePlayer animationData={lottie.data} />;
    }
    if (lottie.status === 'loading') {
      return <div className="iw-preview-modal__placeholder">Loading…</div>;
    }
    return <div className="iw-preview-modal__placeholder">Cannot preview this file.</div>;
  }
  return <img className="iw-preview-modal__image" src={src} alt="preview" />;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function LottiePlayer({ animationData }: { animationData: object }) {
  const lottieRef = useRef<LottieRefCurrentProps>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);

  // Bodymovin/Lottie JSON exposes these at the top level — read them directly
  // so the progress bar + counter work before the animation DOM is mounted.
  const meta = animationData as { ip?: number; op?: number; fr?: number };
  const totalFrames = Math.max(0, Math.round((meta.op ?? 0) - (meta.ip ?? 0)));
  const frameRate = meta.fr ?? 0;

  // Reset frame state when a different animation is loaded
  useEffect(() => {
    setCurrentFrame(0);
    setIsPlaying(true);
  }, [animationData]);

  function handleEnterFrame() {
    const item = lottieRef.current?.animationItem;
    if (item) setCurrentFrame(item.currentFrame);
  }

  function handleLoopComplete() {
    setCurrentFrame(0);
  }

  function togglePlay() {
    const ref = lottieRef.current;
    if (!ref) return;
    if (isPlaying) {
      ref.pause();
      setIsPlaying(false);
    } else {
      ref.play();
      setIsPlaying(true);
    }
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const frame = Number(e.target.value);
    const ref = lottieRef.current;
    if (!ref) return;
    ref.goToAndStop(frame, true);
    setCurrentFrame(frame);
    setIsPlaying(false);
  }

  const totalSeconds = frameRate > 0 ? totalFrames / frameRate : 0;
  const isAtLastFrame = totalFrames > 0 && currentFrame >= totalFrames - 1;
  const currentSeconds = frameRate > 0
    ? (isAtLastFrame ? totalSeconds : currentFrame / frameRate)
    : 0;
  const displayFrame = totalFrames > 0
    ? Math.min(Math.floor(currentFrame) + 1, totalFrames)
    : 0;

  return (
    <div className="iw-preview-modal__player">
      <Lottie
        className="iw-preview-modal__lottie"
        lottieRef={lottieRef}
        animationData={animationData}
        loop
        autoplay
        onEnterFrame={handleEnterFrame}
        onLoopComplete={handleLoopComplete}
      />
      <div className="iw-preview-modal__controls">
        <Tooltip bodyText={isPlaying ? 'Pause' : 'Play'} placement="Top">
          <IconButton
            icon={
              isPlaying
                ? <Pause size={16} aria-hidden="true" />
                : <Play size={16} aria-hidden="true" />
            }
            size="Medium"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            onClick={togglePlay}
          />
        </Tooltip>
        <input
          type="range"
          className="iw-preview-modal__scrubber"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          step={0.01}
          value={currentFrame}
          onChange={handleScrub}
          aria-label="Animation progress"
        />
        <span className="iw-preview-modal__time">
          {formatTime(currentSeconds)} / {formatTime(totalSeconds)}
          <span className="iw-preview-modal__time-sep" aria-hidden="true">•</span>
          <span className="iw-preview-modal__frames">
            Frame {displayFrame} / {totalFrames}
          </span>
        </span>
      </div>
    </div>
  );
}
