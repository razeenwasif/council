---
name: Council
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#e4beb4'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#ab8980'
  outline-variant: '#5b4039'
  surface-tint: '#ffb5a0'
  primary: '#ffb5a0'
  on-primary: '#5f1500'
  primary-container: '#ff5722'
  on-primary-container: '#541200'
  inverse-primary: '#b02f00'
  secondary: '#ffb954'
  on-secondary: '#452b00'
  secondary-container: '#c3841b'
  on-secondary-container: '#3c2500'
  tertiary: '#b4cad6'
  on-tertiary: '#1e333c'
  tertiary-container: '#7e949f'
  on-tertiary-container: '#172c35'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdbd1'
  primary-fixed-dim: '#ffb5a0'
  on-primary-fixed: '#3b0900'
  on-primary-fixed-variant: '#862200'
  secondary-fixed: '#ffddb4'
  secondary-fixed-dim: '#ffb954'
  on-secondary-fixed: '#291800'
  on-secondary-fixed-variant: '#633f00'
  tertiary-fixed: '#cfe6f2'
  tertiary-fixed-dim: '#b4cad6'
  on-tertiary-fixed: '#071e27'
  on-tertiary-fixed-variant: '#354a53'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
spacing:
  unit: 4px
  gutter: 16px
  margin-page: 32px
  container-max: 1440px
---

## Brand & Style

The design system embodies a high-end AI orchestration environment that blends the precision of a terminal with the sophistication of a modern executive suite. It is built for power users who value clarity, speed, and algorithmic transparency.

The style is a **Modern-Technical Hybrid**. It leverages the structural honesty of Brutalism—using thin, crisp borders and monospaced data visualization—but softens the experience with refined typography and expansive whitespace. The goal is to evoke a sense of "Command and Control," where the UI feels like a high-fidelity instrument rather than a consumer app. 

Key attributes:
- **Precision:** Mathematical alignment and consistent line weights.
- **Authority:** A dark-mode first orientation that focuses attention on the "Council" of AI agents.
- **Clarity:** Elimination of gradients and unnecessary ornamentation in favor of data-rich density.

## Colors

The palette is optimized for long-session focus and high-contrast signaling.

- **Primary (Vibrant Orange):** Reserved for active execution states, primary "Run" actions, and critical status indicators.
- **Secondary (Amber):** Used for warnings, pending states, and highlighting specific AI-generated suggestions or "thought" processes.
- **Tertiary (Slate Gray):** Used for structural elements like borders, inactive tabs, and secondary metadata.
- **Neutral (Charcoal/Black):** The canvas. A deep `#121212` base ensures the vibrant primary colors pop without causing eye strain.

Functional colors:
- **Success:** `#8BC34A` (Muted Lime)
- **Error:** `#F44336` (Deep Red)
- **Info:** `#03A9F4` (Technical Blue)

## Typography

The system utilizes a dual-font strategy to balance legibility with technical character.

- **Hanken Grotesk (Sans-Serif):** Used for top-level navigation, page headers, and marketing-adjacent UI elements. It provides the "High-End" feel that prevents the system from feeling like a basic CLI.
- **JetBrains Mono (Monospace):** The workhorse of the system. Used for all input fields, AI outputs, logs, buttons, and metadata. It reinforces the orchestrator's technical nature.

**Usage Rules:**
- All numeric data and timestamps must be rendered in `JetBrains Mono`.
- Labels should always be Uppercase when using the `label-md` role to emphasize the TUI aesthetic.
- Avoid using weights below 400 to maintain crispness on dark backgrounds.

## Layout & Spacing

This design system uses a **Rigid Modular Grid** based on 4px increments. The layout should feel like a terminal window organized into panes.

- **The Grid:** A 12-column layout for desktop. Components should align strictly to the grid edges. 
- **Panes:** Content is organized into "Panes" (sidebar, main orchestrator, inspector). Each pane has a 1px solid border (`#2D2D2D`).
- **Whitespace:** Despite the technical nature, generous internal padding within panes (24px to 32px) is required to ensure the UI remains "Modern" and readable.
- **Mobile Adaptivity:** On mobile, the multi-pane view collapses into a stack. Use a single-column layout with fixed headers and bottom-anchored action bars.

## Elevation & Depth

Elevation in this design system is expressed through **Tonal Layering and Borders**, not traditional drop shadows.

- **Base Layer:** `#121212` (The Desktop/Background).
- **Surface Layer:** `#1A1A1A` (Panes and Cards).
- **Floating Layer:** `#242424` (Modals and Popovers).
- **Borders:** All interactive elements and containers use a 1px border. For neutral elements, use `#2D2D2D`. For active elements, use the Primary Orange.
- **Shadows:** Use a single "Hard Shadow" for floating modals: `8px 8px 0px 0px rgba(0,0,0,0.5)`. This mimics a terminal window shadow rather than a soft ambient one.

## Shapes

The shape language is strictly **Geometric and Sharp**. 

- **Corners:** Use 0px border-radius for all primary components (Buttons, Inputs, Panes). This reinforces the "Command Line" and "Council" authority.
- **Exceptions:** Very small UI indicators (like status pips or notification dots) can be circular to provide visual contrast against the rigid grid.
- **Visual Weight:** Use consistent 1px strokes for all borders. Never use 2px or thicker strokes except for the "Active" focus state on primary buttons.

## Components

### Buttons
- **Primary:** Background `#FF5722`, text `#121212` (JetBrains Mono Bold). Sharp corners. No shadow.
- **Secondary:** Transparent background, 1px border `#FF5722`, text `#FF5722`.
- **Ghost:** Transparent background, text `#455A64`.

### Input Fields
- **Text Input:** Background `#000000`, 1px border `#2D2D2D`. Placeholder text in `#455A64`. On focus, the border changes to `#FF5722` and a block cursor (full-height rectangle) should blink.

### Cards & Panes
- Every card is a simple rectangle with a 1px border.
- Headers within cards should have a solid `#1A1A1A` background and a bottom border to separate them from the content body.

### Chips & Tags
- Used for AI model names or status tags. 
- Rectangular, 1px border, `label-md` typography.
- Active tags: `#FF5722` text with a subtle `rgba(255, 87, 34, 0.1)` background.

### Lists
- Use "Terminal Style" selection. The active item in a list should be preceded by a `>` character and have a Primary Orange border-left.

### Checkboxes
- Custom square boxes. When checked, they should fill with a solid Primary Orange block rather than a checkmark.