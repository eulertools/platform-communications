import { Duration, Fn, SecretValue, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as Codebuild from "aws-cdk-lib/aws-codebuild";
import * as cloudFront from "aws-cdk-lib/aws-cloudfront";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import {
  CodeBuildAction,
  GitHubSourceAction,
} from "aws-cdk-lib/aws-codepipeline-actions";
import { LinuxBuildImage, PipelineProject } from "aws-cdk-lib/aws-codebuild";
import * as IAM from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Bucket } from "aws-cdk-lib/aws-s3";

export interface ConstructProps extends StackProps {
  bucket: Bucket;
  cloudfrontDist: cloudFront.Distribution;
  branchName: string;
}

export class CommunicationPipelineConstruct extends Construct {
  constructor(stack: Construct, id: string, props?: ConstructProps) {
    super(stack, id);
    const { bucket, cloudfrontDist, branchName } = props!;

    const artifactBucketName = Fn.importValue("artifact-bucket");

    const artifactBucket = s3.Bucket.fromBucketName(
      this,
      `$id}-s3-bucket`,
      artifactBucketName
    );

    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    const githubSourceAction = new GitHubSourceAction({
      actionName: "Github-Commit-Source-Action",
      output: sourceOutput,
      owner: "eulertools",
      repo: "platform-communications",
      branch: branchName,
      oauthToken: SecretValue.secretsManager("githubToken"),
    });

    const project = new PipelineProject(this, `${id}-build`, {
      buildSpec: Codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: ["echo Install Phase Started..."],
          },
          pre_build: {
            commands: ["echo Started Pre Build `date`"],
          },
          build: {
            commands: [
              "echo Entering into Build Stage",
              "echo Build Started",
              "aws s3 cp --recursive ./assets s3://${S3_BUCKET}",
              'aws cloudfront create-invalidation --distribution-id ${CLOUDFRONT_DIST_ID} --paths "/"',
              "echo Build completed",
            ],
          },
          post_build: {
            commands: ["echo Build Completed on `date`"],
          },
        },
      }),
      projectName: `${id}-build`,
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
      actionName: "Code-Build-Action",
      input: sourceOutput,
      project: project,
      outputs: [buildOutput],
    });

    project.addToRolePolicy(
      new IAM.PolicyStatement({
        effect: IAM.Effect.ALLOW,
        resources: [bucket.bucketArn, `${bucket.bucketArn}/*`, "*"],
        actions: [
          "s3:GetBucket*",
          "s3:List*",
          "s3:GetObject*",
          "s3:DeleteObject",
          "s3:PutObject",
          "cloudfront:CreateInvalidation",
          "cloudfront:GetDistribution*",
          "cloudfront:GetInvalidation",
          "cloudfront:ListInvalidations",
          "cloudfront:ListDistributions",
          "codebuild:StartBuild",
        ],
      })
    );

    new codepipeline.Pipeline(this, `${id}-CodePipeline`, {
      pipelineName: `${id}-pipeline`,
      stages: [
        {
          stageName: "Source",
          actions: [githubSourceAction],
        },
        {
          stageName: "Build",
          actions: [buildAction],
        },
      ],
      artifactBucket: artifactBucket,
    });
  }
}
