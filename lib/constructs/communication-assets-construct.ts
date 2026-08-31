import {
  aws_lambda_event_sources,
  CfnOutput,
  Duration,
  RemovalPolicy,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as S3 from "aws-cdk-lib/aws-s3";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudFront from "aws-cdk-lib/aws-cloudfront";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as IAM from "aws-cdk-lib/aws-iam";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
} from "aws-cdk-lib/custom-resources";
import { CnameRecord } from "aws-cdk-lib/aws-route53";
import * as path from "path";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";

export interface ConstructProps extends StackProps {
  hostedZone: string;
}

export class CommunicationAssetsConstruct extends Construct {
  public readonly cloudFrontDistribution: cloudFront.Distribution;
  public readonly assetsBucket: Bucket;
  constructor(stack: Construct, id: string, props?: ConstructProps) {
    super(stack, id);

    const { hostedZone } = props!;

    const bucket = new S3.Bucket(this, `${id}-communication-assets`, {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.assetsBucket = bucket;

    const privateZone = route53.HostedZone.fromLookup(
      this,
      `${id}-communication-private-hosted-zone`,
      {
        privateZone: true,
        domainName: hostedZone,
      }
    );

    const publicZone = route53.HostedZone.fromLookup(
      this,
      `${id}-communication-public-hosted-zone`,
      {
        privateZone: false,
        domainName: hostedZone,
      }
    );

    const publicCertificate = new certificatemanager.Certificate(
      this,
      `${id}-private-zone-certificate`,
      {
        domainName: `assets.communication.${publicZone.zoneName}`,
        validation:
          certificatemanager.CertificateValidation.fromDns(publicZone),
      }
    );

    const updateTemplateHandler = new lambda.Function(
      this,
      `${id}-update-ses-template-handler`,
      {
        handler: "index.handler",
        description: "Create lambda function for updating SES templates.",
        code: lambda.Code.fromAsset(
          path.join(__dirname, `/../../src/update-ses-template-handler`)
        ),
        runtime: lambda.Runtime.NODEJS_14_X,
        timeout: Duration.seconds(30),
      }
    );

    const s3PutEventSource = new aws_lambda_event_sources.S3EventSource(
      bucket,
      {
        events: [S3.EventType.OBJECT_CREATED_PUT],
      }
    );

    updateTemplateHandler.addEventSource(s3PutEventSource);

    const cloudFrontOAI = new cloudFront.OriginAccessIdentity(
      this,
      `${id}-OAI`,
      {
        comment: `OAI for ${id} website.`,
      }
    );

    const cloudFrontDistProps: cloudFront.DistributionProps = {
      defaultBehavior: { origin: new origins.S3Origin(bucket) },
      domainNames: [`assets.communication.${hostedZone}`],
      certificate: publicCertificate,
    };

    const cloudfrontDist = new cloudFront.Distribution(
      this,
      `${id}-cfd`,
      cloudFrontDistProps
    );

    this.cloudFrontDistribution = cloudfrontDist;

    const cloudfrontS3Access = new IAM.PolicyStatement();
    cloudfrontS3Access.addActions("s3:GetBucket*");
    cloudfrontS3Access.addActions("s3:GetObject*");
    cloudfrontS3Access.addActions("s3:List*");
    cloudfrontS3Access.addResources(bucket.bucketArn);
    cloudfrontS3Access.addResources(`${bucket.bucketArn}/*`);
    cloudfrontS3Access.addPrincipals(cloudFrontOAI.grantPrincipal);

    bucket.addToResourcePolicy(cloudfrontS3Access);

    new route53.ARecord(this, `${id}-communication-cdn-arecord`, {
      zone: privateZone,
      recordName: `assets.communication.${hostedZone}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(cloudfrontDist)
      ),
    });

    new route53.AaaaRecord(this, `${id}-communication-alias-record`, {
      zone: privateZone,
      recordName: `assets.communication.${hostedZone}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(cloudfrontDist)
      ),
    });

    new route53.ARecord(this, `${id}-communication-cdn-public-arecord`, {
      zone: publicZone,
      recordName: `assets.communication.${hostedZone}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(cloudfrontDist)
      ),
    });

    new route53.AaaaRecord(this, `${id}-communication-alias-public-record`, {
      zone: publicZone,
      recordName: `assets.communication.${hostedZone}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(cloudfrontDist)
      ),
    });

    const sesPolicy = new PolicyStatement({
      actions: [
        "ses:CreateConfigurationSet",
        "ses:DeleteConfigurationSet",
        "ses:CreateConfigurationSetEventDestination",
        "ses:DeleteConfigurationSetEventDestination",
        "ses:CreateEmailIdentity",
        "ses:DeleteEmailIdentity",
      ],
      resources: ["*"], // Global is required to Create. Delete could be restricted if required.
      effect: Effect.ALLOW,
    });

    const domainIdentity = new AwsCustomResource(this, `${id}-domainIdentity`, {
      onUpdate: {
        service: "SESV2",
        action: "createEmailIdentity",
        parameters: {
          EmailIdentity: "dev.euler.tools",
        },
        physicalResourceId: {},
      },
      onDelete: {
        service: "SESV2",
        action: "deleteEmailIdentity",
        parameters: {
          EmailIdentity: "dev.euler.tools",
        },
      },
      policy: AwsCustomResourcePolicy.fromStatements([sesPolicy]),
      logRetention: 7,
    });
    // Assuming there are always 3 tokens returned as that is what all the docs indicate
    const dkimTokens = [
      domainIdentity.getResponseField("DkimAttributes.Tokens.0"),
      domainIdentity.getResponseField("DkimAttributes.Tokens.1"),
      domainIdentity.getResponseField("DkimAttributes.Tokens.2"),
    ];

    dkimTokens.forEach((token, i) => {
      const recordName = `${token}._domain.${hostedZone}`;
      if (hostedZone) {
        new CnameRecord(this, `token${i + 1}`, {
          domainName: `${token}.dkim.amazonses.com`,
          zone: publicZone,
          recordName,
          comment: "SES DKIM Verification",
        });
      }

      new CfnOutput(this, `outputToken${i + 1}`, {
        description: `DKIM CNAME Record ${i + 1}`,
        value: `${recordName} CNAME ${token}.dkim.amazonses.com`,
      });
    });

    new CfnOutput(this, `${id}-communication-private-cloudfront-url`, {
      value: cloudfrontDist.distributionDomainName,
    });

    new CfnOutput(this, `${id}-communication-assets-output`, {
      description: "S3 Bucket for platform-communication-assets",
      value: bucket.bucketName,
      exportName: "platform-communication-assets",
    });
  }
}
