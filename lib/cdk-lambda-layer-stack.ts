import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class CdkLambdaLayerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3バケットの参照を取得
    const bucket = s3.Bucket.fromBucketName(this, 'ExistingBucket', 'node12-testup-20231113');

    // Lambda Layerの作成
    const awsSdkLayer = new lambda.LayerVersion(this, 'AwsSdkLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda-layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: 'AWS SDK Layer for Lambda functions',
    });

    // Lambda関数の定義リスト
    const lambdaFunctions = [
      { folder: 'test1/A001', name: 'A001Function' },
      { folder: 'test1/A002', name: 'A002Function' },
      { folder: 'test1/A003', name: 'A003Function' },
      { folder: 'test2/A004', name: 'A004Function' },
      { folder: 'test2/A005', name: 'A005Function' },
      { folder: 'test2/A006', name: 'A006Function' },
      { folder: 'test3/A007', name: 'A007Function' },
      { folder: 'test3/A008', name: 'A008Function' },
      { folder: 'test3/A009', name: 'A009Function' },
    ];

    // 各Lambda関数を作成
    lambdaFunctions.forEach(({ folder, name }) => {
      const fn = new lambda.Function(this, name, {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', folder)),
        functionName: name,
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        layers: [awsSdkLayer],
      });

      // S3バケットへの読み取り権限を付与
      bucket.grantRead(fn);

      // 関数のARNを出力
      new cdk.CfnOutput(this, `${name}Arn`, {
        value: fn.functionArn,
        description: `ARN of ${name}`,
      });
    });

    // LayerのARNを出力
    new cdk.CfnOutput(this, 'AwsSdkLayerArn', {
      value: awsSdkLayer.layerVersionArn,
      description: 'ARN of AWS SDK Layer',
    });
  }
}
