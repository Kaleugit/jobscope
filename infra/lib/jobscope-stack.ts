import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
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
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import {
  Distribution,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
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
    });

    // ── Async AI pipeline ───────────────────────────────────────────────
    const analyzeDlq = new Queue(this, "AnalyzeDLQ", {
      retentionPeriod: Duration.days(14),
    });

    const analyzeQueue = new Queue(this, "AnalyzeQueue", {
      visibilityTimeout: Duration.seconds(90),
      deadLetterQueue: { queue: analyzeDlq, maxReceiveCount: 3 },
    });

    const analyzeFn = new NodejsFunction(this, "AnalyzeFn", {
      entry: join(__dirname, "../../api/src/handlers/analyze.ts"),
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
        GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      },
    });
    table.grantReadWriteData(analyzeFn);
    analyzeFn.addEventSource(
      new SqsEventSource(analyzeQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      })
    );

    // ── HTTP API ────────────────────────────────────────────────────────
    const apiFn = new NodejsFunction(this, "ApiFn", {
      entry: join(__dirname, "../../api/src/handlers/applications.ts"),
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        ANALYZE_QUEUE_URL: analyzeQueue.queueUrl,
      },
    });
    table.grantReadWriteData(apiFn);
    analyzeQueue.grantSendMessages(apiFn);

    const httpApi = new HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["Content-Type"],
      },
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", apiFn);
    const routes: [string, HttpMethod][] = [
      ["/applications", HttpMethod.GET],
      ["/applications", HttpMethod.POST],
      ["/applications/{id}", HttpMethod.GET],
      ["/applications/{id}", HttpMethod.PATCH],
      ["/applications/{id}", HttpMethod.DELETE],
      ["/analytics/skills", HttpMethod.GET],
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

    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "WebUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "TableName", { value: table.tableName });
  }
}
