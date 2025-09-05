import type { SourceMap } from '@ampproject/remapping'
import MagicString from 'magic-string'
import fs from 'node:fs'
import path from 'node:path'

// 缓存
const enumCache = new Map<string, Map<string, Map<string, string | number>>>()

// 正则表达式
const ENUM_REGEX = /(?:export\s+)?const\s+enum\s+(\w+)\s*\{([^}]+)\}/g
const MEMBER_REGEX = /(\w+)\s*=?\s*([^,\n]*)/g

/**
 * 解析 const enum
 */
function parseEnums (content: string): Map<string, Map<string, string | number>> {
	const enums = new Map<string, Map<string, string | number>>()

	let match: RegExpExecArray | null
	ENUM_REGEX.lastIndex = 0

	while ((match = ENUM_REGEX.exec(content)) !== null) {
		const enumName = match[1]
		const enumBody = match[2]
		const members = new Map<string, string | number>()

		let index = 0
		let memberMatch: RegExpExecArray | null
		MEMBER_REGEX.lastIndex = 0

		while ((memberMatch = MEMBER_REGEX.exec(enumBody)) !== null) {
			const memberName = memberMatch[1].trim()
			if (!memberName) continue

			let memberValue: string | number
			const valueStr = memberMatch[2].trim()

			if (valueStr && valueStr !== ',') {
				const cleanValue = valueStr.replace(/['"]/g, '').replace(/,$/, '')
				// 处理字符串值
				if (valueStr.startsWith('"') || valueStr.startsWith("'")) {
					memberValue = cleanValue
				} else {
					const numValue = Number(cleanValue)
					memberValue = isNaN(numValue) ? cleanValue : numValue
				}
			} else {
				memberValue = index
			}

			members.set(memberName, memberValue)
			index = typeof memberValue === 'number' ? memberValue + 1 : index + 1
		}

		if (members.size > 0) {
			enums.set(enumName, members)
		}
	}

	return enums
}

/**
 * 读取并解析枚举（带缓存）
 */
async function getEnumsFromTypeFile (typeFilePath: string): Promise<Map<string, Map<string, string | number>>> {
	// 最开始就检查缓存
	const cached = enumCache.get(typeFilePath)
	if (cached !== undefined) return cached

	try {
		const content = await fs.promises.readFile(typeFilePath, 'utf8')
		const enums = parseEnums(content)

		// 无论是否有枚举都缓存结果
		enumCache.set(typeFilePath, enums)

		return enums
	} catch {
		// 即使读取失败也缓存空结果，避免重复尝试
		const emptyMap = new Map<string, Map<string, string | number>>()
		enumCache.set(typeFilePath, emptyMap)
		return emptyMap
	}
}

/**
 * 极简高性能 const enum 转换器
 * @param filePath 文件路径
 * @param code 文件内容
 * @returns 转换结果或 undefined（无变化）
 */
export const transformConstEnum = async (filePath: string, code: string): Promise<{ code: string; map: SourceMap } | undefined> => {
	// 判断是否为js、mjs
	if (!filePath.endsWith('.js') && !filePath.endsWith('.mjs')) {
		return undefined
	}

	// 检查d.ts、d.mts
	const file = filePath.replace(path.extname(filePath), '')
	const types = [
		`${file}.d.ts`,
		`${file}.d.mts`,
	]

	// 检查是否存在类型声明文件
	const existingFile = await Promise.any(
		types.map(typeFile =>
			fs.promises.access(typeFile).then(() => typeFile)
		)
	).catch(() => null)

	if (!existingFile) return undefined

	// 最开始就检查缓存
	const enums = await getEnumsFromTypeFile(existingFile)
	if (enums.size === 0) return undefined

	// 快速检查代码中是否包含可能的枚举使用
	let hasEnumUsage = false
	for (const enumName of enums.keys()) {
		if (code.includes(`${enumName}.`)) {
			hasEnumUsage = true
			break
		}
	}

	if (!hasEnumUsage) return undefined

	// 应用转换
	const magicString = new MagicString(code)
	let hasChanges = false

	// 构建枚举引用映射
	const enumMap = new Map<string, string | number>()
	for (const [enumName, members] of enums) {
		for (const [memberName, memberValue] of members) {
			enumMap.set(`${enumName}.${memberName}`, memberValue)
		}
	}

	// 按长度排序，避免短的替换影响长的
	const sortedKeys = Array.from(enumMap.keys()).sort((a, b) => b.length - a.length)

	for (const enumRef of sortedKeys) {
		const enumValue = enumMap.get(enumRef)!
		const escapedRef = enumRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		const regex = new RegExp(`\\b${escapedRef}\\b`, 'g')
		const replacement = typeof enumValue === 'string' ? `"${enumValue}"` : String(enumValue)

		const matches: RegExpExecArray[] = []
		let match: RegExpExecArray | null
		regex.lastIndex = 0

		while ((match = regex.exec(code)) !== null) {
			matches.push({ ...match })
		}

		// 从后往前替换，避免索引偏移
		for (let i = matches.length - 1; i >= 0; i--) {
			const matchItem = matches[i]
			magicString.overwrite(matchItem.index!, matchItem.index! + matchItem[0].length, replacement)
			hasChanges = true
		}
	}

	if (!hasChanges) return undefined

	return {
		code: magicString.toString(),
		map: magicString.generateMap({
			source: filePath,
			includeContent: false,
			hires: true,
		}) as unknown as SourceMap,
	}
}

/**
 * 清理缓存
 */
export function clearConstEnumCacheV5 (): void {
	enumCache.clear()
}

/**
 * 缓存统计
 */
export function getConstEnumCacheStatsV5 (): {
	enumCacheSize: number
} {
	return {
		enumCacheSize: enumCache.size,
	}
}
