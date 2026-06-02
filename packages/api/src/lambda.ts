/**
 * Lambda Handler
 *
 * Wraps the Express app with @vendia/serverless-express for AWS Lambda deployment.
 * API Gateway events are proxied to Express and responses are returned to the client.
 */

import serverlessExpress from '@vendia/serverless-express';
import { app } from './app';

export const handler = serverlessExpress({ app });
