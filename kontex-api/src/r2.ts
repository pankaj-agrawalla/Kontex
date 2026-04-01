import { S3Client } from "@aws-sdk/client-s3";
import { config } from "./config";

export const r2 = new S3Client({
  endpoint: config.R2_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  },
});

export const R2_BUCKET = config.R2_BUCKET_NAME;
