#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PlatformCommunicationsAssetsStack } from "../lib/platform-communications-assets-stack";
import { PlatformCommunicationsApiStack } from "../lib/platform-communications-api-stack";
import { PlatformCommunicationStack } from "../lib/stacks/communication-center-stack";

const app = new cdk.App();

const branch =
  process.env.CDK_DEFAULT_ACCOUNT == process.env.CDK_DEV_ACCOUNT ? "development" : "main";

const hostedZone =
  process.env.CDK_DEFAULT_ACCOUNT == process.env.CDK_DEV_ACCOUNT
    ? "dev.euler.tools"
    : "prod.euler.tools";

new PlatformCommunicationStack(app, "platform-communication-stack", {
  branchName: branch,
  hostedZone,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

new PlatformCommunicationsAssetsStack(app, "platform-communications-assets", {
  hostedZone: hostedZone,
  branch,
  description:
    "Basic assets for the communications center, including the email templates, htmls, and css",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

new PlatformCommunicationsApiStack(
  app,
  "platform-communications-notifications-api",
  {
    hostedZone: hostedZone,
    description:
      "communications API is used to send messages to different system actors",
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  }
);
