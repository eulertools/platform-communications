import { Fn, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CommunicationAPIConstruct } from "../constructs/communication-api-construct";
import { CommunicationAssetsConstruct } from "../constructs/communication-assets-construct";
import { CommunicationPipelineConstruct } from "../constructs/communication-pipeline-construct";

interface AppStackProps extends StackProps {
  hostedZone: string;
  branchName: string;
}

export class PlatformCommunicationStack extends Stack {
  constructor(scope: Construct, id: string, props?: AppStackProps) {
    super(scope, id, props);

    const { hostedZone, branchName } = props!;

    const certificateArn = Fn.importValue("certificate-private-api");

    const { assetsBucket, cloudFrontDistribution } =
      new CommunicationAssetsConstruct(this, "communication-assets", {
        hostedZone,
      });

    new CommunicationAPIConstruct(this, "communication-api", {
      assetsBucket,
      certificateArn,
      hostedZone,
    });

    new CommunicationPipelineConstruct(this, "communication-pipeline", {
      bucket: assetsBucket,
      cloudfrontDist: cloudFrontDistribution,
      branchName,
    });
  }
}
