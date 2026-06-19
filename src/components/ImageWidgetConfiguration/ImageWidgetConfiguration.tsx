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
import { UNSPathInput } from '@faclon-labs/design-sdk/UNSPathInput';
import { DropdownMenu } from '@faclon-labs/design-sdk/DropdownMenu';
import { ActionListItem } from '@faclon-labs/design-sdk/ActionListItem';
import { useUNSTree } from '../../iosense-sdk/useUNSTree';
import type { UNSTree } from '../../iosense-sdk/useUNSTree';
import { uploadImageToS3 } from '../../iosense-sdk/api';
import { isJsonAsset, useLottieAnimation } from '../../iosense-sdk/lottie';
import Lottie, { type LottieRefCurrentProps } from 'lottie-react';
import {
  ImageWidgetEnvelope,
  ImageWidgetUIConfig,
  ImageEventConfig,
} from '../../iosense-sdk/types';
import './ImageWidgetConfiguration.css';

interface ImageWidgetConfigurationProps {
  config: ImageWidgetEnvelope | undefined;
  authentication?: string;
  onChange: (config: ImageWidgetEnvelope) => void;
  /** Optional back-button handler. When absent, the back IconButton is a no-op. */
  onBack?: () => void;
  // Angular injection surface — pass all three functional props or none.
  unsTree?: UNSTree;
  isLoadingTree?: boolean;
  onLoadWorkspaces?: () => void;
  resolveUNSValue?: (rawValue: string) => string;
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

const OPERATOR_OPTIONS = ['==', '!=', '>', '<', '>=', '<='] as const;
type Operator = typeof OPERATOR_OPTIONS[number];
function pos(v: string): number {
  return Math.max(0, Number(v) || 0);
}

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

async function downloadAsset(url: string): Promise<void> {
  if (!url) return;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileNameFromUrl(url);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error('[ImageWidget] download failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImageWidgetConfiguration(props: ImageWidgetConfigurationProps) {
  const { config, authentication, onChange, onBack } = props;

  // -------------------------------------------------------------------------
  // UNS injection detection (follows CLAUDE.md UNS Injection Pattern exactly)
  // -------------------------------------------------------------------------
  const hasInjectedUNS =
    props.unsTree !== undefined &&
    props.onLoadWorkspaces !== undefined &&
    props.resolveUNSValue !== undefined;

  const hookResult = useUNSTree(hasInjectedUNS ? undefined : authentication);
  const unsTree         = hasInjectedUNS ? props.unsTree!              : hookResult.unsTree;
  const isLoadingTree   = hasInjectedUNS ? (props.isLoadingTree ?? false) : hookResult.isLoadingTree;
  const loadWorkspaces  = hasInjectedUNS ? props.onLoadWorkspaces!     : hookResult.loadWorkspaces;
  const resolveUNSValue = hasInjectedUNS ? props.resolveUNSValue!      : hookResult.resolveUNSValue;

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
    config?.width ?? 0,
  );
  const [defaultHeight, setDefaultHeight] = useState<number>(
    config?.height ?? 0,
  );
  const [defaultLockAspect, setDefaultLockAspect] = useState(true);
  const [defaultAspectRatio, setDefaultAspectRatio] = useState<number | null>(null);
  const [linkEnabled, setLinkEnabled] = useState<boolean>(
    config?.uiConfig?.linkConfig?.enabled ?? false,
  );
  const [linkUrl, setLinkUrl] = useState<string>(
    config?.uiConfig?.linkConfig?.url ?? '',
  );
  const [events, setEvents] = useState<ImageEventConfig[]>(
    config?.uiConfig?.events ?? [],
  );

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
  const [existingAssetOpen, setExistingAssetOpen] = useState(false);
  const [newEventAlignment, setNewEventAlignment] = useState<Alignment>('Center');
  const [newEventAlignmentOpen, setNewEventAlignmentOpen] = useState(false);
  const [newEventWidth, setNewEventWidth] = useState<number>(0);
  const [newEventHeight, setNewEventHeight] = useState<number>(0);
  const [lockAspectRatio, setLockAspectRatio] = useState(false);
  const [newEventTopic, setNewEventTopic] = useState('');
  const [newEventOperator, setNewEventOperator] = useState<'==' | '!=' | '>' | '<' | '>=' | '<='>('==');
  const [newEventOperatorOpen, setNewEventOperatorOpen] = useState(false);
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
      const dw = config.width ?? 0;
      const dh = config.height ?? 0;
      setDefaultWidth(dw);
      setDefaultHeight(dh);
      setDefaultAspectRatio(dw > 0 && dh > 0 ? dw / dh : null);
      setLinkEnabled(config.uiConfig?.linkConfig?.enabled ?? false);
      setLinkUrl(config.uiConfig?.linkConfig?.url ?? '');
      setEvents(config.uiConfig?.events ?? []);
    }
  }, [config?._id]);

  // -------------------------------------------------------------------------
  // Emit helpers
  // -------------------------------------------------------------------------
  function emit(overrides?: Partial<{
    defaultImage: string;
    defaultImageSize: number;
    defaultWidth: number;
    defaultHeight: number;
    linkEnabled: boolean;
    linkUrl: string;
    events: ImageEventConfig[];
  }>) {
    const resolved = {
      defaultImage:     overrides?.defaultImage     ?? defaultImage,
      defaultImageSize: overrides?.defaultImageSize ?? defaultImageSize,
      defaultWidth:     overrides?.defaultWidth     ?? defaultWidth,
      defaultHeight:    overrides?.defaultHeight    ?? defaultHeight,
      linkEnabled:      overrides?.linkEnabled      ?? linkEnabled,
      linkUrl:          overrides?.linkUrl          ?? linkUrl,
      events:           overrides?.events           ?? events,
    };

    const uiConfig: ImageWidgetUIConfig = {
      defaultImage:     resolved.defaultImage,
      defaultImageSize: resolved.defaultImageSize,
      linkConfig: {
        enabled: resolved.linkEnabled,
        url: resolved.linkUrl,
      },
      events: resolved.events,
      style: {
        card: {
          wrapInCard: config?.uiConfig?.style?.card?.wrapInCard ?? false,
          bg: config?.uiConfig?.style?.card?.bg ?? '',
        },
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
    setExistingAssetOpen(false);
    setNewEventAlignment('Center');
    setNewEventAlignmentOpen(false);
    setNewEventWidth(0);
    setNewEventHeight(0);
    setLockAspectRatio(false);
    setAspectRatio(null);
    setNewEventTopic('');
    setNewEventOperator('==');
    setNewEventOperatorOpen(false);
    setNewEventValue('');
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
    setNewEventFrameRange(evt.frameRangeEnabled ?? false);
    setNewEventStartFrame(evt.startFrame ?? 0);
    setNewEventEndFrame(evt.endFrame ?? 0);
    setIsAddEventOpen(true);
  }

  function handleSubmitEvent() {
    if (!canSubmit) return;
    let updated: ImageEventConfig[];
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
    const isJson = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
    let capturedW = 0;
    let capturedH = 0;
    if (isJson) {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        if (typeof json.w === 'number') capturedW = json.w;
        if (typeof json.h === 'number') capturedH = json.h;
      } catch { /* leave dimensions blank */ }
    } else {
      const b64 = await fileToBase64(file);
      await new Promise<void>((resolve) => {
        const img = new window.Image();
        img.onload = () => {
          capturedW = img.naturalWidth;
          capturedH = img.naturalHeight;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = b64;
      });
    }
    setDefaultWidth(capturedW);
    setDefaultHeight(capturedH);

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
        defaultWidth: capturedW,
        defaultHeight: capturedH,
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

  const canSubmit =
    newEventName.trim().length > 0 &&
    newEventTopic.trim().length > 0 &&
    newEventValue.trim().length > 0 &&
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
        <IconButton
          className="iw-config__back-btn"
          icon={<ArrowLeft size={16} />}
          size="Medium"
          accessibilityLabel="Back"
          onClick={() => onBack?.()}
        />
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
              setDefaultWidth(0);
              setDefaultHeight(0);
              emit({ defaultImage: '', defaultImageSize: 0, defaultWidth: 0, defaultHeight: 0 });
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
              emit({ linkEnabled: isChecked });
            }}
          />
        </div>

        {hasImage && linkEnabled && (
          <TextInput
            label="URL"
            type="url"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={({ value }: { value: string }) => {
              setLinkUrl(value);
              emit({ linkUrl: value });
            }}
          />
        )}
      </div>

      <Divider />

      {/* Event Configuration accordion */}
      <div className="iw-config__accordion-section" ref={eventsAccordionRef}>
        <ProductAccordionItem
          title="Event Configuration"
          isDisabled={!hasImage}
          isActive={hasEvents}
          isExpanded={hasEvents && eventsExpanded}
          onToggle={() => setEventsExpanded((v) => !v)}
          headerAction={
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
          }
        >
          {events.length === 0 ? (
            <p className="iw-config__empty-hint">No events added yet.</p>
          ) : (
            <div className="iw-config__event-list">
              {events.map((evt, index) => {
                const subtitle = evt.frameRangeEnabled
                  ? `Frame Range : ${evt.startFrame || 0}-${evt.endFrame || 0}`
                  : `${evt.topic || ''} ${evt.operator} ${evt.value}`.trim();
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
                    <span
                      className="iw-config__event-grip"
                      aria-hidden="true"
                      title="Drag to reorder priority"
                    >
                      <MoreVertical size={14} />
                      <MoreVertical size={14} />
                    </span>
                    <ListCard
                      title={evt.label}
                      subtitle={subtitle}
                      onClick={(e: React.MouseEvent) => openEditEventModal(evt, e)}
                      trailingItems={
                        <ListCardTrailingItem trailing="Slot">
                          <IconButton
                            icon={<X size={16} aria-hidden="true" />}
                            size="Medium"
                            accessibilityLabel={`Delete event ${evt.label}`}
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              deleteEvent(evt.id);
                            }}
                          />
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
            {/* 1. Event name */}
            <TextInput
              label="Event name"
              necessityIndicator="required"
              size="Medium"
              placeholder="Enter event name"
              value={newEventName}
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
                placeholder="Select existing asset"
                value={existingAssets.find((e) => e.id === existingAssetId)?.label ?? ''}
                onClick={() => setExistingAssetOpen((v) => !v)}
                isOpen={existingAssetOpen}
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
                        setExistingAssetOpen(false);
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
                onClick={() => setNewEventAlignmentOpen((v) => !v)}
                isOpen={newEventAlignmentOpen}
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
                      onClick={() => { setNewEventAlignment(opt); setNewEventAlignmentOpen(false); }}
                    />
                  ))}
                </DropdownMenu>
              </SelectInput>
            </div>

            {/* 5. UNS Path */}
            <div className="iw-config__form-group">
              <InputFieldHeader label="UNS Path" size="Medium" necessityIndicator="required" />
              <UNSPathInput
                label=""
                placeholder="Type / to browse UNS or paste {{topic}} directly"
                value={newEventTopic}
                tree={unsTree}
                isLoading={isLoadingTree}
                onChange={(v: string) => {
                  const r = resolveUNSValue(v);
                  setNewEventTopic(r);
                }}
                onOpen={() => loadWorkspaces()}
              />
            </div>

            {/* 6. Condition header */}
            <p className="iw-event-modal__section-title">Condition</p>

            {/* 7. Operator */}
            <div className="iw-config__form-group">
              <InputFieldHeader label="Operator" size="Medium" necessityIndicator="required" />
              <SelectInput
                label=""
                value={newEventOperator}
                onClick={() => setNewEventOperatorOpen((v) => !v)}
                isOpen={newEventOperatorOpen}
              >
                <DropdownMenu>
                  {(['==', '!=', '>', '<', '>=', '<='] as const).map((op) => (
                    <ActionListItem
                      key={op}
                      title={op}
                      isSelected={newEventOperator === op}
                      onClick={() => { setNewEventOperator(op); setNewEventOperatorOpen(false); }}
                    />
                  ))}
                </DropdownMenu>
              </SelectInput>
            </div>

            {/* 8. Value */}
            <TextInput
              label="Value"
              necessityIndicator="required"
              size="Medium"
              type="number"
              placeholder="Enter threshold value"
              value={newEventValue}
              onChange={({ value }: { value: string }) => setNewEventValue(value)}
            />

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
                      placeholder="From"
                      value={newEventStartFrame > 0 ? String(newEventStartFrame) : ''}
                      onChange={({ value }: { value: string }) => setNewEventStartFrame(pos(value))}
                    />
                    <TextInput
                      label="End Frame"
                      size="Medium"
                      type="number"
                      min={0}
                      placeholder="To"
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
