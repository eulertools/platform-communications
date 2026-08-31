import {
  CreateTemplateCommand,
  GetTemplateCommand,
  SESClient,
} from "@aws-sdk/client-ses";
import axios from "axios";

const AWS = require("aws-sdk");

const sesClient = new SESClient({ region: process.env.AWS_REGION });
const s3Client = new AWS.S3();

const bucketName = process.env.BUCKET_NAME;

export async function handler(event: any, context: any, callback: any) {
  let body;
  let statusCode = 200;
  const headers = {
    "Content-Type": "application/json",
  };

  try {
    const data = JSON.parse(event.body);
    await sesClient
      .send(new GetTemplateCommand({ TemplateName: data.template_name }))
      .then(async (record) => {
        const params = {
          Bucket: bucketName,
          Key: `euler-tools-emails/template_body/${data.template_name}-body.txt`,
          Body: JSON.stringify(data.template_body),
        };
        console.log({ message: "Inserting records into bucket..." });
        await s3Client
          .putObject(params)
          .promise()
          .catch((error: any) => {
            console.log("Failed to insert in bucket", error);
          })
          .then(() => {
            console.log("Data inserted into bucket");
          });
        console.log({ message: "Inserted Successfully" });
        body = "Records Inserted Successfully into Bucket...";
      })
      .catch(async (err) => {
        const htmlData = await axios
          .get(
            `https://d19mo0ljtrkve7.cloudfront.net/euler-tools-emails/html/${data.template_name}.html`
          )
          .then((res) => {
            return res.data;
          });
        const templateParams = new CreateTemplateCommand({
          Template: {
            TemplateName: data.template_name,
            HtmlPart: htmlData,
            SubjectPart: data.subject,
          },
        });
        await sesClient
          .send(templateParams)
          .then(async () => {
            const params = {
              Bucket: bucketName,
              Key: `euler-tools-emails/template_body/${data.template_name}-body.txt`,
              Body: JSON.stringify(data.template_body),
            };
            console.log({ message: "Inserting records into bucket..." });
            await s3Client
              .putObject(params)
              .promise()
              .catch((error: any) => {
                console.log("Failed to insert in bucket", error);
              })
              .then(() => {
                console.log("Data inserted into bucket");
              });
            console.log({ message: "Inserted Successfully" });
            body = "Records Inserted Successfully into Bucket...";
          })
          .catch((err) => {
            throw err;
          });
      });
  } catch (err: any) {
    console.log({ error: JSON.stringify(err) });
    statusCode = 400;
    body = err.message;
  } finally {
    console.log({ data: body });
    body = JSON.stringify(body);
  }

  return {
    statusCode,
    body,
    headers,
  };
}
