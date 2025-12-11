#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkLambdaLayerStack } from '../lib/cdk-lambda-layer-stack';
import { CdkPipelineStack } from '../lib/cdk-pipeline-stack';

const app = new cdk.App();
new CdkLambdaLayerStack(app, 'CdkLambdaLayerStack', {});

new CdkPipelineStack(app, 'CdkPipelineStack', {});