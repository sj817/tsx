import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import {
	isFilePath,
	fileUrlPrefix,
	tsExtensionsPattern,
	nodeModulesPath,
} from '../../../utils/path-utils.js';
import { tsconfigPathsMatcher, dynamicPathsMatcher } from '../../../utils/tsconfig.js';
import type { ResolveFilename, SimpleResolve, LoaderState } from '../types.js';
import { logCjs as log } from '../../../utils/debug.js';
import { createImplicitResolver } from './resolve-implicit-extensions.js';
import { interopCjsExports } from './interop-cjs-exports.js';
import { createTsExtensionResolver } from './resolve-ts-extensions.js';
import { preserveQuery } from './preserve-query.js';

const resolveTsPaths = (
	request: string,
	parent: Module.Parent | undefined,
	nextResolve: SimpleResolve,
) => {
	// Support file protocol
	if (request.startsWith(fileUrlPrefix)) {
		request = fileURLToPath(request);
	}

	// Resolve TS path alias
	if (
		// bare specifier
		!isFilePath(request)

		// Dependency paths should not be resolved using tsconfig.json
		&& !parent?.filename?.includes(nodeModulesPath)
	) {
		let possiblePaths: string[] = [];

		// Try dynamic paths matcher first if we have a parent context
		if (parent?.filename && dynamicPathsMatcher) {
			try {
				possiblePaths = dynamicPathsMatcher(request, parent.filename);
				log(3, 'resolveTsPaths dynamic result', {
					request,
					parentFilename: parent.filename,
					possiblePaths,
				});
			} catch (error) {
				log(2, 'resolveTsPaths dynamic matcher error', {
					error,
					request,
					parentFilename: parent.filename,
				});
			}
		}

		// Fallback to static matcher if dynamic failed or no parent context
		if (possiblePaths.length === 0 && tsconfigPathsMatcher) {
			try {
				possiblePaths = tsconfigPathsMatcher(request);
				log(3, 'resolveTsPaths static fallback', {
					request,
					possiblePaths,
				});
			} catch (error) {
				log(2, 'resolveTsPaths static matcher error', {
					error,
					request,
				});
			}
		}

		log(3, 'resolveTsPaths final paths', {
			request,
			possiblePaths,
		});

		for (const possiblePath of possiblePaths) {
			try {
				return nextResolve(possiblePath);
			} catch (error) {
				log(3, 'resolveTsPaths path failed', {
					possiblePath,
					error,
				});
			}
		}
	}

	return nextResolve(request);
};

export const createResolveFilename = (
	state: LoaderState,
	nextResolve: ResolveFilename,
	namespace?: string,
): ResolveFilename => (
	request,
	parent,
	...restOfArgs
) => {
	if (state.enabled === false) {
		return nextResolve(request, parent, ...restOfArgs);
	}

	request = interopCjsExports(request);

	const [
		cleanRequest,
		searchParams,
		appendQuery,
	] = preserveQuery(request, parent);

	// If request namespace doesnt match the namespace, ignore
	if ((searchParams.get('namespace') ?? undefined) !== namespace) {
		return nextResolve(request, parent, ...restOfArgs);
	}

	log(2, 'resolve', {
		request,
		parent: parent?.filename ?? parent,
		restOfArgs,
	});

	let nextResolveSimple: SimpleResolve = request_ => nextResolve(
		request_,
		parent,
		...restOfArgs,
	);

	nextResolveSimple = createTsExtensionResolver(
		nextResolveSimple,
		Boolean(
			// If register.namespace is used (e.g. tsx.require())
			namespace

				// If parent is a TS file
				|| (parent?.filename && tsExtensionsPattern.test(parent.filename)),
		),
	);

	nextResolveSimple = createImplicitResolver(nextResolveSimple);

	const resolved = appendQuery(
		resolveTsPaths(cleanRequest, parent, nextResolveSimple),
		restOfArgs.length,
	);

	log(1, 'resolved', {
		request,
		parent: parent?.filename ?? parent,
		resolved,
	});

	return resolved;
};
