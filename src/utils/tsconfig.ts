import path from 'node:path'
import {
	getTsconfig,
	parseTsconfig,
	createFilesMatcher,
	createPathsMatcher,
	type TsConfigResult,
	type FileMatcher,
} from 'get-tsconfig'
import { logCjs } from './debug.js'

// eslint-disable-next-line import-x/no-mutable-exports
export let fileMatcher: undefined | FileMatcher

// eslint-disable-next-line import-x/no-mutable-exports
export let tsconfigPathsMatcher: undefined | ReturnType<typeof createPathsMatcher>

// eslint-disable-next-line import-x/no-mutable-exports
export let allowJs = false

// Cache for dynamic tsconfig lookups
const tsconfigCache = new Map<string, { paths: ReturnType<typeof createPathsMatcher>; allowJs: boolean } | null>()

/**
 * Create a dynamic paths matcher that can resolve different tsconfig.json files
 * based on the requesting file's location in a monorepo structure.
 */
export function createDynamicPathsMatcher () {
	return (specifier: string, fromFile?: string): string[] => {
		if (!fromFile) {
			logCjs(2, 'createDynamicPathsMatcher: no fromFile provided, using fallback')
			// Fallback to static matcher if no context available
			return tsconfigPathsMatcher?.(specifier) ?? []
		}

		logCjs(3, 'createDynamicPathsMatcher', { specifier, fromFile })

		// Find the directory to start searching from
		let searchDir = path.dirname(fromFile)

		// Check cache first
		if (tsconfigCache.has(searchDir)) {
			const cached = tsconfigCache.get(searchDir)
			if (cached?.paths) {
				const result = cached.paths(specifier)
				logCjs(3, 'createDynamicPathsMatcher cached result', { searchDir, specifier, result })
				return result
			}
			logCjs(3, 'createDynamicPathsMatcher cached null', { searchDir, specifier })
			return []
		}

		// Find the nearest tsconfig.json
		let currentDir = searchDir
		let tsconfigPath: string | null = null

		while (currentDir !== path.dirname(currentDir)) {
			const potentialConfig = path.join(currentDir, 'tsconfig.json')
			try {
				// Check if tsconfig.json exists (this will throw if not found)
				require('node:fs').accessSync(potentialConfig)
				tsconfigPath = potentialConfig
				logCjs(3, 'createDynamicPathsMatcher found tsconfig', { potentialConfig })
				break
			} catch {
				// Continue searching up the directory tree
			}
			currentDir = path.dirname(currentDir)
		}

		if (!tsconfigPath) {
			logCjs(3, 'createDynamicPathsMatcher no tsconfig found', { searchDir })
			tsconfigCache.set(searchDir, null)
			return []
		}

		try {
			// Parse the found tsconfig
			const tsconfigResult: TsConfigResult = {
				path: tsconfigPath,
				config: parseTsconfig(tsconfigPath),
			}

			const pathsMatcher = createPathsMatcher(tsconfigResult)
			const configAllowJs = tsconfigResult.config.compilerOptions?.allowJs ?? false

			if (pathsMatcher) {
				// Cache the result
				tsconfigCache.set(searchDir, { paths: pathsMatcher, allowJs: configAllowJs })

				const result = pathsMatcher(specifier)
				logCjs(3, 'createDynamicPathsMatcher created new matcher', {
					tsconfigPath,
					searchDir,
					specifier,
					result,
					allowJs: configAllowJs
				})
				return result
			} else {
				logCjs(2, 'createDynamicPathsMatcher no paths in tsconfig', { tsconfigPath })
				tsconfigCache.set(searchDir, null)
				return []
			}
		} catch (error) {
			logCjs(2, 'createDynamicPathsMatcher error parsing tsconfig', { tsconfigPath, error })
			tsconfigCache.set(searchDir, null)
			return []
		}
	}
}

// Create the dynamic paths matcher
export const dynamicPathsMatcher = createDynamicPathsMatcher()

export const loadTsconfig = (
	configPath?: string,
) => {
	let tsconfig: TsConfigResult | null = null
	if (configPath) {
		const resolvedConfigPath = path.resolve(configPath)
		tsconfig = {
			path: resolvedConfigPath,
			config: parseTsconfig(resolvedConfigPath),
		}
	} else {
		try {
			tsconfig = getTsconfig()
		} catch {
			// Not warning here for now because it gets warned twice
			// Once by ESM loader and then by CJS loader
			// const disableWarning = (
			// 	getFlag('--no-warnings', Boolean)
			// 	|| Boolean(process.env.NODE_NO_WARNINGS)
			// );
			// if (!disableWarning) {
			// 	if (error instanceof Error) {
			// 		console.warn(`(tsx:${process.pid}) [-----] TsconfigWarning:`, error.message);
			// 	}
			// }
		}

		if (!tsconfig) {
			return
		}
	}

	fileMatcher = createFilesMatcher(tsconfig)
	tsconfigPathsMatcher = createPathsMatcher(tsconfig)
	allowJs = tsconfig?.config.compilerOptions?.allowJs ?? false
}
