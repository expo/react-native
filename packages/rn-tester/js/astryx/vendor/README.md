# Vendored Astryx sources

Pristine copies from [facebook/astryx](https://github.com/facebook/astryx)
`packages/core/src` (v0.1.9) — the minimal slice needed to run `Card` on
React Native. Only `utils/index.ts` differs (slim re-export barrel; see note
inside). `@stylexjs/stylex` imports resolve to the RN StyleX runtime
(`../stylex-rn.js`) via the Metro alias in `packages/rn-tester/metro.config.js`.

**These files are force-added to git** (`git add -f`, plus a negation in the
repo `.gitignore`), because React Native's root ignore file has a blanket
`vendor/` rule. Without that they are untracked, and the Astryx demo cannot be
built from a fresh clone — the code imports files that are not in the
repository. That bit once: a working tree that looked complete was one `rm -rf`
away from losing sources no checkout could restore.
