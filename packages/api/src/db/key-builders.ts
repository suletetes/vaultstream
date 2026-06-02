/**
 * DynamoDB Key Builders
 *
 * Constructs PK/SK/GSI keys following the single-table design.
 * Entity-type prefixes: USER#, FILE#, FOLDER#, SHARE#, VERSION#, COMMENT#, PROFILE#
 */

// ─── Primary Key Builders ───────────────────────────────────────────────────

/** PK for user-owned entities (files, folders, profile) */
export function userPK(userId: string): `USER#${string}` {
  return `USER#${userId}`;
}

/** SK for user profile */
export function userProfileSK(userId: string): `PROFILE#${string}` {
  return `PROFILE#${userId}`;
}

/** SK for a file entity */
export function fileSK(fileId: string): `FILE#${string}` {
  return `FILE#${fileId}`;
}

/** SK for a folder entity */
export function folderSK(folderId: string): `FOLDER#${string}` {
  return `FOLDER#${folderId}`;
}

/** PK for share and version entities (keyed by file) */
export function sharePK(fileId: string): `FILE#${string}` {
  return `FILE#${fileId}`;
}

/** SK for a share entity */
export function shareSK(targetUserId: string): `SHARE#${string}` {
  return `SHARE#${targetUserId}`;
}

/** SK for a file version entity */
export function versionSK(versionNumber: number): `VERSION#${string}` {
  return `VERSION#${String(versionNumber).padStart(5, '0')}`;
}

/** SK for a comment entity */
export function commentSK(commentId: string): `COMMENT#${string}` {
  return `COMMENT#${commentId}`;
}

// ─── GSI Key Builders ───────────────────────────────────────────────────────

/**
 * GSI1: Recently accessed files per user.
 * GSI1PK = USER#{userId}, GSI1SK = lastAccessedAt (ISO8601)
 */
export function gsi1Keys(
  userId: string,
  lastAccessedAt: string,
): { GSI1PK: `USER#${string}`; GSI1SK: string } {
  return {
    GSI1PK: `USER#${userId}`,
    GSI1SK: lastAccessedAt,
  };
}

/**
 * GSI2: Folder contents sorted by name.
 * GSI2PK = FOLDER#{folderId}, GSI2SK = name (filename or folderName)
 */
export function gsi2Keys(
  folderId: string,
  name: string,
): { GSI2PK: `FOLDER#${string}`; GSI2SK: string } {
  return {
    GSI2PK: `FOLDER#${folderId}`,
    GSI2SK: name,
  };
}

/**
 * GSI3: Shared-with-me view sorted by share date.
 * GSI3PK = USER#{targetUserId}, GSI3SK = sharedAt (ISO8601)
 */
export function gsi3Keys(
  targetUserId: string,
  sharedAt: string,
): { GSI3PK: `USER#${string}`; GSI3SK: string } {
  return {
    GSI3PK: `USER#${targetUserId}`,
    GSI3SK: sharedAt,
  };
}
