import { fingerprint } from './canonical';

export function scanRequestFingerprint(input: {
  manifestId: string;
  authorizationRevision: number;
  sourceIds: string[];
  sourceContentHashes: string[];
}): string {
  return fingerprint({
    manifestId: input.manifestId,
    authorizationRevision: input.authorizationRevision,
    sourceIds: input.sourceIds,
    sourceContentHashes: input.sourceContentHashes,
  });
}
