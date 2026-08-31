import { Duration, Fn, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cert from "aws-cdk-lib/aws-certificatemanager";
import { Effect } from "aws-cdk-lib/aws-iam";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import {
  Cors,
  LambdaIntegration,
  LambdaRestApi,
} from "aws-cdk-lib/aws-apigateway";

interface AppStackProps extends StackProps {
  hostedZone: string;
}

export class PlatformCommunicationsApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: AppStackProps) {
    super(scope, id, props);

    const { hostedZone } = props!;

    const bucketName = Fn.importValue("platform-communications-assets-bucket");

    const bucket = s3.Bucket.fromBucketName(this, "s3-bucket", bucketName);

    const certificateArn = Fn.importValue(
      "certificate-private-api"
    );

    const certificate = cert.Certificate.fromCertificateArn(
      this,
      "api-gateway-cert",
      certificateArn
    );

    const templateHandler = new lambda.Function(
      this,
      "create-ses-template-handler",
      {
        handler: "index.handler",
        description: "Create lambda function for creating SES templates.",
        code: lambda.Code.fromAsset(path.join(
          __dirname,
          `/../src/create-ses-template-handler`
        )),
        runtime: lambda.Runtime.NODEJS_14_X,
        timeout: Duration.seconds(30),
        environment: {
          BUCKET_NAME: bucket.bucketName,
        },
      }
    );

    templateHandler.grantInvoke(
      new iam.ServicePrincipal("apigateway.amazonaws.com")
    );

    templateHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: ["*"],
        actions: [
					"ses:*",
					"s3:*"
				],
      })
    );

    const privateZone = route53.HostedZone.fromLookup(
      this,
      "private-hosted-zone",
      {
        privateZone: true,
        domainName: hostedZone,
      }
    );

    const apiResourcePolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["execute-api:Invoke"],
          principals: [new iam.AnyPrincipal()],
          resources: ["execute-api:/*"],
        }),
      ],
    });

    const restApi = new LambdaRestApi(this, `app-ses-template-api`, {
      handler: templateHandler,
      description: "Communications Hub API handles all messages sent to users, with their templates, methods and rules",
      restApiName: "communications-hub-api",
      deployOptions: {
        stageName: process.env.ENV,
      },
      defaultCorsPreflightOptions: {
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        allowCredentials: true,
        allowOrigins: Cors.ALL_ORIGINS,
      },
      proxy: false,
      policy: apiResourcePolicy,
    });

    restApi.addDomainName("ses-template-api", {
      domainName: `communications.api.${hostedZone}`,
      certificate: certificate,
    });

    new route53.ARecord(this, "custom-domain-alias-record-ses-template", {
      recordName: "communications.api",
      zone: privateZone,
      target: route53.RecordTarget.fromAlias(
        new route53targets.ApiGateway(restApi)
      ),
    });

    const template = restApi.root;

    template.addMethod("PUT", new LambdaIntegration(templateHandler));
  }
}
