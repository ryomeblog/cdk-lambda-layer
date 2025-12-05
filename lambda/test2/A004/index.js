const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const BUCKET_NAME = 'node12-testup-20231113';

exports.handler = async (event) => {
    try {
        const params = {
            Bucket: BUCKET_NAME,
            Key: event.key || 'app.zip'
        };

        const command = new GetObjectCommand(params);
        const response = await s3Client.send(command);
        
        const streamToString = (stream) =>
            new Promise((resolve, reject) => {
                const chunks = [];
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('error', reject);
                stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            });

        const bodyContents = await streamToString(response.Body);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'File retrieved successfully from A004',
                content: bodyContents
            })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error retrieving file',
                error: error.message
            })
        };
    }
};