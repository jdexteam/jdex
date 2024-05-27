import { TSchema } from "@sinclair/typebox";
import { TypeCheck, TypeCompiler } from "@sinclair/typebox/compiler";
// Local
import { SchemaDetails, SchemaInfo, SchemaProvider } from "@/types";

// TODO: Look at kysely-org/kysely table-parser and type utils for betterment...

type TDetails = SchemaDetails<TSchema>;

export class TypeboxSchemaProvider<DB> implements SchemaProvider<DB, TSchema> {
  private _byName = new Map<keyof DB & string, SchemaInfo<DB, TSchema>>();
  private _compiled = new Map<keyof DB & string, TypeCheck<TSchema>>();

  // get<ST extends keyof DB & string>(name: ST): TSchema | undefined {
  //   return this._byName.get(name);
  // }
  get(name: keyof DB & string): SchemaInfo<DB, TSchema> | undefined {
    const { _byName } = this;
    return _byName.get(name);
  }
  set(name: keyof DB & string, details: TDetails) {
    const { _byName } = this;
    _byName.set(name, {
      name,
      ...details,
    });
  }
  setAll(byName: { [P in keyof DB]?: TDetails }) {
    const { _byName } = this;
    for (const name in byName) {
      const details = byName[name];
      if (details) {
        _byName.set(name, {
          name,
          ...details,
        });
      }
    }
  }
  validate(name: keyof DB & string, value: unknown) {
    const { _byName, _compiled } = this;
    let compiler = _compiled.get(name);
    if (!compiler) {
      // Compile and store
      const entry = _byName.get(name);
      if (!entry) {
        return false;
      }
      const { schema } = entry;
      if (!schema) {
        return false;
      }
      compiler = TypeCompiler.Compile(schema);
      _compiled.set(name, compiler);
    }
    // CONSIDER: We are losing the type narrowing of Check here...
    return compiler.Check(value);
  }
}
