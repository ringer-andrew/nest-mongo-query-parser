export class MongoQueryModel {
  limit!: number;
  skip!: number;
  sort!: QueryObjectModel;
  select!: QueryObjectModel;
  filter!: QueryObjectModel;
  populate!: QueryObjectModel | QueryObjectModel[];
}

export class QueryObjectModel {
  [key: string]: string | number | Date | any;
}

/**
 * Attribute fields to ignore when copying, modifying documents/subdocuments
 */
export const DOCUMENT_IGNORE_FIELDS = ['_id', '_key', '_new', '_deleted', '_created_user', '_created_date', '_last_updated_user', '_last_updated_date'];

/**
 * Attribute fields to ignore when validating documents/subdocuments
 */
export const DOCUMENT_SKIP_FIELDS =  ['_created_user', '_created_date', '_last_updated_user', '_last_updated_date'];

