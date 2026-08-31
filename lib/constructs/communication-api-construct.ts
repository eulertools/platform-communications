import { aws_route53_targets, Duration, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cert from "aws-cdk-lib/aws-certificatemanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Effect } from "aws-cdk-lib/aws-iam";
import {
  Cors,
  LambdaIntegration,
  LambdaRestApi,
} from "aws-cdk-lib/aws-apigateway";
import { Bucket } from "aws-cdk-lib/aws-s3";

export interface ConstructProps extends StackProps {
  assetsBucket: Bucket;
  certificateArn: string;
  hostedZone: string;
}

export class CommunicationAPIConstruct extends Construct {
  constructor(stack: Construct, id: string, props?: ConstructProps) {
    super(stack, id);
    const { assetsBucket, certificateArn, hostedZone } = props!;

    const certificate = cert.Certificate.fromCertificateArn(
      this,
      `${id}-api-gateway-cert`,
      certificateArn
    );

    const templateHandler = new lambda.Function(
      this,
      `${id}-ses-template-handler`,
      {
        handler: "index.handler",
        description: "Create lambda function for creating SES templates.",
        code: lambda.Code.fromAsset(
          path.join(__dirname, `/../../src/create-ses-template-handler`)
        ),
        runtime: lambda.Runtime.NODEJS_14_X,
        timeout: Duration.seconds(30),
        environment: {
          BUCKET_NAME: assetsBucket.bucketName,
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
        actions: ["ses:*", "s3:*"],
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

    const restApi = new LambdaRestApi(this, `${id}-ses-template-api`, {
      handler: templateHandler,
      description:
        "Communications Hub API handles all messages sent to users, with their templates, methods and rules",
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

    restApi.addDomainName(`${id}-ses-template-api`, {
      domainName: `communication.api.${hostedZone}`,
      certificate: certificate,
    });

    new route53.ARecord(this, `${id}-alias-record-ses-template`, {
      recordName: "communication.api",
      zone: privateZone,
      target: route53.RecordTarget.fromAlias(
        new aws_route53_targets.ApiGateway(restApi)
      ),
    });

    const template = restApi.root;

    template.addMethod("PUT", new LambdaIntegration(templateHandler));
  }
}
