# CDK Deploy パフォーマンス分析レポート

## 調査日時
2025-12-02

## 問題
`cdk deploy`コマンドの実行速度が遅い

## 特定された原因

### 1. **Lambda Layerの循環依存（最重要）**
**影響度: 高**

- **場所**: [`lambda-layer/nodejs/package.json`](lambda-layer/nodejs/package.json:7)
- **問題**: 親プロジェクト自体を依存関係として参照
  ```json
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "cdk-lambda-layer": "file:../.."  // ← これが問題
  }
  ```
- **影響**: Lambda Layerをパッケージングする際に、プロジェクト全体（全Lambda関数、CDKコード等）が含まれ、アセットサイズが肥大化
- **結果**: デプロイ時間の大幅な増加

### 2. **node_modulesの未インストール**
**影響度: 中**

- **問題**: Lambda Layerディレクトリに`node_modules`が存在しない
- **影響**: 毎回のデプロイ時にCDKがアセットを再バンドル
- **結果**: 不要な再計算によるデプロイ時間の増加

### 3. **アセットハッシュの最適化不足**
**影響度: 中**

- **場所**: [`lib/cdk-lambda-layer-stack.ts`](lib/cdk-lambda-layer-stack.ts:40)
- **問題**: Lambda関数のアセットハッシュ計算が最適化されていない
- **影響**: 内容が変わっていなくても、アセットが再作成される可能性
- **結果**: 不要な再デプロイとS3アップロード

### 4. **バンドリング設定の不足**
**影響度: 低**

- **問題**: Lambda Layerのバンドリング処理が明示的に定義されていない
- **影響**: デフォルトのバンドリング動作により、予期しないファイルが含まれる可能性

## 実施した改善策

### ✅ 1. Lambda Layerの循環依存を削除
**ファイル**: `lambda-layer/nodejs/package.json`

```json
{
  "name": "aws-sdk-layer",
  "version": "1.0.0",
  "description": "Lambda Layer for AWS SDK",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0"
    // "cdk-lambda-layer": "file:../.." を削除
  }
}
```

**効果**: Lambda Layerのサイズを大幅に削減

### ✅ 2. 依存関係のインストール
```bash
cd lambda-layer/nodejs
npm install
```

**効果**: `node_modules`を事前生成し、毎回のバンドリングを不要に

### ✅ 3. アセットハッシュの最適化
**ファイル**: `lib/cdk-lambda-layer-stack.ts`

```typescript
code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', folder), {
  assetHashType: cdk.AssetHashType.OUTPUT,
}),
```

**効果**: 実際の出力内容でハッシュを計算し、不要な再デプロイを防止

### ✅ 4. Lambda Layerのバンドリング設定を追加
**ファイル**: `lib/cdk-lambda-layer-stack.ts`

```typescript
code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda-layer'), {
  bundling: {
    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
    command: [
      'bash', '-c',
      'cp -r /asset-input/nodejs /asset-output/'
    ],
  },
}),
```

**効果**: 必要なファイルのみを明示的にバンドル

## 期待される効果

### デプロイ速度の改善
- **初回デプロイ**: 30-50%の高速化（循環依存の削除による）
- **2回目以降**: 60-80%の高速化（アセットキャッシュの活用）

### アセットサイズの削減
- Lambda Layer: 推定90%以上のサイズ削減
- 各Lambda関数: 不要な再アップロードの削減

## 追加の推奨事項

### 1. CDK Context Lookupsのキャッシュ
`cdk.json`の`context`セクションに環境固有の値をキャッシュすることで、毎回のルックアップを回避できます。

### 2. Hotswap Deploymentの活用
開発環境では`cdk deploy --hotswap`を使用することで、CloudFormation変更なしでLambda関数のコードのみを更新できます。

```bash
cdk deploy --hotswap
```

**注意**: 本番環境では使用しないこと

### 3. 並列デプロイの活用
複数のスタックがある場合は、`--concurrency`オプションで並列実行を有効化:

```bash
cdk deploy --all --concurrency 3
```

### 4. Lambda関数のコード変更検出の最適化
頻繁に変更される関数とそうでない関数を分離し、変更頻度の低い関数は別スタックに分けることを検討。

## デプロイ速度の測定方法

### Before（改善前）
```bash
time cdk deploy
```

### After（改善後）
```bash
time cdk deploy
```

差分を記録して効果を確認してください。

## トラブルシューティング

### Lambda Layerがインポートエラーになる場合
```bash
cd lambda-layer/nodejs
rm -rf node_modules package-lock.json
npm install
```

### アセットハッシュがキャッシュされない場合
```bash
# CDKアセットのキャッシュをクリア
rm -rf cdk.out .cdk.staging
cdk synth
```

### バンドリングでDockerエラーが出る場合
バンドリング設定を一時的に削除するか、Dockerが正しく起動しているか確認してください。

## 参考資料
- [AWS CDK Best Practices - Performance](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [Lambda Layers - Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/configuration-layers.html)
- [CDK Asset Bundling](https://docs.aws.amazon.com/cdk/v2/guide/assets.html)