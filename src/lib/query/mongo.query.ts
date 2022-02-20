import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { MongoQueryModel, QueryObjectModel } from '../model/mongo.query.model';
import { StringUtils } from '../utils/string.util';
import { StringValidator } from '../utils/string.validator';
import * as url from 'url';

/**
 * Valid Mongodb Operators
 */
export const VALID_OPERATORS = {
	types: [
		'id',
		'string',
		'boolean',
		'integer',
		'float',
		'datetime',
		'date',
		'timestamp',
		'hash',
		'array',
		'subdocument',
		'subdocuments',
		'file',
		'MongoCode',
	],
	arrayTypes: ['id', 'string', 'boolean', 'integer', 'float', 'datetime', 'date', 'timestamp'],
	checkTypes: ['write', 'create', 'read'], // Should be CRUD create, read, update, delete
	referenceTypes: ['referenceOne', 'referenceMany'],
	queryOperators: {
		comparison: ['$eq', '$gt', '$gte', '$in', '$lt', '$lte', '$ne', '$nin'],
		logical: ['$and', '$not', '$nor', '$or'],
		element: ['$exists', '$type'],
		evaluation: ['$expr', '$mod', '$regex', '$text', '$where'],
		geospatial: ['$geoIntersects', '$geoWithin', '$near', '$nearSphere'],
		array: ['$all', '$elemMatch', '$size'],
		comment: ['$comment'],
	},
	packTypes: ['create', 'update', 'insert', 'delete', 'undelete'],
	updateOperators: ['$set', '$unset', '$push', '$pullAll', '$pull', '$addToSet', '$inc'],
	updateModifiers: ['$each'],
	aggregateStages: [
		'$facet',
		'$project',
		'$match',
		'$limit',
		'$skip',
		'$unwind',
		'$group',
		'$sort',
		'$geoNear',
		'$lookup',
		'$graphLookup',
		'$replaceRoot',
		'$addFields',
	],
	aggregateStage_fields: {
		$geoNear: [
			'spherical',
			'maxDistance',
			'query',
			'distanceMultiplier',
			'uniqueDocs',
			'near',
			'distanceField',
			'includeLocs',
			'minDistance',
		],
		$lookup: ['from', 'localField', 'foreignField', 'let', 'pipeline', 'as'],
		$graphLookup: [
			'from',
			'startWith',
			'connectFromField',
			'connectToField',
			'as',
			'maxDepth',
			'depthField',
			'restrictSearchWithMatch',
		],
	},
};

export const MongoQueryParser = (): MethodDecorator => {
	return (_target, _key, descriptor: TypedPropertyDescriptor<any>) => {
		const original = descriptor.value;
		descriptor.value = async function (...props: any) {
			const queryProps = props[0];
			const anotherProps = props.slice(1);
			const query: MongoQueryModel = parse(queryProps);
			return await original.apply(this, [query, ...anotherProps]);
		};
		return descriptor;
	};
};

export const MongoQuery: () => ParameterDecorator = createParamDecorator(
	(_data: unknown, ctx: ExecutionContext): MongoQueryModel => {
		const query = ctx.getArgByIndex(0).query;
		return parse(query);
	}
);

export function parse(query: any): MongoQueryModel {
	const def_limit = 100;
	const def_skip = 0;
	const def_page = 1;

	const result: MongoQueryModel = new MongoQueryModel();

	result.limit = getIntKey(query, 'limit', def_limit);
	result.skip = query.page
		? getSkipFromPage(query, def_page, result.limit)
		: getIntKey(query, 'skip', def_skip);
	result.select = getSelect(query, {});
	result.sort = getSort(query, {});
	// result.populate = getPopulate(query, []);
	result.filter = getFilter(query, {});

	return result;
}

function getIntKey(query: any, key: string, def: number): number {
	if (!query[key] || !StringValidator.isInt(query[key])) {
		return def;
	}
	return +query[key];
}

function getSkipFromPage(query: any, def: number, limit: number): number {
	const page = getIntKey(query, 'page', def);
	return page > 1 ? (page - 1) * limit : 0;
}

function getSelect(query: any, def: QueryObjectModel): QueryObjectModel {
	if (!query.select) return def;
	return StringUtils.splitString(query.select, ',').reduce(
		(obj: { [x: string]: number }, key: string) => {
			const cleanKey: string = StringUtils.cleanString(key, /[^A-z0-9_.]/g);
			obj[cleanKey] = key.startsWith('-') ? 0 : 1;
			return obj;
		},
		{}
	);
}

function getSort(query: any, def: QueryObjectModel): QueryObjectModel {
	if (!query.sort) return def;
	return StringUtils.splitString(query.sort, ',').reduce(
		(obj: { [x: string]: number }, key: string) => {
			const cleanKey: string = StringUtils.cleanString(key, /[^A-z0-9_.]/g);
			obj[cleanKey] = key.startsWith('-') ? -1 : 1;
			return obj;
		},
		{}
	);
}

function getPopulate(query: any, def: QueryObjectModel[]): QueryObjectModel | QueryObjectModel[] {
	if (!query.populate) return def;

	if (query.populate instanceof Array) {
		return query.populate.map((populate: any) => getPopulate({ populate }, def));
	}

	const [path, select, filter] = query.populate.split(';');

	const result: QueryObjectModel = { path };

	if (select && select !== 'all') {
		result['select'] = getSelect({ select }, {});
	}
	if (filter) {
		result['match'] = getFilter(url.parse(`?${filter}`, true).query, {});
	}

	return result;
}

function getFilter(query: any, def: QueryObjectModel): QueryObjectModel {
	delete query.limit;
	delete query.skip;
	delete query.page;
	delete query.select;
	delete query.sort;
	delete query.populate;
	if (!query) return def;
	// console.log(query);
	return Object.keys(query).reduce((obj: any, key: string) => {
		const queryValue = query[key];
		const cleanKey: string = StringUtils.cleanString(key, /[^A-z0-9_.]/g);

		// Is array of values
		if (Array.isArray(queryValue)) {
			obj[cleanKey] = getImplicitANDValue(queryValue);
			return obj;
			// TODO: Check for logical operators then run th
		}

		const value = getSimpleFilterValue(queryValue);
		// console.log("getSimpleFilterValue.value", value)
		if (value !== null) {
			const cleanKey: string = StringUtils.cleanString(key, /[^A-z0-9_.]/g);
			obj[cleanKey] = value;
		}
		return obj;
	}, {});
}

function getMapOfOperatorsWithValues(filter: string[]) {
	return filter.map((item) => getSimpleFilterValue(item));
}

function getImplicitANDValue(filter: string[]) {
	const filterValuesMap = getMapOfOperatorsWithValues(filter);

	return filterValuesMap.reduce((acc: any, filterValue: any) => {
		const operatorArray = Object.keys(filterValue);
		operatorArray.forEach((key: string) => {
			acc[key] = filterValue[key];
		});

		return acc;
	}, {});
}

function getArrayValue(key: string, filter: string[]): object[] {
	if (!filter || !filter.length) return [];
	const cleanKey: string = StringUtils.cleanString(key, /[^A-z0-9_.]/g);

	return filter.map((item) => ({ [cleanKey]: getSimpleFilterValue(item) }));
}

function getSimpleFilterValue(filter: string): string | number | boolean | Date | object | null {
	if (!filter) return null;

	if (isJson(filter)) {
		// console.log("isJson", queryValue);
		return JSON.parse(filter);
	}

	if (isElementMatchFilter(filter)) {
		const first_dot_index: number = filter.indexOf('}');
		const operator: string = filter.substring(1, first_dot_index);
		const value: string = filter.substring(first_dot_index + 1);
		if (!value) {
			return null;
		}

		const elemMatchUrlSearchParams = new URLSearchParams(value.replace(/#/g, '&'));
		console.log('Split Query params Element Match', elemMatchUrlSearchParams);
		let constructElemMatchFilter: any = {};
		elemMatchUrlSearchParams.forEach((value, key) => {
			constructElemMatchFilter[key] = value;
		});

		return { [`$${operator}`]: getFilter(constructElemMatchFilter, {}) };
	}

	if (isLogicalOperator(filter)) {
		// console.log('Is Logical Operator', cleanKey, filter);

		const first_dot_index: number = filter.indexOf('}');
		const operator: string = filter.substring(1, first_dot_index);
		const value: string = filter.substring(first_dot_index + 1);

		return {
			[`$${operator}`]: getSimpleFilterValue(value),
		};
	}

	if (isORFilter(filter)) {
		return {
			$or: getMapOfOperatorsWithValues(filter.split('|')),
		};
	}

	if (isANDFilter(filter)) {
		// console.log("OIs And FIlter", queryValue);
		const queryAndValues = filter
			.replace(/{/g, ',{')
			.split(',')
			.filter((val: any) => val !== '');

		// @Note: below code doesn't work if operators are repeating
		return getImplicitANDValue(queryAndValues);
		// @Note: below nests all operators inside $and array
		// obj[cleanKey] = {
		//   '$and': getMapOfOperatorsWithValues(queryAndValues)
		// }
	}

	if (isComparisonFilter(filter)) {
		const first_dot_index: number = filter.indexOf('}');
		const operator: string = filter.substring(1, first_dot_index);
		const value: string = filter.substring(first_dot_index + 1);
		if (!value) {
			return null;
		}
		return { [`$${operator}`]: getSimpleFilterValue(value) };
	}

	if (isElementFilter(filter)) {
		const first_dot_index: number = filter.indexOf('}');
		const operator: string = filter.substring(1, first_dot_index);
		const value: string = filter.substring(first_dot_index + 1);
		if (!value) {
			return null;
		}

		if (operator === 'exists') {
			return getElementExists(value);
		}

		return getElementType(value);
	}

	if (StringValidator.isISODate(filter) || StringValidator.isISODateTime(filter)) {
		return new Date(filter).toISOString();
	}

	if (StringValidator.isNumberString(filter)) {
		return +filter;
	}

	if (filter === 'true' || filter === 'false') {
		return filter === 'true';
	}

	// If not regex then return
	if (filter.indexOf('*') === -1 && !filter.startsWith('{regex}')) {
		return filter;
	}

	if (filter.startsWith('{regex}')) {
		filter = filter.split('{regex}')[1];
	}

	const value = StringUtils.cleanString(filter, /[^\w\s@.-}]/g);
	let $regex = value;

	if (filter.startsWith('*')) {
		$regex = `^${value}`;
		if (filter.endsWith('*')) {
			$regex = $regex.substring(1);
		}
	} else if (filter.endsWith('*')) {
		$regex = `${value}$`;
	}
	return {
		$regex,
		$options: 'i',
	};
}

function isComparisonFilter(filter: string): boolean {
	return (
		filter.startsWith('{eq}') ||
		filter.startsWith('{gt}') ||
		filter.startsWith('{gte}') ||
		filter.startsWith('{in}') ||
		filter.startsWith('{lt}') ||
		filter.startsWith('{lte}') ||
		filter.startsWith('{ne}') ||
		filter.startsWith('{nin}')
		// ||
		// filter.startsWith('{elemMatch}')
	);
}

function isElementFilter(filter: string): boolean {
	return filter.startsWith('{exists}') || filter.startsWith('{type}');
}

function isElementMatchFilter(filter: string): boolean {
	return filter.startsWith('{elemMatch}');
}

function isSimpleFilter(value: string): boolean {
	return StringUtils.testString(value, /^([{\w\s@.\-}]{1,}[{\w@.\-}])$/);
}

function isANDFilter(filter: string): boolean {
	if (filter.indexOf('{') === -1) return false;
	return filter.split('{').filter((val) => val !== '').length > 1;
}

function isORFilter(filter: string): boolean {
	if (filter.indexOf('|') === -1) return false;
	return StringUtils.testString(filter, /^(([{\w\s@.-}]\|?){1,}[{\w@.-}])$/);
}

function isLogicalOperator(filter: string): boolean {
	return VALID_OPERATORS.queryOperators.logical.some((operator) =>
		filter.startsWith(`{${operator.replace('$', '')}}`)
	);
}

function getElementExists(value: string) {
	if (['true', 'false'].indexOf(value) === -1) {
		return null;
	}
	return { $exists: value === 'true' };
}

function getElementType(value: string) {
	const validTypes: string[] = [
		'double',
		'string',
		'object',
		'array',
		'binData',
		'objectId',
		'bool',
		'date',
		'null',
		'regex',
		'javascript',
		'int',
		'timestamp',
		'long',
		'decimal',
		'minKey',
		'maxKey',
	];

	if (validTypes.indexOf(value) === -1) {
		return null;
	}
	return { $type: value };
}

function isJson(item: string) {
	item = typeof item !== 'string' ? JSON.stringify(item) : item;

	try {
		item = JSON.parse(item);
	} catch (e) {
		return false;
	}

	if (typeof item === 'object' && item !== null) {
		return true;
	}

	return false;
}
