import {
  aws_lambda_event_sources,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as S3 from 'aws-cdk-lib/aws-s3';
import * as Codebuild from 'aws-cdk-lib/aws-codebuild';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudFront from 'aws-cdk-lib/aws-cloudfront';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import {
  CodeBuildAction,
  GitHubSourceAction,
} from 'aws-cdk-lib/aws-codepipeline-actions';
import { LinuxBuildImage, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import * as IAM from 'aws-cdk-lib/aws-iam';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
} from 'aws-cdk-lib/custom-resources';
import { CnameRecord } from 'aws-cdk-lib/aws-route53';
import * as path from "path";
import * as lambda from "aws-cdk-lib/aws-lambda";
interface AppStackProps extends StackProps {
  hostedZone: string;
  branch: string;
}

export class PlatformCommunicationsAssetsStack extends Stack {
  constructor(scope: Construct, id: string, props?: AppStackProps) {
    super(scope, id, props);

    const { hostedZone, branch } = props!;

    const bucketName = Fn.importValue('artifact-bucket');

    const artifactBucket = s3.Bucket.fromBucketName(
      this,
      's3-bucket',
      bucketName
    );

    const bucket = new S3.Bucket(this, 'platform-communications-assets', {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const privateZone = route53.HostedZone.fromLookup(
      this,
      'platform-communications-private-hosted-zone',
      {
        privateZone: true,
        domainName: hostedZone,
      }
    );

    const publicZone = route53.HostedZone.fromLookup(
      this,
      'platform-communications-public-hosted-zone',
      {
        privateZone: false,
        domainName: hostedZone,
      }
    );

    const publicCertificate = new certificatemanager.Certificate(this, 'private-zone-certificate', {
      domainName: `assets.communications.${publicZone.zoneName}`,
      validation: certificatemanager.CertificateValidation.fromDns(publicZone),
    });

    const updateTemplateHandler = new lambda.Function(
      this,
      "update-ses-template-handler",
      {
        handler: "index.handler",
        description: "Create lambda function for updating SES templates.",
        code: lambda.Code.fromAsset(path.join(
          __dirname,
          `/../src/update-ses-template-handler`
        )),
        runtime: lambda.Runtime.NODEJS_14_X,
        timeout: Duration.seconds(30),
      }
    );

    const s3PutEventSource = new aws_lambda_event_sources.S3EventSource(bucket, {
      events: [
        s3.EventType.OBJECT_CREATED_PUT
      ]
    });

    updateTemplateHandler.addEventSource(s3PutEventSource);

    const cloudFrontOAI = new cloudFront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for ${this.stackName} website.`,
    });

    const cloudFrontDistProps: cloudFront.DistributionProps = {
      defaultBehavior: { origin: new origins.S3Origin(bucket) },
      domainNames: [`assets.communications.${hostedZone}`],
      certificate: publicCertificate,
    };

    const cloudfrontDist = new cloudFront.Distribution(
      this,
      `${this.stackName}-cfd`,
      cloudFrontDistProps
    );

    const cloudfrontS3Access = new IAM.PolicyStatement();
    cloudfrontS3Access.addActions('s3:GetBucket*');
    cloudfrontS3Access.addActions('s3:GetObject*');
    cloudfrontS3Access.addActions('s3:List*');
    cloudfrontS3Access.addResources(bucket.bucketArn);
    cloudfrontS3Access.addResources(`${bucket.bucketArn}/*`);
    cloudfrontS3Access.addPrincipals(cloudFrontOAI.grantPrincipal);

    bucket.addToResourcePolicy(cloudfrontS3Access);

    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    const githubSourceAction = new GitHubSourceAction({
      actionName: 'Github-Commit-Source-Action',
      output: sourceOutput,
      owner: 'eulertools',
      repo: 'platform-communications',
      branch,
      oauthToken: SecretValue.secretsManager('githubToken'),
    });

    const project = new PipelineProject(this, `${this.stackName}-build`, {
      buildSpec: Codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: ['echo Install Phase Started...'],
          },
          pre_build: {
            commands: ['echo Started Pre Build `date`'],
          },
          build: {
            commands: [
              'echo Entering into Build Stage',
              'echo Build Started',
              'aws s3 cp --recursive ./assets s3://${S3_BUCKET}',
              'aws cloudfront create-invalidation --distribution-id ${CLOUDFRONT_DIST_ID} --paths "/"',
              'echo Build completed',
            ],
          },
          post_build: {
            commands: ['echo Build Completed on `date`'],
          },
        },
      }),
      projectName: `${this.stackName}-build`,
      environment: {
        buildImage: LinuxBuildImage.STANDARD_5_0,
        privileged: true,
      },
      environmentVariables: {
        S3_BUCKET: {
          value: bucket.bucketName,
        },
        CLOUDFRONT_DIST_ID: {
          value: cloudfrontDist.distributionId,
        },
      },
      timeout: Duration.minutes(20),
    });

    const buildAction = new CodeBuildAction({
      actionName: 'Code-Build-Action',
      input: sourceOutput,
      project: project,
      outputs: [buildOutput],
    });

    project.addToRolePolicy(
      new IAM.PolicyStatement({
        effect: IAM.Effect.ALLOW,
        resources: [bucket.bucketArn, `${bucket.bucketArn}/*`, '*'],
        actions: [
          's3:GetBucket*',
          's3:List*',
          's3:GetObject*',
          's3:DeleteObject',
          's3:PutObject',
          'cloudfront:CreateInvalidation',
          'cloudfront:GetDistribution*',
          'cloudfront:GetInvalidation',
          'cloudfront:ListInvalidations',
          'cloudfront:ListDistributions',
          'codebuild:StartBuild'
        ],
      })
    );

    new codepipeline.Pipeline(this, `${this.stackName}-CodePipeline`, {
      pipelineName: `${this.stackName}-pipeline`,
      stages: [
        {
          stageName: 'Source',
          actions: [githubSourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        },
      ],
      artifactBucket: artifactBucket,
    });

    new route53.ARecord(this, 'platform-communications-cdn-arecord', {
      zone: privateZone,
      recordName: `assets.communications.${hostedZone}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(cloudfrontDist)
      ),
    });

    new route53.AaaaRecord(this, 'platform-communications-alias-record', {
      zone: privateZone,
      recordName: `assets.communications.${hostedZone}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(cloudfrontDist)
      ),
    });

    new route53.ARecord(this, 'platform-communications-cdn-public-arecord', {
      zone: publicZone,
      recordName: `assets.communications.${hostedZone}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(cloudfrontDist)
      ),
    });

    new route53.AaaaRecord(this, 'platform-communications-alias-public-record', {
      zone: publicZone,
      recordName: `assets.communications.${hostedZone}`,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(cloudfrontDist)
      ),
    });

    const sesPolicy = new PolicyStatement({
      actions: [
        'ses:CreateConfigurationSet',
        'ses:DeleteConfigurationSet',
        'ses:CreateConfigurationSetEventDestination',
        'ses:DeleteConfigurationSetEventDestination',
        'ses:CreateEmailIdentity',
        'ses:DeleteEmailIdentity',
      ],
      resources: ['*'], // Global is required to Create. Delete could be restricted if required.
      effect: Effect.ALLOW,
    });

    const domainIdentity = new AwsCustomResource(this, 'domainIdentity', {
      onUpdate: {
        service: 'SESV2',
        action: 'createEmailIdentity',
        parameters: {
          EmailIdentity: hostedZone,
        },
        physicalResourceId: {},
      },
      onDelete: {
        service: 'SESV2',
        action: 'deleteEmailIdentity',
        parameters: {
          EmailIdentity: hostedZone,
        },
      },
      policy: AwsCustomResourcePolicy.fromStatements([sesPolicy]),
      logRetention: 7,
    });
    // Assuming there are always 3 tokens returned as that is what all the docs indicate
    const dkimTokens = [
      domainIdentity.getResponseField('DkimAttributes.Tokens.0'),
      domainIdentity.getResponseField('DkimAttributes.Tokens.1'),
      domainIdentity.getResponseField('DkimAttributes.Tokens.2'),
    ];

    dkimTokens.forEach((token, i) => {
      const recordName = `${token}._domainkey.${hostedZone}`;
      if (hostedZone) {
        new CnameRecord(this, `token${i + 1}`, {
          domainName: `${token}.dkim.amazonses.com`,
          zone: publicZone,
          recordName,
          comment: 'SES DKIM Verification',
        });
      }

      new CfnOutput(this, `outputToken${i + 1}`, {
        description: `DKIM CNAME Record ${i + 1}`,
        value: `${recordName} CNAME ${token}.dkim.amazonses.com`,
      });
    });

    new CfnOutput(this, 'platform-communications-private-cloudfront-url', {
      value: cloudfrontDist.distributionDomainName,
    });

    new CfnOutput(this, 'platform-communications-assets-output', {
      description: 'S3 Bucket for platform-communications-assets',
      value: bucket.bucketName,
      exportName: 'platform-communications-assets-bucket',
    });
  }
}
