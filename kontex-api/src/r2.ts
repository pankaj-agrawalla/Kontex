import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { config } from "./config";

export const r2 = new S3Client({
  endpoint: config.R2_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 10000,
  }),
});

export const R2_BUCKET = config.R2_BUCKET_NAME;
