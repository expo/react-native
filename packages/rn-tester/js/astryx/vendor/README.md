# /packages/core/src

Source code for core UI components.

<!-- SYNC: When files in this directory change, update this document. -->

| File/Directory | Role      | Purpose                                                                                                                                         |
| -------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`     | Entry     | Package entry point; re-exports public components, hooks, and types                                                                             |
| `naming.ts`    | Utility   | Centralized namespace-prefix constants/helpers (CSS classes, data attrs, CSS vars) — single source of truth for the XDS→Astryx prefix migration |
| `reset.css`    | Styles    | Base CSS reset for consistent cross-browser defaults                                                                                            |
| `Button/`      | Component | Button component with variants and loading states                                                                                               |

Chat mention chips use `vertical-align: baseline` in both the composer and
transcript. Their labels share the surrounding text baseline, including when
the chip uses a smaller font or clips a long label.
