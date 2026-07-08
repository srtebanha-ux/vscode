import ajv2020 from 'ajv/dist/2020.js';
import type { SchemaObject, ValidateFunction } from 'ajv';

// ajv ships CJS with a `default` property; unwrap it under NodeNext ESM.
const Ajv2020 = ajv2020.default;

// allowUnionTypes: templateVars values are string|number|boolean by design.
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });

export function compileSchema<T>(schema: SchemaObject): ValidateFunction<T> {
	return ajv.compile<T>(schema);
}

export function schemaErrors(validate: ValidateFunction<unknown>): readonly string[] {
	return (validate.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
}
