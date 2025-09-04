<h1 align="center">
<br>
<picture>
	<source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
	<img width="160" alt="tsx" src=".github/logo-light.svg">
</picture>
<br><br>
<a href="https://npm.im/tsx"><img src="https://badgen.net/npm/v/tsx"></a> <a href="https://npm.im/tsx"><img src="https://badgen.net/npm/dm/tsx"></a>
</h1>

<p align="center">
TypeScript Execute (tsx): The easiest way to run TypeScript in Node.js
<br><br>
<a href="https://tsx.is">Documentation</a>&nbsp;&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;&nbsp;<a href="https://tsx.is/getting-started">Getting started →</a>
</p>

## 🚀 Features

- ✅ **Enhanced TypeScript Support**: Full support for `const enum` compilation (implementation reference: [unplugin-inline-enum](https://github.com/unplugin/unplugin-inline-enum))
- ✅ **Monorepo Ready**: Improved dependency resolution that respects tsconfig.json in monorepo environments, supporting paths mapping in sub-packages
- ✅ **Zero Configuration**: Works out of the box with TypeScript projects
- ✅ **Fast Execution**: Optimized for quick TypeScript execution in Node.js

## ✨ Fork Enhancements

This fork introduces two major improvements over the original tsx:

### Const Enum Support

Full compilation support for `const enum` declarations, enabling proper inlining of enum values at runtime. The implementation is based on [unplugin-inline-enum](https://github.com/unplugin/unplugin-inline-enum) for reliable enum processing.

### Enhanced Monorepo Support

Improved dependency resolution in monorepo environments:

- Properly respects `tsconfig.json` files in dependency packages
- Supports TypeScript `paths` mapping in sub-packages
- Better resolution of cross-package imports and type definitions

## 📦 Installation

### npm

```bash
npm install @karinjs/tsx
# or using pnpm
pnpm add @karinjs/tsx
```

### Alias Installation

```bash
# Using npm
npm install tsx@npm:@karinjs/tsx
# or using pnpm
pnpm add tsx@npm:@karinjs/tsx
```

<br>

<p align="center">
	<a href="https://github.com/sponsors/privatenumber/sponsorships?tier_id=398771"><img width="412" src="https://raw.githubusercontent.com/privatenumber/sponsors/master/banners/assets/donate.webp"></a>
	<a href="https://github.com/sponsors/privatenumber/sponsorships?tier_id=416984"><img width="412" src="https://raw.githubusercontent.com/privatenumber/sponsors/master/banners/assets/sponsor.webp"></a>
</p>
<p align="center"><sup><i>Already a sponsor?</i> Join the discussion in the <a href="https://github.com/pvtnbr/tsx">Development repo</a>!</sup></p>

## Sponsors

<p align="center">
	<a href="https://github.com/sponsors/privatenumber">
		<img src="https://cdn.jsdelivr.net/gh/privatenumber/sponsors/sponsorkit/sponsors.svg">
	</a>
</p>
