export { ddbClient, docClient, TABLE_NAME } from './dynamodb';
export {
  getItem,
  putItem,
  queryItems,
  updateItem,
  deleteItem,
  batchWrite,
  type QueryParams,
  type QueryResult,
  type BatchWriteOperation,
} from './base-repository';
export {
  userPK,
  userProfileSK,
  fileSK,
  folderSK,
  sharePK,
  shareSK,
  versionSK,
  commentSK,
  gsi1Keys,
  gsi2Keys,
  gsi3Keys,
} from './key-builders';
