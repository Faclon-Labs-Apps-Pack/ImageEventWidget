## Active Task
Create ImageEvent widget from Figma design (node 771-20364) — started 2026-05-22

## Figma Design Analysis
Node: https://www.figma.com/design/V1DilToZCOgoUXVzpfu4Nx/Image-Event-Config-Lens-v2?node-id=771-20364
Screenshot: Configurator panel, 280px wide, white background.

### Configurator layout (top → bottom):
1. Header row — back arrow icon + "Image Config" title (LabelMediumDefault 16px semibold)
2. Divider
3. **Default Mode section** (p-4, gap-4):
   a. **Default Image Config** (label: "Default Image Config", 12px semibold):
      - UploadCta: "Drag files here or [Upload]", dashed border, h-56px
      - Helper text: "Supports PNG, JPG, SVG, and JSON files."
   b. **Link Configuration** row:
      - Switch with label "Link Configuration" (disabled/off by default in design)
4. Divider
5. **Event Configuration** accordion (ProductAccordionItem, collapsed, "+" headerAction)
6. **Rules Configuration** accordion (ProductAccordionItem, collapsed, "+" headerAction)

### Widget renderer:
- Displays current image (default or event-driven) full-width/height
- Evaluates rules[i].topic values against resolved data
- Shows event image for first matching rule, else defaultImage

## Decisions
- 2026-05-22 — rules use scalar bindings (topic → single resolved value for comparison) — no series needed
- 2026-05-22 — image stored as base64 data URL in uiConfig — no external upload endpoint needed
- 2026-05-22 — Link Configuration: when enabled shows TextInput for URL; wrapper <a> on widget
- 2026-05-22 — Add Event modal: label + UploadCta for image
- 2026-05-22 — Add Rule modal: label + UNSPathInput(topic) + SelectInput(operator) + TextInput(value) + SelectInput(eventId)

## Agent 1 Log (Builder)
- 2026-05-22 00:00 — Initial dispatch — implement full ImageWidget + ImageWidgetConfiguration + types
- 2026-05-22 00:01 — Build complete — 0 TypeScript errors; post-fixes: FileList type on UploadCta, Switch.onChange uses isChecked not checked, Switch has no label prop (replaced with iw-config__switch-row layout)

## Agent 2 Log (Figma Fetch)
- 2026-05-22 00:00 — Fetched node 771-20364 — configurator panel design received

## Open Questions
(none)
