import fs from 'node:fs'
import path from 'node:path'
import MagicString from 'magic-string'
import { parseSync } from 'oxc-parser'
import type {
	Expression,
	PrivateIdentifier,
	NumericLiteral,
	StringLiteral,
} from 'oxc-parser'

// Cache for parsed const enums to avoid re-parsing the same .d.ts files
const constEnumCache = new Map<string, EnumData>()

/**
 * Represents a member of an enum.
 */
interface EnumMember {
	readonly name: string
	readonly value: string | number
}

/**
 * Represents a declaration of an enum.
 */
interface EnumDeclaration {
	readonly id: string
	readonly members: ReadonlyArray<EnumMember>
}

/**
 * Represents the data of enums in a file.
 */
interface EnumData {
	readonly declarations: ReadonlyArray<EnumDeclaration>
	readonly defines: { readonly [id_key: `${string}.${string}`]: string }
}

const REGEX_DTS: RegExp = /\.d\.[cm]?ts(\?.*)?$/
const REGEX_LANG_TS: RegExp = /^[cm]?tsx?$/

/**
 * Returns the language (extension name) of a given filename.
 * @param filename - The name of the file.
 * @returns The language of the file.
 */
export function getLang (filename: string): string {
	if (isDts(filename)) return 'dts'
	return path.extname(filename).replace(/^\./, '').replace(/\?.*$/, '')
}

/**
 * Checks if a filename represents a TypeScript declaration file (.d.ts).
 * @param filename - The name of the file to check.
 * @returns A boolean value indicating whether the filename is a TypeScript declaration file.
 */
export function isDts (filename: string): boolean {
	return REGEX_DTS.test(filename)
}

/**
 * Checks if the given language (ts, mts, cjs, dts, tsx...) is TypeScript.
 * @param lang - The language to check.
 * @returns A boolean indicating whether the language is TypeScript.
 */
export function isTs (lang?: string): boolean {
	return !!lang && (lang === 'dts' || REGEX_LANG_TS.test(lang))
}

/**
 * Parse const enums from TypeScript files using AST
 */
const parseConstEnumsFromAST = (filePath: string): EnumData => {
	if (constEnumCache.has(filePath)) {
		return constEnumCache.get(filePath)!
	}

	const result: EnumData = {
		declarations: [],
		defines: {},
	}

	try {
		if (!fs.existsSync(filePath)) {
			constEnumCache.set(filePath, result)
			return result
		}

		const content = fs.readFileSync(filePath, 'utf8')
		const lang = getLang(filePath)

		if (!isTs(lang)) {
			constEnumCache.set(filePath, result)
			return result
		}

		const parseResult = parseSync(filePath, content, {
			lang: lang === 'dts' ? 'ts' : lang as 'js' | 'jsx' | 'ts' | 'tsx',
			astType: isTs(lang) ? 'ts' : 'js'
		})
		const ast = parseResult.program
		const declarations: EnumDeclaration[] = []
		const defines: { [id_key: `${string}.${string}`]: string } = {}

		/**
		 * Evaluates a JavaScript expression and returns the result.
		 */
		const evaluate = (exp: string): string | number => new Function(`return ${exp}`)()

		for (const node of ast.body) {
			// Look for: export const enum EnumName { ... }
			if (
				node.type === 'ExportNamedDeclaration'
				&& node.declaration
				&& node.declaration.type === 'TSEnumDeclaration'
				&& node.declaration.const === true
			) {
				const decl = node.declaration
				const id = decl.id.name

				let lastInitialized: string | number | undefined
				const members: EnumMember[] = []

				for (const e of decl.body.members) {
					const key = e.id.type === 'Identifier' ? e.id.name :
						(e.id.type === 'Literal' ? String((e.id as StringLiteral).value) : '')
					const fullKey = `${id}.${key}` as const

					const saveValue = (value: string | number) => {
						members.push({
							name: key,
							value,
						})
						defines[fullKey] = JSON.stringify(value)
					}

					const init = e.initializer
					if (init) {
						let value: string | number

						switch (init.type) {
							case 'Literal': {
								const literal = init as StringLiteral | NumericLiteral
								value = literal.value

								break
							}
							case 'BinaryExpression': {
								const resolveValue = (node: Expression | PrivateIdentifier) => {
									if (node.type === 'Literal') {
										const literal = node as StringLiteral | NumericLiteral
										return literal.value
									} if (node.type === 'MemberExpression') {
										const exp = content.slice(node.start!, node.end!) as `${string}.${string}`
										if (!(exp in defines)) {
											throw new Error(`Unresolved enum reference: ${exp}`)
										}
										return JSON.parse(defines[exp])
									}
									throw new Error(`Unsupported operand type: ${node.type}`)
								}

								const leftValue = resolveValue(init.left)
								const rightValue = resolveValue(init.right)
								const exp = `${leftValue}${init.operator}${rightValue}`
								value = evaluate(exp)

								break
							}
							case 'UnaryExpression': {
								if (init.argument.type === 'Literal') {
									const literal = init.argument as StringLiteral | NumericLiteral
									const exp = `${init.operator}${literal.value}`
									value = evaluate(exp)
								} else {
									throw new Error(`Unsupported unary argument type: ${init.argument.type}`)
								}

								break
							}
							default: {
								throw new Error(`Unsupported initializer type: ${init.type}`)
							}
						}

						lastInitialized = value
						saveValue(value)
					} else if (lastInitialized === undefined) {
						// First member without initializer defaults to 0
						lastInitialized = 0
						saveValue(lastInitialized)
					} else if (typeof lastInitialized === 'number') {
						// Auto-increment numeric values
						lastInitialized++
						saveValue(lastInitialized)
					} else {
						throw new TypeError(`Cannot auto-increment non-numeric enum value: ${lastInitialized}`)
					}
				}

				declarations.push({
					id,
					members,
				})
			}
		}

		const enumData: EnumData = {
			declarations,
			defines,
		}
		constEnumCache.set(filePath, enumData)
		return enumData
	} catch (error) {
		// Silently handle parsing errors - don't output to console as it pollutes test output
		// The error is expected for files with syntax errors like 'broken-syntax.ts'
		constEnumCache.set(filePath, result)
		return result
	}
}

/**
 * Resolve module path and find TypeScript files containing const enums
 */
const resolveEnumPath = (importPath: string, currentFile: string): string[] => {
	const results: string[] = []

	try {
		const currentDir = path.dirname(currentFile)
		let resolvedPath: string

		if (importPath.startsWith('./') || importPath.startsWith('../')) {
			// Relative import
			resolvedPath = path.resolve(currentDir, importPath)
		} else {
			// Try to resolve as is for now - could be enhanced to handle node_modules
			resolvedPath = path.resolve(currentDir, importPath)
		}

		// Try different extensions and patterns
		const candidates = [
			`${resolvedPath}.d.ts`,
			`${resolvedPath}.ts`,
			`${resolvedPath}/index.d.ts`,
			`${resolvedPath}/index.ts`,
		]

		// If the path ends with .js, try replacing with .d.ts/.ts
		if (resolvedPath.endsWith('.js')) {
			const withoutJs = resolvedPath.slice(0, -3)
			candidates.push(
				`${withoutJs}.d.ts`,
				`${withoutJs}.ts`,
			)
		}

		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) {
				results.push(candidate)
			}
		}
	} catch {
		// Ignore resolution errors
	}

	return results
}

/**
 * Transform const enum references in TypeScript code using AST-based parsing
 */
export const transformConstEnum = (filePath: string, code: string): {
	code: string
	map: any
} | undefined => {
	// Only process TypeScript and JavaScript files
	if (!/\.[cm]?[jt]sx?$/.test(filePath)) {
		return undefined
	}

	// Quick check: if the file doesn't contain import statements, skip processing
	if (!code.includes('import ')) {
		return undefined
	}

	try {
		const s = new MagicString(code)
		let transformed = false

		// Parse the current file to find imports
		const lang = getLang(filePath)
		const parseResult = parseSync(filePath, code, {
			lang: lang === 'dts' ? 'ts' : lang as 'js' | 'jsx' | 'ts' | 'tsx',
			astType: isTs(lang) ? 'ts' : 'js'
		})
		const ast = parseResult.program

		// Collect all const enum definitions and their values
		const allDefines: { [key: string]: string } = {}

		// Find all imports that might contain const enums
		for (const node of ast.body) {
			if (node.type === 'ImportDeclaration') {
				const importPath = node.source.value
				const enumFiles = resolveEnumPath(importPath, filePath)

				// Check each resolved file for const enums
				for (const enumFile of enumFiles) {
					const enumData = parseConstEnumsFromAST(enumFile)

					// Add all enum definitions to our lookup table
					Object.assign(allDefines, enumData.defines)

					// Handle different import styles
					for (const specifier of node.specifiers) {
						if (specifier.type === 'ImportNamespaceSpecifier') {
							// import * as Lib from './lib'
							const alias = specifier.local.name

							// Transform enum references: alias.EnumName.Key -> "value"
							for (const decl of enumData.declarations) {
								for (const member of decl.members) {
									const pattern = new RegExp(
										`\\b${alias}\\.${decl.id}\\.${member.name}\\b`,
										'g',
									)

									let match
									while ((match = pattern.exec(code)) !== null) {
										const start = match.index
										const end = start + match[0].length
										const replacement = JSON.stringify(member.value)

										s.update(start, end, `${replacement} /* ${match[0]} */`)
										transformed = true
									}
								}
							}
						} else if (specifier.type === 'ImportSpecifier') {
							// import { SomeEnum } from './lib'
							const importedName = specifier.imported.type === 'Identifier'
								? specifier.imported.name
								: specifier.imported.value
							const localName = specifier.local.name

							// Find matching enum declaration
							const enumDecl = enumData.declarations.find(d => d.id === importedName)
							if (enumDecl) {
								for (const member of enumDecl.members) {
									const pattern = new RegExp(
										`\\b${localName}\\.${member.name}\\b`,
										'g',
									)

									let match
									while ((match = pattern.exec(code)) !== null) {
										const start = match.index
										const end = start + match[0].length
										const replacement = JSON.stringify(member.value)

										s.update(start, end, `${replacement} /* ${match[0]} */`)
										transformed = true
									}
								}
							}
						}
					}
				}
			}
		}

		if (!transformed) {
			return undefined
		}

		return {
			code: s.toString(),
			map: s.generateMap({
				source: filePath,
				file: path.basename(filePath),
				includeContent: true,
			}),
		}
	} catch (error) {
		// Silently handle transformation errors - don't output to console as it pollutes test output
		// The error is expected for files with syntax errors like 'broken-syntax.ts'
		return undefined
	}
}
