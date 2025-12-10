const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const sesClient = new SESClient({ region: process.env.AWS_REGION });
const BUCKET_NAME = 'node12-testup-20231113';
const SENDER_EMAIL = 'bhome465@gmail.com';
const RECIPIENT_EMAIL = 'ryome.public@gmail.com';

exports.handler = async (event) => {
    try {
        const params = {
            Bucket: BUCKET_NAME,
            Prefix: event.prefix || ''
        };

        const command = new ListObjectsV2Command(params);
        const response = await s3Client.send(command);

        const files = response.Contents ? response.Contents.map(item => ({
            key: item.Key,
            size: item.Size,
            lastModified: item.LastModified
        })) : [];

        // メール送信
        const emailParams = {
            Source: SENDER_EMAIL,
            Destination: {
                ToAddresses: [RECIPIENT_EMAIL]
            },
            Message: {
                Subject: {
                    Data: 'Lambda A009 Execution',
                    Charset: 'UTF-8'
                },
                Body: {
                    Text: {
                        Data: 'Hello Mail',
                        Charset: 'UTF-8'
                    }
                }
            }
        };

        const sendEmailCommand = new SendEmailCommand(emailParams);
        await sesClient.send(sendEmailCommand);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'File list retrieved successfully from A009 and email sent',
                files: files,
                count: files.length,
                emailSent: true
            })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Error retrieving file list or sending email',
                error: error.message
            })
        };
    }
};