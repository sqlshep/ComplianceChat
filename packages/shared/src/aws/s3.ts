import {
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import type { AppConfig } from "../config";
import type { AwsClients } from "./clients";

/** Upload source bytes; returns the S3 versionId (bucket has versioning enabled). */
export async function putSource(
  clients: AwsClients,
  cfg: AppConfig,
  key: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
): Promise<{ uri: string; versionId: string }> {
  const res = await clients.s3.send(
    new PutObjectCommand({
      Bucket: cfg.s3.sourceBucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
  return {
    uri: `s3://${cfg.s3.sourceBucket}/${key}`,
    versionId: res.VersionId ?? "null",
  };
}

export async function putJson(
  clients: AwsClients,
  bucket: string,
  key: string,
  value: unknown,
): Promise<{ uri: string; versionId: string }> {
  const res = await clients.s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: "application/json",
    }),
  );
  return { uri: `s3://${bucket}/${key}`, versionId: res.VersionId ?? "null" };
}

export async function getJson<T>(
  clients: AwsClients,
  bucket: string,
  key: string,
): Promise<T> {
  const res = await clients.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await res.Body!.transformToString();
  return JSON.parse(body) as T;
}

export async function bucketReachable(
  clients: AwsClients,
  bucket: string,
): Promise<boolean> {
  await clients.s3.send(new HeadBucketCommand({ Bucket: bucket }));
  return true;
}
