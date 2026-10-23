import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import type { AppConfig } from "../config";

/**
 * All clients honor the configured profile via the AWS default credential
 * provider chain (so `aws sso login --profile <profile>` works). No static keys.
 */
export interface AwsClients {
  s3: S3Client;
  ddb: DynamoDBDocumentClient;
  bedrock: BedrockRuntimeClient;
  opensearch: OpenSearchClient;
}

export function makeClients(cfg: AppConfig): AwsClients {
  const credentials = defaultProvider({ profile: cfg.profile });
  const region = cfg.region;

  const s3 = new S3Client({ region, credentials });

  const ddbBase = new DynamoDBClient({ region, credentials });
  const ddb = DynamoDBDocumentClient.from(ddbBase, {
    marshallOptions: { removeUndefinedValues: true },
  });

  const bedrock = new BedrockRuntimeClient({ region, credentials });

  const opensearch = new OpenSearchClient({
    ...AwsSigv4Signer({
      region,
      // OpenSearch Serverless signs with the "aoss" service name.
      service: "aoss",
      getCredentials: () => credentials(),
    }),
    node: cfg.aoss.endpoint,
  });

  return { s3, ddb, bedrock, opensearch };
}
