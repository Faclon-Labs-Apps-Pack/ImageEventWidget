import { useState, useEffect, useRef } from 'react';
import {
  Lock, Unlock, X, FileText, ArrowLeft, Play, Pause, Plus,
  ArrowUpLeft, ArrowUp, ArrowUpRight, Circle, ArrowRight,
  ArrowDownLeft, ArrowDown, ArrowDownRight,
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
): ImageWidgetEnvelope {
  return {
    _id: existing?._id ?? `iw_${Date.now()}`,
    type: 'ImageWidget',
    general: existing?.general ?? { title: '' },
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

const STAGING_BASE = 'https://stagingsv.iosense.io/api';

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'application/json': 'json',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return map[mimeType] ?? 'jpg';
}

async function getS3SignedUrl(
  authentication: string,
  file: File,
): Promise<{ signedUrl: string; publicUrl: string }> {
  const ext = mimeToExt(file.type);
  const filename = `IoLens-${Date.now()}.${ext}`;
  const res = await fetch(`${STAGING_BASE}/account/s3/signedUrl`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authentication}`,
    },
    body: JSON.stringify({ folderName: 'IOLens', filename, contentType: file.type }),
  });
  const json = await res.json();
  if (!json.success) throw new Error('Failed to get S3 signed URL');
  const signedUrl = json.data as string;
  const publicUrl = signedUrl.split('?')[0];
  return { signedUrl, publicUrl };
}

async function uploadImageToS3(authentication: string, file: File): Promise<string> {
  const { signedUrl, publicUrl } = await getS3SignedUrl(authentication, file);
  await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  return publicUrl;
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

function uploadFileFromUrl(url: string): UploadFile {
  const name = fileNameFromUrl(url);
  const file = new File([], name) as UploadFile;
  file.state = 'completed';
  return file;
}

function uploadFileFromNative(native: File, state: UploadFile['state'], progress?: number): UploadFile {
  const f = native as UploadFile;
  f.state = state;
  if (progress !== undefined) f.progress = progress;
  return f;
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
  const [defaultImageFiles, setDefaultImageFiles] = useState<UploadFile[]>(
    config?.uiConfig.defaultImage ? [uploadFileFromUrl(config.uiConfig.defaultImage)] : [],
  );
  const [defaultWidth, setDefaultWidth] = useState<number>(
    config?.uiConfig.defaultWidth ?? 0,
  );
  const [defaultHeight, setDefaultHeight] = useState<number>(
    config?.uiConfig.defaultHeight ?? 0,
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
  const [rules, setRules] = useState<ImageRuleConfig[]>(
    config?.uiConfig?.rules ?? [],
  );

  // Accordion expand state
  const [eventsExpanded, setEventsExpanded] = useState(false);

  // Modal positioning
  const configRef = useRef<HTMLDivElement>(null);
  const eventsAccordionRef = useRef<HTMLDivElement>(null);
  const [modalX, setModalX] = useState(0);
  const [modalY, setModalY] = useState(0);

  // Upload loading states
  const [isUploadingDefault, setIsUploadingDefault] = useState(false);
  const [isUploadingEventImage, setIsUploadingEventImage] = useState(false);

  // Add/Edit Event modal state
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEventName, setNewEventName] = useState('');
  const [newEventImage, setNewEventImage] = useState('');
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
      const di = config.uiConfig.defaultImage ?? '';
      setDefaultImage(di);
      setDefaultImageFiles(di ? [uploadFileFromUrl(di)] : []);
      const dw = config.uiConfig.defaultWidth ?? 0;
      const dh = config.uiConfig.defaultHeight ?? 0;
      setDefaultWidth(dw);
      setDefaultHeight(dh);
      setDefaultAspectRatio(dw > 0 && dh > 0 ? dw / dh : null);
      setLinkEnabled(config.uiConfig.linkConfig.enabled ?? false);
      setLinkUrl(config.uiConfig.linkConfig.url ?? '');
      setEvents(config.uiConfig.events ?? []);
    }
  }, [config?._id]);

  // -------------------------------------------------------------------------
  // Emit helpers
  // -------------------------------------------------------------------------
  function emit(overrides?: Partial<{
    defaultImage: string;
    defaultWidth: number;
    defaultHeight: number;
    linkEnabled: boolean;
    linkUrl: string;
    events: ImageEventConfig[];
  }>) {
    const resolved = {
      defaultImage:  overrides?.defaultImage  ?? defaultImage,
      defaultWidth:  overrides?.defaultWidth  ?? defaultWidth,
      defaultHeight: overrides?.defaultHeight ?? defaultHeight,
      linkEnabled:   overrides?.linkEnabled   ?? linkEnabled,
      linkUrl:       overrides?.linkUrl       ?? linkUrl,
      events:        overrides?.events        ?? events,
    };

    const uiConfig: ImageWidgetUIConfig = {
      defaultImage:  resolved.defaultImage,
      defaultWidth:  resolved.defaultWidth,
      defaultHeight: resolved.defaultHeight,
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

    onChange(buildEnvelope(config, uiConfig));
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
    setNewEventFiles(evt.image ? [uploadFileFromUrl(evt.image)] : []);
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
      updated = events.map((e) =>
        e.id === editingEventId
          ? {
              ...e,
              label: newEventName.trim(),
              image: newEventImage,
              alignment: newEventAlignment,
              width: newEventWidth,
              height: newEventHeight,
              topic: newEventTopic,
              operator: newEventOperator,
              value: newEventValue,
              frameRangeEnabled: newEventFrameRange,
              startFrame: newEventStartFrame,
              endFrame: newEventEndFrame,
            }
          : e,
      );
    } else {
      const newEvent: ImageEventConfig = {
        id: `evt_${Date.now()}`,
        label: newEventName.trim(),
        image: newEventImage,
        alignment: newEventAlignment,
        width: newEventWidth,
        height: newEventHeight,
        topic: newEventTopic,
        operator: newEventOperator,
        value: newEventValue,
        frameRangeEnabled: newEventFrameRange,
        startFrame: newEventStartFrame,
        endFrame: newEventEndFrame,
      };
      updated = [...events, newEvent];
    }
    setEvents(updated);
    emit({ events: updated });
    setEventsExpanded(true);
    handleCloseAddEvent();
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
  // Size handlers — proportional update from STORED ratio (no drift)
  // -------------------------------------------------------------------------
  function handleDefaultWidthChange(value: number | null) {
    const w = Math.max(0, value ?? 0);
    setDefaultWidth(w);
    if (defaultLockAspect && defaultAspectRatio && defaultAspectRatio > 0) {
      const h = Math.max(1, Math.round(w / defaultAspectRatio));
      setDefaultHeight(h);
      emit({ defaultWidth: w, defaultHeight: h });
    } else {
      emit({ defaultWidth: w });
    }
  }

  function handleDefaultHeightChange(value: number | null) {
    const h = Math.max(0, value ?? 0);
    setDefaultHeight(h);
    if (defaultLockAspect && defaultAspectRatio && defaultAspectRatio > 0) {
      const w = Math.max(1, Math.round(h * defaultAspectRatio));
      setDefaultWidth(w);
      emit({ defaultWidth: w, defaultHeight: h });
    } else {
      emit({ defaultHeight: h });
    }
  }

  function handleDefaultAspectLockToggle() {
    const next = !defaultLockAspect;
    if (next) {
      setDefaultAspectRatio(defaultWidth > 0 && defaultHeight > 0 ? defaultWidth / defaultHeight : null);
    }
    setDefaultLockAspect(next);
  }

  function handleEventWidthChange(value: number | null) {
    const w = Math.max(0, value ?? 0);
    setNewEventWidth(w);
    if (lockAspectRatio && aspectRatio && aspectRatio > 0) {
      setNewEventHeight(Math.max(1, Math.round(w / aspectRatio)));
    }
  }

  function handleEventHeightChange(value: number | null) {
    const h = Math.max(0, value ?? 0);
    setNewEventHeight(h);
    if (lockAspectRatio && aspectRatio && aspectRatio > 0) {
      setNewEventWidth(Math.max(1, Math.round(h * aspectRatio)));
    }
  }

  function handleEventAspectLockToggle() {
    const next = !lockAspectRatio;
    if (next) {
      setAspectRatio(newEventWidth > 0 && newEventHeight > 0 ? newEventWidth / newEventHeight : null);
    }
    setLockAspectRatio(next);
  }

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
            onFilesSelect={async (files: FileList) => {
              if (!files || files.length === 0 || !authentication) return;
              const file = files[0];
              const isJson = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
              // Capture natural dimensions before uploading
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
              setDefaultAspectRatio(capturedW > 0 && capturedH > 0 ? capturedW / capturedH : null);
              setDefaultLockAspect(true);

              const pending = uploadFileFromNative(
                new File([file], file.name, { type: file.type }),
                'loading',
                0,
              );
              setDefaultImageFiles([pending]);
              setIsUploadingDefault(true);
              try {
                const publicUrl = await uploadImageToS3(authentication, file);
                setDefaultImage(publicUrl);
                setDefaultImageFiles([uploadFileFromNative(
                  new File([file], file.name, { type: file.type }),
                  'completed',
                )]);
                emit({ defaultImage: publicUrl, defaultWidth: capturedW, defaultHeight: capturedH });
              } catch (err) {
                console.error('[ImageWidget] default image upload failed:', err);
                setDefaultImageFiles([
                  uploadFileFromNative(
                    new File([file], file.name, { type: file.type }),
                    'failed',
                  ),
                ]);
              } finally {
                setIsUploadingDefault(false);
              }
            }}
            onRemove={() => {
              setDefaultImage('');
              setDefaultImageFiles([]);
              setDefaultWidth(0);
              setDefaultHeight(0);
              setDefaultAspectRatio(null);
              setDefaultLockAspect(true);
              emit({ defaultImage: '', defaultWidth: 0, defaultHeight: 0 });
            }}
          />
        </div>

        {hasImage && (
          <div className="iw-config__form-group">
            <InputFieldHeader label="Size" size="Medium" />
            <div className="iw-config__size-row">
              <TextInput
                label=""
                size="Medium"
                type="number"
                min={0}
                prefix="W"
                suffix="px"
                accessibilityLabel="Width"
                value={defaultWidth > 0 ? String(defaultWidth) : ''}
                onChange={({ value }: { value: string }) => handleDefaultWidthChange(value === '' ? null : Number(value))}
              />
              <TextInput
                label=""
                size="Medium"
                type="number"
                min={0}
                prefix="H"
                suffix="px"
                accessibilityLabel="Height"
                value={defaultHeight > 0 ? String(defaultHeight) : ''}
                onChange={({ value }: { value: string }) => handleDefaultHeightChange(value === '' ? null : Number(value))}
              />
              <Tooltip
                bodyText={defaultLockAspect ? 'Unlock Aspect Ratio' : 'Lock Aspect Ratio'}
                placement="Top"
              >
                <IconButton
                  className={`iw-config__lock-btn${defaultLockAspect ? ' iw-config__lock-btn--active' : ''}`}
                  icon={
                    defaultLockAspect
                      ? <Lock size={16} aria-hidden="true" />
                      : <Unlock size={16} aria-hidden="true" />
                  }
                  size="Medium"
                  accessibilityLabel={defaultLockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                  onClick={handleDefaultAspectLockToggle}
                />
              </Tooltip>
            </div>
          </div>
        )}

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
              {events.map((evt) => {
                const subtitle = evt.frameRangeEnabled
                  ? `Frame Range : ${evt.startFrame || 0}-${evt.endFrame || 0}`
                  : `${evt.topic || ''} ${evt.operator} ${evt.value}`.trim();
                return (
                  <ListCard
                    key={evt.id}
                    title={evt.label}
                    subtitle={subtitle}
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
              onFilesSelect={async (files: FileList) => {
                if (!files || files.length === 0 || !authentication) return;
                const file = files[0];
                const isJson = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
                // Read natural dimensions before uploading
                if (isJson) {
                  try {
                    const text = await file.text();
                    const json = JSON.parse(text);
                    const w = typeof json.w === 'number' ? json.w : 0;
                    const h = typeof json.h === 'number' ? json.h : 0;
                    if (w > 0) setNewEventWidth(w);
                    if (h > 0) setNewEventHeight(h);
                    setAspectRatio(w > 0 && h > 0 ? w / h : null);
                    setLockAspectRatio(true);
                  } catch { /* leave dimensions blank */ }
                } else {
                  const b64 = await fileToBase64(file);
                  const img = new window.Image();
                  img.onload = () => {
                    setNewEventWidth(img.naturalWidth);
                    setNewEventHeight(img.naturalHeight);
                    setAspectRatio(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null);
                    setLockAspectRatio(true);
                  };
                  img.src = b64;
                }
                setNewEventFiles([uploadFileFromNative(
                  new File([file], file.name, { type: file.type }),
                  'loading',
                  0,
                )]);
                setIsUploadingEventImage(true);
                try {
                  const publicUrl = await uploadImageToS3(authentication, file);
                  setNewEventImage(publicUrl);
                  setNewEventFiles([uploadFileFromNative(
                    new File([file], file.name, { type: file.type }),
                    'completed',
                  )]);
                } catch (err) {
                  console.error('[ImageWidget] event image upload failed:', err);
                  setNewEventFiles([uploadFileFromNative(
                    new File([file], file.name, { type: file.type }),
                    'failed',
                  )]);
                } finally {
                  setIsUploadingEventImage(false);
                }
              }}
              onRemove={() => {
                setNewEventImage('');
                setNewEventFiles([]);
                setNewEventWidth(0);
                setNewEventHeight(0);
                setAspectRatio(null);
                setLockAspectRatio(true);
              }}
            />
            )}

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

            {/* 4. Size */}
            <div className="iw-config__form-group">
              <InputFieldHeader label="Size" size="Medium" />
              <div className="iw-config__size-row">
                <TextInput
                  label=""
                  size="Medium"
                  type="number"
                  min={0}
                  prefix="W"
                  suffix="px"
                  accessibilityLabel="Width"
                  value={newEventWidth > 0 ? String(newEventWidth) : ''}
                  onChange={({ value }: { value: string }) => handleEventWidthChange(value === '' ? null : Number(value))}
                />
                <TextInput
                  label=""
                  size="Medium"
                  type="number"
                  min={0}
                  prefix="H"
                  suffix="px"
                  accessibilityLabel="Height"
                  value={newEventHeight > 0 ? String(newEventHeight) : ''}
                  onChange={({ value }: { value: string }) => handleEventHeightChange(value === '' ? null : Number(value))}
                />
                <Tooltip
                  bodyText={lockAspectRatio ? 'Unlock Aspect Ratio' : 'Lock Aspect Ratio'}
                  placement="Top"
                >
                  <IconButton
                    className={`iw-config__lock-btn${lockAspectRatio ? ' iw-config__lock-btn--active' : ''}`}
                    icon={
                      lockAspectRatio
                        ? <Lock size={16} aria-hidden="true" />
                        : <Unlock size={16} aria-hidden="true" />
                    }
                    size="Medium"
                    accessibilityLabel={lockAspectRatio ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                    onClick={handleEventAspectLockToggle}
                  />
                </Tooltip>
              </div>
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

            {/* 9. Frame Range toggle */}
            <div className="iw-event-modal__toggle-row">
              <span className="iw-event-modal__toggle-label">Frame Range</span>
              <Switch
                accessibilityLabel="Frame Range"
                isChecked={newEventFrameRange}
                onChange={({ isChecked }: { isChecked: boolean }) => setNewEventFrameRange(isChecked)}
              />
            </div>

            {/* 10. Start / End Frame (conditional) */}
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

            {/* 11. Overlap warning Alert (non-blocking) */}
            {hasFrameOverlap && (
              <Alert
                color="Notice"
                emphasis="Subtle"
                isFullWidth
                title="Overlapping Frame Range"
                description="This frame range is already in use. Overlapping ranges may cause unpredictable behavior. Adjust the frame range to avoid conflicts."
              />
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
