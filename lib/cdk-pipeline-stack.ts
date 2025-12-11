import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class CdkPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 既存のCodeCommitリポジトリを参照
    const repository = codecommit.Repository.fromRepositoryName(
      this,
      'CdkLambdaLayerRepo',
      'cdk-lambda-layer'
    );

    // パイプラインのアーティファクト用S3バケット
    const artifactBucket = new s3.Bucket(this, 'PipelineArtifactBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // ソースアーティファクト
    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    // ソースアクション
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit_Source',
      repository: repository,
      branch: 'master',
      output: sourceOutput,
      trigger: codepipeline_actions.CodeCommitTrigger.EVENTS,
    });

    // Lambda関数更新用のCodeBuildプロジェクト
    const lambdaBuildProject = new codebuild.PipelineProject(this, 'LambdaBuildProject', {
      projectName: 'UpdateLambdaFunctions',
      description: 'lambdaフォルダ内のLambda関数を更新',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '18',
            },
          },
          build: {
            commands: [
              'echo "Lambda関数の更新を開始"',
              'cd lambda',
              'for dir in $(find . -type f -name "index.js" -exec dirname {} \\; | sort); do FUNCTION_BASE=$(basename $dir); FUNCTION_NAME="${FUNCTION_BASE}Function"; echo "Updating Lambda function: $FUNCTION_NAME from directory: $dir"; CURRENT_DIR=$(pwd); cd $dir; zip -r /tmp/${FUNCTION_BASE}.zip . -x "*.git*"; if aws lambda update-function-code --function-name $FUNCTION_NAME --zip-file fileb:///tmp/${FUNCTION_BASE}.zip; then echo "Successfully updated: $FUNCTION_NAME"; else echo "Failed to update: $FUNCTION_NAME"; fi; cd $CURRENT_DIR; done',
              'echo "Lambda関数の更新完了"',
            ],
          },
        },
      }),
    });

    // Lambda関数更新のための権限
    lambdaBuildProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:UpdateFunctionCode',
        'lambda:GetFunction',
        'lambda:ListFunctions',
      ],
      resources: ['*'],
    }));

    // Lambdaレイヤー更新用のCodeBuildプロジェクト
    const layerBuildProject = new codebuild.PipelineProject(this, 'LayerBuildProject', {
      projectName: 'UpdateLambdaLayer',
      description: 'lambda-layerフォルダ内のLambdaレイヤーを更新',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '18',
            },
          },
          build: {
            commands: [
              'echo "Lambdaレイヤーの更新を開始"',
              'cd lambda-layer',
              'zip -r /tmp/lambda-layer.zip .',
              'LAYER_VERSION_ARN=$(aws lambda publish-layer-version --layer-name AwsSdkLayer --description "AWS SDK Layer for Lambda functions" --zip-file fileb:///tmp/lambda-layer.zip --compatible-runtimes nodejs18.x --query LayerVersionArn --output text)',
              'echo "新しいレイヤーバージョン: $LAYER_VERSION_ARN"',
              'echo "Lambda関数のレイヤーを更新中"',
              'aws lambda list-functions --query "Functions[?starts_with(FunctionName, \\`A00\\`)].FunctionName" --output text | tr "\\t" "\\n" | while read FUNCTION_NAME; do if [ ! -z "$FUNCTION_NAME" ]; then echo "Updating layer for function: $FUNCTION_NAME"; aws lambda update-function-configuration --function-name $FUNCTION_NAME --layers $LAYER_VERSION_ARN || echo "Failed to update $FUNCTION_NAME"; fi; done',
              'echo "Lambdaレイヤーの更新完了"',
            ],
          },
        },
      }),
    });

    // Lambdaレイヤー更新のための権限
    layerBuildProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:PublishLayerVersion',
        'lambda:GetLayerVersion',
        'lambda:ListLayers',
        'lambda:UpdateFunctionConfiguration',
        'lambda:GetFunction',
        'lambda:ListFunctions',
      ],
      resources: ['*'],
    }));

    // Lambda関数更新アクション
    const lambdaBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'UpdateLambdaFunctions',
      project: lambdaBuildProject,
      input: sourceOutput,
    });

    // Lambdaレイヤー更新アクション
    const layerBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'UpdateLambdaLayer',
      project: layerBuildProject,
      input: sourceOutput,
    });

    // 手動承認アクション（Lambda関数更新前）
    const approveLambdaAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'ApproveLambdaUpdate',
      additionalInformation: 'Lambda関数の更新を承認してください。lambdaフォルダの変更内容を確認してください。',
    });

    // 手動承認アクション（Lambdaレイヤー更新前）
    const approveLayerAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'ApproveLayerUpdate',
      additionalInformation: 'Lambdaレイヤーの更新を承認してください。lambda-layerフォルダの変更内容を確認してください。',
    });

    // CodePipelineの作成
    const pipeline = new codepipeline.Pipeline(this, 'LambdaUpdatePipeline', {
      pipelineName: 'CdkLambdaLayerPipeline',
      artifactBucket: artifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'ApproveLambdaFunctions',
          actions: [approveLambdaAction],
        },
        {
          stageName: 'UpdateLambdaFunctions',
          actions: [lambdaBuildAction],
        },
        {
          stageName: 'ApproveLambdaLayer',
          actions: [approveLayerAction],
        },
        {
          stageName: 'UpdateLambdaLayer',
          actions: [layerBuildAction],
        },
      ],
    });

    // 出力
    new cdk.CfnOutput(this, 'PipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipelineの名前',
    });

    new cdk.CfnOutput(this, 'RepositoryName', {
      value: repository.repositoryName,
      description: 'CodeCommitリポジトリの名前',
    });

    new cdk.CfnOutput(this, 'ArtifactBucketName', {
      value: artifactBucket.bucketName,
      description: 'パイプラインアーティファクト用S3バケット',
    });
  }
}