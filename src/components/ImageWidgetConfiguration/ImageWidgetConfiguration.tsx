import { useState, useEffect, useRef } from 'react';
import { Lock, X, Image, Edit2 } from 'react-feather';
import { ListCard, ListCardLeadingItem, ListCardTrailingItem } from '@faclon-labs/design-sdk/ListCard';
import { UploadCta } from '@faclon-labs/design-sdk/UploadCta';
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
import {
  ImageWidgetEnvelope,
  ImageWidgetUIConfig,
  ImageEventConfig,
  ImageRuleConfig,
} from '../../iosense-sdk/types';
import './ImageWidgetConfiguration.css';

interface ImageWidgetConfigurationProps {
  config: ImageWidgetEnvelope | undefined;
  authentication?: string;
  onChange: (config: ImageWidgetEnvelope) => void;
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

const OPERATOR_OPTIONS = ['==', '!=', '>', '<', '>=', '<='] as const;
type Operator = typeof OPERATOR_OPTIONS[number];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImageWidgetConfiguration(props: ImageWidgetConfigurationProps) {
  const { config, authentication, onChange } = props;

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
    config?.uiConfig.defaultImage ?? '',
  );
  const [linkEnabled, setLinkEnabled] = useState<boolean>(
    config?.uiConfig.linkConfig.enabled ?? false,
  );
  const [linkUrl, setLinkUrl] = useState<string>(
    config?.uiConfig.linkConfig.url ?? '',
  );
  const [events, setEvents] = useState<ImageEventConfig[]>(
    config?.uiConfig.events ?? [],
  );
  const [rules, setRules] = useState<ImageRuleConfig[]>(
    config?.uiConfig.rules ?? [],
  );

  // Accordion expand state
  const [eventsExpanded, setEventsExpanded] = useState(false);
  const [rulesExpanded, setRulesExpanded] = useState(false);

  // Modal positioning
  const configRef = useRef<HTMLDivElement>(null);
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
  const [newEventAlignment, setNewEventAlignment] = useState<'Left' | 'Center' | 'Right'>('Center');
  const [newEventAlignmentOpen, setNewEventAlignmentOpen] = useState(false);
  const [newEventWidth, setNewEventWidth] = useState('');
  const [newEventHeight, setNewEventHeight] = useState('');
  const [lockAspectRatio, setLockAspectRatio] = useState(false);
  const [newEventTopic, setNewEventTopic] = useState('');
  const [newEventOperator, setNewEventOperator] = useState<'==' | '!=' | '>' | '<' | '>=' | '<='>('==');
  const [newEventOperatorOpen, setNewEventOperatorOpen] = useState(false);
  const [newEventValue, setNewEventValue] = useState('');

  // Add Rule modal state
  const [isAddRuleOpen, setIsAddRuleOpen] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleTopic, setNewRuleTopic] = useState('');
  const [newRuleOperator, setNewRuleOperator] = useState<Operator>('==');
  const [newRuleOperatorOpen, setNewRuleOperatorOpen] = useState(false);
  const [newRuleValue, setNewRuleValue] = useState('');
  const [newRuleEventId, setNewRuleEventId] = useState('');
  const [newRuleEventOpen, setNewRuleEventOpen] = useState(false);

  // -------------------------------------------------------------------------
  // Sync state from existing config on mount / config change
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (config) {
      setDefaultImage(config.uiConfig.defaultImage ?? '');
      setLinkEnabled(config.uiConfig.linkConfig.enabled ?? false);
      setLinkUrl(config.uiConfig.linkConfig.url ?? '');
      setEvents(config.uiConfig.events ?? []);
      setRules(config.uiConfig.rules ?? []);
    }
  }, [config?._id]);

  // -------------------------------------------------------------------------
  // Emit helpers
  // -------------------------------------------------------------------------
  function emit(overrides?: Partial<{
    defaultImage: string;
    linkEnabled: boolean;
    linkUrl: string;
    events: ImageEventConfig[];
    rules: ImageRuleConfig[];
  }>) {
    const resolved = {
      defaultImage: overrides?.defaultImage ?? defaultImage,
      linkEnabled:  overrides?.linkEnabled  ?? linkEnabled,
      linkUrl:      overrides?.linkUrl      ?? linkUrl,
      events:       overrides?.events       ?? events,
      rules:        overrides?.rules        ?? rules,
    };

    const uiConfig: ImageWidgetUIConfig = {
      defaultImage: resolved.defaultImage,
      linkConfig: {
        enabled: resolved.linkEnabled,
        url: resolved.linkUrl,
      },
      events: resolved.events,
      rules: resolved.rules,
      style: {
        card: {
          wrapInCard: config?.uiConfig.style.card.wrapInCard ?? false,
          bg: config?.uiConfig.style.card.bg ?? '',
        },
      },
    };

    onChange(buildEnvelope(config, uiConfig));
  }

  // -------------------------------------------------------------------------
  // Modal handlers — Add Event
  // -------------------------------------------------------------------------
  function openAddEventModal(e: React.MouseEvent) {
    e.stopPropagation();
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
    setIsAddEventOpen(true);
  }

  function handleCloseAddEvent() {
    setIsAddEventOpen(false);
    setEditingEventId(null);
    setNewEventName('');
    setNewEventImage('');
    setNewEventAlignment('Center');
    setNewEventAlignmentOpen(false);
    setNewEventWidth('');
    setNewEventHeight('');
    setLockAspectRatio(false);
    setNewEventTopic('');
    setNewEventOperator('==');
    setNewEventOperatorOpen(false);
    setNewEventValue('');
  }

  function openEditEventModal(evt: ImageEventConfig, e: React.MouseEvent) {
    e.stopPropagation();
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
    setEditingEventId(evt.id);
    setNewEventName(evt.label);
    setNewEventImage(evt.image);
    setNewEventAlignment(evt.alignment);
    setNewEventWidth(evt.width);
    setNewEventHeight(evt.height);
    setNewEventTopic(evt.topic);
    setNewEventOperator(evt.operator);
    setNewEventValue(evt.value);
    setIsAddEventOpen(true);
  }

  function handleSubmitEvent() {
    if (!newEventName.trim()) return;
    let updated: ImageEventConfig[];
    if (editingEventId) {
      updated = events.map((e) =>
        e.id === editingEventId
          ? { ...e, label: newEventName.trim(), image: newEventImage, alignment: newEventAlignment, width: newEventWidth, height: newEventHeight, topic: newEventTopic, operator: newEventOperator, value: newEventValue }
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
      };
      updated = [...events, newEvent];
    }
    setEvents(updated);
    emit({ events: updated });
    handleCloseAddEvent();
  }

  // -------------------------------------------------------------------------
  // Modal handlers — Add Rule
  // -------------------------------------------------------------------------
  function openAddRuleModal(e: React.MouseEvent) {
    e.stopPropagation();
    if (configRef.current) {
      const rect = configRef.current.getBoundingClientRect();
      setModalX(rect.right + 30);
      setModalY(rect.top);
    }
    setIsAddRuleOpen(true);
  }

  function handleCloseAddRule() {
    setIsAddRuleOpen(false);
    setNewRuleName('');
    setNewRuleTopic('');
    setNewRuleOperator('==');
    setNewRuleValue('');
    setNewRuleEventId('');
  }

  function handleSubmitRule() {
    if (!newRuleName.trim() || !newRuleTopic.trim()) return;
    const newRule: ImageRuleConfig = {
      id: `rule_${Date.now()}`,
      label: newRuleName.trim(),
      topic: newRuleTopic,
      operator: newRuleOperator,
      value: newRuleValue,
      eventId: newRuleEventId,
    };
    const updated = [...rules, newRule];
    setRules(updated);
    emit({ rules: updated });
    handleCloseAddRule();
  }

  // -------------------------------------------------------------------------
  // Delete helpers
  // -------------------------------------------------------------------------
  function deleteEvent(id: string) {
    const updated = events.filter((e) => e.id !== id);
    setEvents(updated);
    emit({ events: updated });
  }

  function deleteRule(id: string) {
    const updated = rules.filter((r) => r.id !== id);
    setRules(updated);
    emit({ rules: updated });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="iw-config" ref={configRef}>
      {/* Header */}
      <div className="iw-config__header">
        <span className="iw-config__title LabelLargeSemibold">Image Config</span>
      </div>

      <Divider />

      {/* Default Mode section */}
      <div className="iw-config__section">
        <span className="iw-config__section-label BodySmallSemibold">Default Image Config</span>

        <div className="iw-config__upload-section">
          <UploadCta
            className="iw-config__upload-cta"
            accept=".png,.jpg,.jpeg,.svg,.json"
            isDisabled={isUploadingDefault}
            onFilesSelect={async (files: FileList) => {
              if (!files || files.length === 0 || !authentication) return;
              setIsUploadingDefault(true);
              try {
                const publicUrl = await uploadImageToS3(authentication, files[0]);
                setDefaultImage(publicUrl);
                emit({ defaultImage: publicUrl });
              } catch (err) {
                console.error('[ImageWidget] default image upload failed:', err);
              } finally {
                setIsUploadingDefault(false);
              }
            }}
          />
          {isUploadingDefault && (
            <p className="iw-config__field-help">Uploading…</p>
          )}
          {defaultImage && !isUploadingDefault && (
            <div className="iw-config__preview">
              <img
                className="iw-config__preview-thumb"
                src={defaultImage}
                alt="default preview"
              />
              <button
                type="button"
                className="iw-config__delete-btn"
                style={{ fontSize: 12 }}
                onClick={() => {
                  setDefaultImage('');
                  emit({ defaultImage: '' });
                }}
              >
                Remove
              </button>
            </div>
          )}
        </div>

        <div className="iw-config__switch-row">
          <span className="iw-config__section-label BodySmallSemibold" style={{ color: linkEnabled ? 'var(--text-default-secondary,#292f32)' : 'var(--text-default-disabled,rgba(67,75,81,0.4))' }}>
            Link Configuration
          </span>
          <Switch
            accessibilityLabel="Link Configuration"
            isChecked={linkEnabled}
            onChange={({ isChecked }: { isChecked: boolean }) => {
              setLinkEnabled(isChecked);
              emit({ linkEnabled: isChecked });
            }}
          />
        </div>

        {linkEnabled && (
          <UNSPathInput
            label="URL"
            placeholder="Type / to browse UNS or paste {{topic}} directly"
            value={linkUrl}
            tree={unsTree}
            isLoading={isLoadingTree}
            onChange={(v: string) => {
              const r = resolveUNSValue(v);
              setLinkUrl(r);
              emit({ linkUrl: r });
            }}
            onOpen={() => loadWorkspaces()}
          />
        )}
      </div>

      <Divider />

      {/* Event Configuration accordion */}
      <div className="iw-config__accordion-section">
        <ProductAccordionItem
          title="Event Configuration"
          isExpanded={eventsExpanded}
          onToggle={() => setEventsExpanded((v) => !v)}
          headerAction={
            <button
              type="button"
              className="iw-config__add-btn"
              onClick={openAddEventModal}
            >
              +
            </button>
          }
        >
          {events.length === 0 ? (
            <p className="iw-config__empty-hint">No events added yet.</p>
          ) : (
            <div className="iw-config__event-list">
              {events.map((evt) => (
                <ListCard
                  key={evt.id}
                  title={evt.label}
                  subtitle={evt.topic ? `${evt.operator} ${evt.value}` : undefined}
                  leadingItem={
                    <ListCardLeadingItem leading="Slot">
                      {evt.image ? (
                        <img
                          src={evt.image}
                          alt={evt.label}
                          style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: 2 }}
                        />
                      ) : (
                        <Image size={16} style={{ color: 'var(--text-default-tertiary, #616d75)' }} />
                      )}
                    </ListCardLeadingItem>
                  }
                  trailingItems={
                    <ListCardTrailingItem trailing="Slot">
                      <div className="iw-config__list-actions">
                        <button
                          type="button"
                          className="iw-config__action-btn"
                          title="Edit event"
                          onClick={(e) => openEditEventModal(evt, e)}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          className="iw-config__action-btn iw-config__action-btn--danger"
                          title="Delete event"
                          onClick={() => deleteEvent(evt.id)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </ListCardTrailingItem>
                  }
                />
              ))}
            </div>
          )}
        </ProductAccordionItem>
      </div>

      {/* Rules Configuration accordion */}
      <div className="iw-config__accordion-section">
        <ProductAccordionItem
          title="Rules Configuration"
          isExpanded={rulesExpanded}
          onToggle={() => setRulesExpanded((v) => !v)}
          headerAction={
            <button
              type="button"
              className="iw-config__add-btn"
              onClick={openAddRuleModal}
            >
              +
            </button>
          }
        >
          {rules.length === 0 ? (
            <p className="iw-config__empty-hint">No rules added yet.</p>
          ) : (
            <div className="iw-config__rule-list">
              {rules.map((rule) => {
                const evtLabel = events.find((e) => e.id === rule.eventId)?.label ?? rule.eventId;
                return (
                  <div key={rule.id} className="iw-config__rule-row">
                    <span className="iw-config__rule-label">{rule.label}</span>
                    <span className="iw-config__rule-detail">
                      {rule.operator} {rule.value} &rarr; {evtLabel}
                    </span>
                    <button
                      type="button"
                      className="iw-config__delete-btn"
                      title="Delete rule"
                      onClick={() => deleteRule(rule.id)}
                    >
                      &times;
                    </button>
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
        className="iw-event-modal"
        onClose={handleCloseAddEvent}
        header={<ModalHeader title={editingEventId ? 'Edit Event' : 'Create Event'} onClose={handleCloseAddEvent} />}
        footer={
          <ModalFooter
            primaryAction={
              <Button variant="Primary" label={editingEventId ? 'Save Event' : 'Add Event'} onClick={handleSubmitEvent} />
            }
          />
        }
      >
        <ModalBody>
          <div className="iw-event-modal__body">
            {/* 1. Event name */}
            <TextInput
              label="Event name"
              placeholder="Enter event name"
              value={newEventName}
              isRequired
              onChange={({ value }: { value: string }) => setNewEventName(value)}
            />

            {/* 2. Upload Asset */}
            <span className="iw-config__section-label BodySmallSemibold">Upload Asset</span>
            <UploadCta
              className="iw-config__upload-cta"
              accept=".png,.jpg,.jpeg,.svg,.json"
              isDisabled={isUploadingEventImage}
              onFilesSelect={async (files: FileList) => {
                if (!files || files.length === 0 || !authentication) return;
                const file = files[0];
                // Read natural dimensions before uploading
                const b64 = await fileToBase64(file);
                const img = new window.Image();
                img.onload = () => {
                  setNewEventWidth(String(img.naturalWidth));
                  setNewEventHeight(String(img.naturalHeight));
                };
                img.src = b64;
                // Upload to S3
                setIsUploadingEventImage(true);
                try {
                  const publicUrl = await uploadImageToS3(authentication, file);
                  setNewEventImage(publicUrl);
                } catch (err) {
                  console.error('[ImageWidget] event image upload failed:', err);
                } finally {
                  setIsUploadingEventImage(false);
                }
              }}
            />
            {isUploadingEventImage && (
              <p className="iw-config__field-help">Uploading…</p>
            )}
            {newEventImage && !isUploadingEventImage && (
              <div className="iw-config__preview">
                <img
                  className="iw-config__preview-thumb"
                  src={newEventImage}
                  alt="event preview"
                />
                <button
                  type="button"
                  className="iw-config__delete-btn"
                  style={{ fontSize: 12 }}
                  onClick={() => setNewEventImage('')}
                >
                  Remove
                </button>
              </div>
            )}
            <p className="iw-config__field-help BodySmallRegular">Supports PNG, JPG, SVG, and JSON files.</p>

            {/* 3. Alignment */}
            <SelectInput
              label="Alignment"
              value={newEventAlignment}
              onClick={() => setNewEventAlignmentOpen((v) => !v)}
              isOpen={newEventAlignmentOpen}
            >
              <DropdownMenu>
                {(['Left', 'Center', 'Right'] as const).map((opt) => (
                  <ActionListItem
                    key={opt}
                    title={opt}
                    isSelected={newEventAlignment === opt}
                    onClick={() => { setNewEventAlignment(opt); setNewEventAlignmentOpen(false); }}
                  />
                ))}
              </DropdownMenu>
            </SelectInput>

            {/* 4. Size */}
            <span className="iw-config__section-label BodySmallSemibold">Size</span>
            <div className="iw-event-modal__size-row">
              <TextInput
                label=""
                prefix="W"
                placeholder="—"
                value={newEventWidth}
                onChange={({ value }: { value: string }) => {
                  setNewEventWidth(value);
                  if (lockAspectRatio && newEventWidth && newEventHeight) {
                    const ratio = parseFloat(newEventHeight) / parseFloat(newEventWidth);
                    if (!isNaN(ratio)) setNewEventHeight(String(Math.round(parseFloat(value) * ratio)));
                  }
                }}
              />
              <TextInput
                label=""
                prefix="H"
                placeholder="—"
                value={newEventHeight}
                onChange={({ value }: { value: string }) => {
                  setNewEventHeight(value);
                  if (lockAspectRatio && newEventWidth && newEventHeight) {
                    const ratio = parseFloat(newEventWidth) / parseFloat(newEventHeight);
                    if (!isNaN(ratio)) setNewEventWidth(String(Math.round(parseFloat(value) * ratio)));
                  }
                }}
              />
              <button
                type="button"
                className={`iw-event-modal__lock-btn${lockAspectRatio ? ' iw-event-modal__lock-btn--active' : ''}`}
                title={lockAspectRatio ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                onClick={() => setLockAspectRatio((v) => !v)}
              >
                <Lock size={14} />
              </button>
            </div>

            {/* 5. UNS Path */}
            <UNSPathInput
              label="UNS Path"
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

            {/* 6. Condition header */}
            <span className="iw-config__section-label BodySmallSemibold" style={{ marginTop: 4 }}>Condition</span>

            {/* 7. Operator */}
            <SelectInput
              label="Operator"
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

            {/* 8. Value */}
            <TextInput
              label="Value"
              placeholder="Enter threshold value"
              value={newEventValue}
              isRequired
              onChange={({ value }: { value: string }) => setNewEventValue(value)}
            />
          </div>
        </ModalBody>
      </Modal>

      {/* Add Rule Modal */}
      <Modal
        {...({ transparent: true } as any)}
        isOpen={isAddRuleOpen}
        positionX={modalX}
        positionY={modalY}
        className="iw-rule-modal"
        onClose={handleCloseAddRule}
        header={<ModalHeader title="Add Rule" onClose={handleCloseAddRule} />}
        footer={
          <ModalFooter
            primaryAction={
              <Button variant="Primary" label="Add Rule" onClick={handleSubmitRule} />
            }
          />
        }
      >
        <ModalBody>
          <div className="iw-rule-modal__body">
            <TextInput
              label="Rule Name"
              placeholder="e.g. High Alarm"
              value={newRuleName}
              onChange={({ value }: { value: string }) => setNewRuleName(value)}
            />

            <UNSPathInput
              label="Data Source"
              placeholder="Type / to browse UNS or paste {{topic}} directly"
              value={newRuleTopic}
              tree={unsTree}
              isLoading={isLoadingTree}
              onChange={(v: string) => {
                const r = resolveUNSValue(v);
                setNewRuleTopic(r);
              }}
              onOpen={() => loadWorkspaces()}
            />

            <SelectInput
              label="Operator"
              value={newRuleOperator}
              onClick={() => setNewRuleOperatorOpen((v) => !v)}
              isOpen={newRuleOperatorOpen}
            >
              <DropdownMenu>
                {OPERATOR_OPTIONS.map((op) => (
                  <ActionListItem
                    key={op}
                    title={op}
                    isSelected={newRuleOperator === op}
                    onClick={() => {
                      setNewRuleOperator(op);
                      setNewRuleOperatorOpen(false);
                    }}
                  />
                ))}
              </DropdownMenu>
            </SelectInput>

            <TextInput
              label="Value"
              placeholder="e.g. 1 or true"
              value={newRuleValue}
              onChange={({ value }: { value: string }) => setNewRuleValue(value)}
            />

            <SelectInput
              label="Show Event"
              value={events.find((e) => e.id === newRuleEventId)?.label ?? ''}
              onClick={() => setNewRuleEventOpen((v) => !v)}
              isOpen={newRuleEventOpen}
            >
              <DropdownMenu>
                {events.map((evt) => (
                  <ActionListItem
                    key={evt.id}
                    title={evt.label}
                    isSelected={newRuleEventId === evt.id}
                    onClick={() => {
                      setNewRuleEventId(evt.id);
                      setNewRuleEventOpen(false);
                    }}
                  />
                ))}
              </DropdownMenu>
            </SelectInput>
          </div>
        </ModalBody>
      </Modal>
    </div>
  );
}
