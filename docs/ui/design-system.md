# CanaryGuard interface design system

This system applies to the acquisition pages and management dashboard. It uses the
uploaded UI/UX Pro Max accessibility and layout guidance, with CanaryGuard's chosen
charcoal, white, and amber palette taking precedence over generic catalog palettes.

## Color and meaning

| Role | Value | Use |
| --- | --- | --- |
| Canvas | `#101113` | Page background |
| Surface | `#181a1d` | Cards and panels |
| Raised surface | `#202328` | Hover states and nested controls |
| Text | `#ffffff` | Headings and primary content |
| Secondary text | `#b5bac3` | Supporting copy |
| Divider | `#373b43` | Decorative separators |
| Control boundary | `#767d89` | Editable inputs and outlined controls |
| Accent | `#f2bd72` | Primary actions, selection and keyboard focus |
| Accent foreground | `#17120b` | Text on amber buttons |
| Success | `#90c9a4` | Verified or successful evidence only |
| Error | `#ffaaaa` | Error text |

Both lines of the homepage headline are white. Green is reserved for status, and
status always has a text label. Use neutral surfaces without gradients, glows, or
decorative animation. Keep warnings, errors and success distinct from branding.

## Type and spacing

Use the existing system sans-serif stack; no externally loaded font is required.
Body text inherits the device's font settings. Use a 1.55 line height for reading,
fluid headings, and monospace only for identifiers. Supporting text is at least
0.875rem except compact brand and numbered metadata. Headings use sentence case.

Use a 4px spacing base, with 8, 12, 16, 24, 32 and 48px common intervals. Keep page
content within 1280px, fluid side padding, and clear section boundaries. Long SHAs,
repository names, email addresses and report values must wrap inside their parent.

## Responsive behavior and interaction

- Keep every navigation destination reachable at narrow widths. The navigation
  wraps into columns, with a full-width request action on phones.
- Use one column for hero and request content below 900px; service cards and paired
  fields collapse to one column at 600px. Evidence tables display labeled rows.
- Controls have a minimum 44px target. Allow button text to wrap, and do not use
  fixed widths that clip labels. Checkbox labels form the complete target.
- Use visible amber keyboard focus, semantic labels, native controls, and a skip
  link. Form errors identify their field and provide a focused summary with links.
- Expose the selected demo scenario through `aria-pressed`. Loading disables the
  submit action; failed requests preserve input and the existing retry token.
- Respect reduced motion in scrolling and transitions, and support forced colors.

## Copy and scope

Describe the actual release evidence, policy decision or requested service. Label
examples and simulations. Avoid slogans, inflated claims and decorative badges.
Preserve security disclosures, licensing, service identifiers and data contracts.
The UI remains plain HTML, CSS and JavaScript with the existing same-origin server.

## First-load hosting requirement

These assets do not introduce a loader, delayed reveal or external font request.
An idle Render free web service can still display its platform wake screen before
the server responds. Removing that delay requires always-on hosting; it cannot be
solved by a stylesheet or client-side timer. Keep the existing server architecture
and verify a fresh first request after an idle period once hosting is changed.
