import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  TimeZone,
  type StackProps,
} from "aws-cdk-lib";
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { BlockPublicAccess, Bucket, HttpMethods } from "aws-cdk-lib/aws-s3";
import {
  Distribution,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import {
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { existsSync } from "node:fs";
import { join } from "node:path";

export class JobscopeStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ── Data ────────────────────────────────────────────────────────────
    const table = new Table(this, "Applications", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // portfolio project: allow clean teardown
      // Discovery retention: items with "ttl" (epoch seconds) are deleted by
      // DynamoDB for free. App items never set it, so nothing else expires.
      timeToLiveAttribute: "ttl",
    });

    // Discovery panel lists jobs by age: gsi1pk = DISC#JOBS, gsi1sk = <publishedAt>#<jobKey>.
    // Job items are small (the description lives in its own item), so ALL costs little.
    table.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // Resumes are uploaded straight from the browser with a presigned URL,
    // so the file never passes through API Gateway's payload limit.
    const resumeBucket = new Bucket(this, "ResumeBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
    });

    // ── Async AI pipeline ───────────────────────────────────────────────
    const analyzeDlq = new Queue(this, "AnalyzeDLQ", {
      retentionPeriod: Duration.days(14),
    });

    // Document generation runs a generate, check, correct loop, so the queue
    // has to wait much longer than a single extraction call.
    const analyzeQueue = new Queue(this, "AnalyzeQueue", {
      visibilityTimeout: Duration.seconds(360),
      deadLetterQueue: { queue: analyzeDlq, maxReceiveCount: 3 },
    });

    const analyzeFn = new NodejsFunction(this, "AnalyzeFn", {
      entry: join(__dirname, "../../api/src/handlers/analyze.ts"),
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(300),
      memorySize: 512,
      environment: {
        TABLE_NAME: table.tableName,
        RESUME_BUCKET: resumeBucket.bucketName,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
        GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
      },
    });
    table.grantReadWriteData(analyzeFn);
    resumeBucket.grantRead(analyzeFn);
    analyzeFn.addEventSource(
      new SqsEventSource(analyzeQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      })
    );

    // ── Discovery: job collection, filters, Gemini, alert ───────────────
    // One run per schedule; a DynamoDB lease keeps runs from overlapping.
    const discoveryFn = new NodejsFunction(this, "DiscoveryFn", {
      entry: join(__dirname, "../../api/src/handlers/discovery.ts"),
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(15),
      memorySize: 512,
      // An async retry would only re-run a whole collection; the next schedule does that.
      retryAttempts: 0,
      environment: {
        TABLE_NAME: table.tableName,
        HIMALAYAS_API_KEY: process.env.HIMALAYAS_API_KEY ?? "",
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
        // Its own model: free-tier quotas are per model, so the demo keeps its quota.
        GEMINI_DISCOVERY_MODEL: process.env.GEMINI_DISCOVERY_MODEL ?? "gemini-3.5-flash-lite",
        DISCOVERY_MAX_LLM_CALLS: process.env.DISCOVERY_MAX_LLM_CALLS ?? "15",
        DISCOVERY_LLM_INTERVAL_MS: process.env.DISCOVERY_LLM_INTERVAL_MS ?? "10000",
        DISCOVERY_THINKING_LEVEL: process.env.DISCOVERY_THINKING_LEVEL ?? "low",
      },
    });
    table.grantReadWriteData(discoveryFn);
    // SES in sandbox: it can only send to verified identities, i.e. the owner.
    discoveryFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail", "ses:CreateEmailIdentity", "ses:GetEmailIdentity"],
        resources: ["*"],
      })
    );

    // 07:00 so the night's jobs are ready on waking; 13:00 for what US
    // companies post in their morning. Brazil time, DST-proof.
    for (const [id, hour] of [["DiscoveryMorning", "7"], ["DiscoveryAfternoon", "13"]] as const) {
      new Schedule(this, id, {
        schedule: ScheduleExpression.cron({ minute: "0", hour, timeZone: TimeZone.AMERICA_SAO_PAULO }),
        target: new LambdaInvoke(discoveryFn, {
          input: ScheduleTargetInput.fromObject({ trigger: "schedule" }),
          retryAttempts: 0,
        }),
        description: `Job discovery run at ${hour}:00 America/Sao_Paulo`,
      });
    }

    // ── HTTP API ────────────────────────────────────────────────────────
    const apiFn = new NodejsFunction(this, "ApiFn", {
      entry: join(__dirname, "../../api/src/handlers/applications.ts"),
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        ANALYZE_QUEUE_URL: analyzeQueue.queueUrl,
        RESUME_BUCKET: resumeBucket.bucketName,
        TOKEN_SECRET: process.env.TOKEN_SECRET ?? "",
      },
    });
    table.grantReadWriteData(apiFn);
    apiFn.addEnvironment("DISCOVERY_FN_NAME", discoveryFn.functionName);
    discoveryFn.grantInvoke(apiFn);
    analyzeQueue.grantSendMessages(apiFn);
    resumeBucket.grantReadWrite(apiFn);
    resumeBucket.grantDelete(apiFn);

    const httpApi = new HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", apiFn);
    const routes: [string, HttpMethod][] = [
      ["/auth/login", HttpMethod.POST],
      ["/auth/me", HttpMethod.GET],
      ["/auth/accounts", HttpMethod.GET],
      ["/auth/accounts", HttpMethod.POST],
      ["/auth/accounts/{username}", HttpMethod.DELETE],
      ["/applications", HttpMethod.GET],
      ["/applications", HttpMethod.POST],
      ["/applications/{id}", HttpMethod.GET],
      ["/applications/{id}", HttpMethod.PATCH],
      ["/applications/{id}", HttpMethod.DELETE],
      // "/analytics/*" would be blocked by ad-blocker filter lists (ERR_BLOCKED_BY_CLIENT)
      ["/skills/summary", HttpMethod.GET],
      ["/profile", HttpMethod.GET],
      ["/profile", HttpMethod.DELETE],
      ["/profile/upload-url", HttpMethod.POST],
      ["/profile/analyze", HttpMethod.POST],
      ["/master", HttpMethod.GET],
      ["/master", HttpMethod.PUT],
      ["/master/{market}", HttpMethod.DELETE],
      ["/docs", HttpMethod.GET],
      ["/docs", HttpMethod.POST],
      ["/docs/{id}", HttpMethod.DELETE],
      // Owner Area (master account only, checked in the handler)
      ["/discovery/run", HttpMethod.POST],
      ["/discovery/jobs", HttpMethod.GET],
      ["/discovery/jobs/{key}", HttpMethod.GET],
      ["/discovery/jobs/{key}", HttpMethod.DELETE],
      ["/discovery/jobs/{key}/promote", HttpMethod.POST],
      ["/discovery/runs", HttpMethod.GET],
      ["/discovery/settings", HttpMethod.GET],
      ["/discovery/settings", HttpMethod.PUT],
      ["/discovery/companies", HttpMethod.GET],
      ["/discovery/companies", HttpMethod.POST],
      ["/discovery/companies/{ats}/{token}", HttpMethod.PATCH],
    ];
    for (const [path, method] of routes) {
      httpApi.addRoutes({ path, methods: [method], integration });
    }

    // ── Frontend hosting (S3 + CloudFront) ──────────────────────────────
    const webBucket = new Bucket(this, "WebBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new Distribution(this, "WebDistribution", {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      // SPA: route everything back to index.html
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    discoveryFn.addEnvironment("PANEL_URL", `https://${distribution.distributionDomainName}/#/discovery`);

    // Deploy the built frontend when web/dist exists (run `npm run build -w web` first).
    const webDist = join(__dirname, "../../web/dist");
    if (existsSync(webDist)) {
      new BucketDeployment(this, "WebDeployment", {
        sources: [Source.asset(webDist)],
        destinationBucket: webBucket,
        distribution,
        distributionPaths: ["/*"],
      });
    }

    // ── CI/CD: GitHub Actions deploys via OIDC (no stored access keys) ──
    const githubOidc = new OpenIdConnectProvider(this, "GithubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const githubDeployRole = new Role(this, "GithubDeployRole", {
      assumedBy: new WebIdentityPrincipal(
        githubOidc.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          },
          StringLike: {
            // GitHub's sub claim embeds immutable owner/repo IDs
            // (see repos/{owner}/{repo}/actions/oidc/customization/sub)
            "token.actions.githubusercontent.com:sub":
              "repo:Kaleugit@54084311/jobscope@1340924790:*",
          },
        }
      ),
      description: "Assumed by GitHub Actions to run cdk deploy",
    });
    // CDK deploys by assuming the cdk-* bootstrap roles; that's all CI needs.
    githubDeployRole.addToPolicy(
      new PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      })
    );

    new CfnOutput(this, "GithubDeployRoleArn", {
      value: githubDeployRole.roleArn,
    });
    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "WebUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "TableName", { value: table.tableName });
  }
}
