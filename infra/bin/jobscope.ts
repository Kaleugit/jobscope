import { App } from "aws-cdk-lib";
import { JobscopeStack } from "../lib/jobscope-stack";

const app = new App();

new JobscopeStack(app, "JobscopeStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
});
